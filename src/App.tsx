import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

type ProviderPreset = {
  id: string
  label: string
  baseUrl: string
  model: string
}

type Segment = {
  id: string
  page: number
  text: string
  translation?: string
}

type HighlightTag = 'novelty' | 'method' | 'result' | 'limitation'

type HighlightItem = {
  segmentId: string
  tag: HighlightTag
  reason: string
}

type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

type AnalysisBundle = {
  summary: string
  highlights: HighlightItem[]
}

type QaItem = {
  id: string
  question: string
  answer: string
}

type Settings = {
  baseUrl: string
  apiKey: string
  model: string
  systemPrompt: string
}

type OutlineItem = {
  id: string
  title: string
  page: number
}

const providerPresets: ProviderPreset[] = [
  { id: 'openai', label: 'OpenAI Compatible', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4.1-mini' },
  { id: 'siliconflow', label: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-72B-Instruct' },
]

const SETTINGS_KEY = 'sunlight-settings'
const RECENT_URLS_KEY = 'sunlight-recent-urls'

const defaultSettings: Settings = {
  baseUrl: providerPresets[0].baseUrl,
  apiKey: '',
  model: providerPresets[0].model,
  systemPrompt:
    'You are a careful paper reading assistant. Always ground your answer in the provided paper text. When possible, cite segment ids like [p1-0-0]. Also identify novelty, method, result, and limitation.',
}

type PdfLib = Awaited<typeof import('pdfjs-dist')>
let cachedPdfLib: PdfLib | null = null

async function getPdfLib() {
  if (cachedPdfLib) return cachedPdfLib
  const [pdfjsLib, workerModule] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerModule.default
  cachedPdfLib = pdfjsLib
  return pdfjsLib
}

function chunkText(text: string, page: number) {
  const rawParagraphs = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  return rawParagraphs.flatMap((paragraph, index) => {
    if (paragraph.length <= 420) return [{ id: `p${page}-${index}-0`, page, text: paragraph }]
    const slices: Segment[] = []
    const parts = paragraph.match(/[^.!?。！？]+[.!?。！？]?/g) ?? [paragraph]
    let buf = ''
    let chunkIndex = 0
    for (const part of parts) {
      const next = `${buf} ${part}`.trim()
      if (next.length > 420 && buf) {
        slices.push({ id: `p${page}-${index}-${chunkIndex++}`, page, text: buf })
        buf = part.trim()
      } else {
        buf = next
      }
    }
    if (buf) slices.push({ id: `p${page}-${index}-${chunkIndex}`, page, text: buf })
    return slices
  })
}

function extractOutline(fullText: string): OutlineItem[] {
  const items: OutlineItem[] = []
  const lines = fullText.split('\n').map((line) => line.trim()).filter(Boolean)
  let currentPage = 1
  for (const line of lines) {
    const pageMatch = line.match(/^\[Page (\d+)\]$/)
    if (pageMatch) {
      currentPage = Number(pageMatch[1])
      continue
    }
    const isHeading = /^(\d+(\.\d+)*)\s+.+/.test(line) || /^[A-Z][A-Z\s-]{6,}$/.test(line)
    if (isHeading && line.length < 120) items.push({ id: `outline-${currentPage}-${items.length}`, title: line, page: currentPage })
  }
  return items.slice(0, 40)
}

async function extractPdfSegments(buffer: ArrayBuffer) {
  const pdfjsLib = await getPdfLib()
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
  const segments: Segment[] = []
  let fullText = ''
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const textContent = await page.getTextContent()
    const lines = textContent.items.map((item) => ('str' in item ? item.str : '')).join(' ').replace(/\s+/g, ' ').trim()
    if (!lines) continue
    fullText += `\n\n[Page ${pageNumber}]\n${lines}`
    segments.push(...chunkText(lines, pageNumber))
  }
  return { pageCount: pdf.numPages, fullText: fullText.trim(), segments, outline: extractOutline(fullText.trim()) }
}

function normalizeJsonBlock(text: string) {
  const fenced = text.match(/```json([\s\S]*?)```/i)
  if (fenced) return fenced[1].trim()
  return text.trim()
}

function normalizePdfUrl(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (/arxiv\.org\/abs\//i.test(trimmed)) return trimmed.replace('/abs/', '/pdf/').replace(/(#.*)?$/, '.pdf')
  return trimmed
}

async function callModel({ baseUrl, apiKey, model, systemPrompt, messages }: { baseUrl: string; apiKey: string; model: string; systemPrompt: string; messages: ChatMessage[] }) {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, temperature: 0.2, messages: [{ role: 'system', content: systemPrompt }, ...messages] }),
  })
  if (!resp.ok) {
    const errText = await resp.text()
    throw new Error(`模型请求失败：${resp.status} ${errText}`)
  }
  const data = await resp.json()
  return data.choices?.[0]?.message?.content?.trim() ?? ''
}

function App() {
  const [settings, setSettings] = useState<Settings>(() => {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? { ...defaultSettings, ...JSON.parse(raw) } : defaultSettings
  })
  const [pdfName, setPdfName] = useState('')
  const [pdfUrl, setPdfUrl] = useState('')
  const [recentUrls, setRecentUrls] = useState<string[]>(() => {
    const raw = localStorage.getItem(RECENT_URLS_KEY)
    return raw ? (JSON.parse(raw) as string[]).slice(0, 5) : []
  })
  const [pageCount, setPageCount] = useState(0)
  const [outline, setOutline] = useState<OutlineItem[]>([])
  const [segments, setSegments] = useState<Segment[]>([])
  const [analysis, setAnalysis] = useState<HighlightItem[]>([])
  const [question, setQuestion] = useState('')
  const [qaHistory, setQaHistory] = useState<QaItem[]>([])
  const [answer, setAnswer] = useState('')
  const [selectedPage, setSelectedPage] = useState<number | 'all'>('all')
  const [busy, setBusy] = useState('')
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [modelPanelOpen, setModelPanelOpen] = useState(true)
  const [analysisReady, setAnalysisReady] = useState(false)
  const [translatedPages, setTranslatedPages] = useState<Record<number, string[]>>({})
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [chatCollapsed, setChatCollapsed] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [activeTag, setActiveTag] = useState<HighlightTag | 'all'>('all')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  }, [settings])
  useEffect(() => {
    localStorage.setItem(RECENT_URLS_KEY, JSON.stringify(recentUrls.slice(0, 5)))
  }, [recentUrls])

  const pageSegments = useMemo(() => (selectedPage === 'all' ? segments : segments.filter((segment) => segment.page === selectedPage)), [segments, selectedPage])
  const highlightBySegmentId = useMemo(() => {
    const map = new Map<string, HighlightTag>()
    analysis.forEach((item) => map.set(item.segmentId, item.tag))
    return map
  }, [analysis])
  const filteredPageSegments = useMemo(() => {
    const keywordLower = keyword.trim().toLowerCase()
    return pageSegments.filter((segment) => {
      if (activeTag !== 'all' && highlightBySegmentId.get(segment.id) !== activeTag) return false
      if (keywordLower && !segment.text.toLowerCase().includes(keywordLower) && !segment.id.toLowerCase().includes(keywordLower)) return false
      return true
    })
  }, [pageSegments, keyword, activeTag, highlightBySegmentId])
  const tagStats = useMemo(() => ({
    novelty: analysis.filter((item) => item.tag === 'novelty').length,
    method: analysis.filter((item) => item.tag === 'method').length,
    result: analysis.filter((item) => item.tag === 'result').length,
    limitation: analysis.filter((item) => item.tag === 'limitation').length,
  }), [analysis])

  async function runAutoAnalysis(parsedSegments: Segment[]) {
    if (!settings.apiKey) return
    try {
      const subset = parsedSegments.slice(0, 120).map((segment) => ({ id: segment.id, page: segment.page, text: segment.text }))
      const content = await callModel({
        ...settings,
        messages: [{ role: 'user', content: 'Read these paper segments and return JSON with {summary, highlights}. highlights should contain segmentId, tag(novelty|method|result|limitation), reason. summary should be concise Chinese markdown. ' + JSON.stringify(subset) }],
      })
      const parsed = JSON.parse(normalizeJsonBlock(content)) as AnalysisBundle
      setAnalysis(parsed.highlights || [])
      setAnswer(parsed.summary || '')
      setAnalysisReady(true)
    } catch {
      // ignore non-blocking auto analysis failure
    }
  }

  async function translateCurrentPage(segmentsForPage: Segment[], page: number) {
    if (!settings.apiKey || !segmentsForPage.length) return
    setBusy('正在生成当前页对照翻译…')
    try {
      const payload = segmentsForPage.slice(0, 24).map(({ id, text }) => ({ id, text }))
      const content = await callModel({
        ...settings,
        messages: [{ role: 'user', content: 'Translate the following paper passages into Chinese for side-by-side reading. Keep terminology accurate and concise. Return JSON array [{id, translation}]. ' + JSON.stringify(payload) }],
      })
      const parsed = JSON.parse(normalizeJsonBlock(content)) as Array<{ id: string; translation: string }>
      setTranslatedPages((prev) => ({ ...prev, [page]: parsed.map((item) => `${item.id}｜${item.translation}`) }))
    } catch (e) {
      setError(e instanceof Error ? e.message : '翻译失败')
    } finally {
      setBusy('')
    }
  }

  async function handlePdfBuffer(buffer: ArrayBuffer, name: string) {
    try {
      setBusy('正在解析 PDF…')
      setProgress('提取页面文本与目录')
      setError('')
      const parsed = await extractPdfSegments(buffer)
      setPdfName(name)
      setPageCount(parsed.pageCount)
      setOutline(parsed.outline)
      setSegments(parsed.segments)
      setSelectedPage(1)
      setAnalysis([])
      setAnswer('')
      setQaHistory([])
      setTranslatedPages({})
      setKeyword('')
      setActiveTag('all')
      setProgress(`已载入 ${parsed.pageCount} 页，开始准备对照阅读`)
      await runAutoAnalysis(parsed.segments)
      await translateCurrentPage(parsed.segments.filter((s) => s.page === 1), 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF 解析失败')
    } finally {
      setBusy('')
    }
  }

  async function onUploadFile(file: File) {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('请上传 PDF 文件')
      return
    }
    const buffer = await file.arrayBuffer()
    await handlePdfBuffer(buffer, file.name)
  }

  async function onLoadFromUrl(target?: string) {
    const normalized = normalizePdfUrl(target ?? pdfUrl)
    if (!normalized) return
    try {
      setBusy('正在下载 PDF…')
      setProgress('准备从链接导入论文')
      setError('')
      const resp = await fetch(normalized)
      if (!resp.ok) throw new Error(`PDF 下载失败：${resp.status}`)
      const contentType = resp.headers.get('content-type') || ''
      if (!contentType.includes('pdf') && !normalized.toLowerCase().endsWith('.pdf')) throw new Error('URL 返回内容不是 PDF，请检查链接或使用可直连 PDF 的地址')
      const buffer = await resp.arrayBuffer()
      await handlePdfBuffer(buffer, normalized)
      setPdfUrl(normalized)
      setRecentUrls((prev) => [normalized, ...prev.filter((x) => x !== normalized)].slice(0, 5))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'URL 加载失败')
      setBusy('')
      setProgress('')
    }
  }

  async function askQuestion() {
    if (!question.trim() || !segments.length) return
    try {
      setBusy('正在回答问题…')
      const context = segments.slice(0, 160).map((s) => `[${s.id}] ${s.text}`).join('\n')
      const content = await callModel({
        ...settings,
        messages: [{ role: 'user', content: 'Answer only using the paper text. Cite useful segment ids in brackets when possible. Also mention novelty/method/result/limitation when relevant.\n\n' + `Paper text:\n${context}\n\nQuestion: ${question}` }],
      })
      setAnswer(content)
      setQaHistory((prev) => [{ id: crypto.randomUUID(), question, answer: content }, ...prev].slice(0, 10))
      setQuestion('')
    } catch (e) {
      setError(e instanceof Error ? e.message : '问答失败')
    } finally {
      setBusy('')
    }
  }

  async function jumpToPage(page: number) {
    setSelectedPage(page)
    if (!translatedPages[page]) await translateCurrentPage(segments.filter((s) => s.page === page), page)
  }

  return (
    <div className={`sunlight-layout ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className="left-column">
        <div className="sidebar-shell">
          <div className="sidebar-top">
            <button className="sidebar-toggle" onClick={() => setSidebarCollapsed((v) => !v)}>{sidebarCollapsed ? '→' : '←'}</button>
            {!sidebarCollapsed ? (
              <div className="logo-card">
                <div className="logo-mark">S</div>
                <div>
                  <div className="eyebrow">AI paper reader</div>
                  <h1>Sunlight</h1>
                </div>
              </div>
            ) : null}
          </div>

          {!sidebarCollapsed ? (
            <section className="panel sidebar-panel">
              <h2>{pdfName ? '论文大纲' : '导入论文'}</h2>
              {!pdfName ? (
                <>
                  <button onClick={() => fileInputRef.current?.click()}>上传 PDF</button>
                  <input ref={fileInputRef} type="file" accept="application/pdf" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void onUploadFile(file) }} />
                  <div
                    className={`dropzone ${dragging ? 'dragging' : ''}`}
                    onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => { e.preventDefault(); setDragging(false); const file = e.dataTransfer.files?.[0]; if (file) void onUploadFile(file) }}
                  >拖拽 PDF 到这里</div>
                  <label>
                    PDF / arXiv 链接
                    <input value={pdfUrl} onChange={(e) => setPdfUrl(e.target.value)} placeholder="https://.../paper.pdf" />
                  </label>
                  <button className="secondary" onClick={() => onLoadFromUrl()}>从链接加载</button>
                  {!!recentUrls.length && <div className="recent-list">{recentUrls.map((url) => <button key={url} className="secondary recent-item" onClick={() => onLoadFromUrl(url)}>{url}</button>)}</div>}
                </>
              ) : (
                <>
                  <div className="doc-meta"><strong>{pdfName}</strong><span>{pageCount} 页</span></div>
                  <div className="outline-list">
                    <button className={`outline-item ${selectedPage === 'all' ? 'active' : ''}`} onClick={() => setSelectedPage('all')}><span className="outline-page">ALL</span><span>浏览全文片段</span></button>
                    {outline.length ? outline.map((item) => (
                      <button key={item.id} className={`outline-item ${selectedPage === item.page ? 'active' : ''}`} onClick={() => void jumpToPage(item.page)}>
                        <span className="outline-page">P{item.page}</span><span>{item.title}</span>
                      </button>
                    )) : Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => (
                      <button key={page} className={`outline-item ${selectedPage === page ? 'active' : ''}`} onClick={() => void jumpToPage(page)}>
                        <span className="outline-page">P{page}</span><span>第 {page} 页</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </section>
          ) : null}
        </div>
      </aside>

      <main className="center-column">
        <section className="pdf-grid full-height">
          <div className="pdf-pane panel paper-pane">
            <div className="pane-title-row"><div className="pane-title">原文</div>{selectedPage !== 'all' ? <div className="page-pill">Page {selectedPage}</div> : null}</div>
            <div className="reader-tools">
              <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索当前页片段（ID 或关键词）" />
              <div className="tag-filter-row">
                <button className={`secondary chip ${activeTag === 'all' ? 'chip-active' : ''}`} onClick={() => setActiveTag('all')}>全部</button>
                <button className={`secondary chip ${activeTag === 'novelty' ? 'chip-active' : ''}`} onClick={() => setActiveTag('novelty')}>原创</button>
                <button className={`secondary chip ${activeTag === 'method' ? 'chip-active' : ''}`} onClick={() => setActiveTag('method')}>方法</button>
                <button className={`secondary chip ${activeTag === 'result' ? 'chip-active' : ''}`} onClick={() => setActiveTag('result')}>结果</button>
                <button className={`secondary chip ${activeTag === 'limitation' ? 'chip-active' : ''}`} onClick={() => setActiveTag('limitation')}>局限</button>
              </div>
            </div>
            {filteredPageSegments.length ? <div className="paper-flow">{filteredPageSegments.map((segment) => <article key={segment.id} className="paper-block"><div className="paper-block-meta">{segment.id}</div><div className="paper-block-text">{segment.text}</div></article>)}</div> : <div className="empty-state">{segments.length ? '当前筛选条件下没有匹配片段。' : '导入 PDF 后，这里会显示当前页原文内容。'}</div>}
          </div>

          <div className="pdf-pane panel translation-pane">
            <div className="pane-title">对照翻译</div>
            {selectedPage !== 'all' && translatedPages[selectedPage]?.length ? <div className="translation-flow">{translatedPages[selectedPage].map((line, idx) => <article key={`${selectedPage}-${idx}`} className="translation-block">{line}</article>)}</div> : <div className="empty-state">切换到某一页后，这里会显示对应页的 AI 对照翻译。</div>}
          </div>
        </section>
      </main>

      <div className={`floating-chat ${chatCollapsed ? 'collapsed' : ''}`}>
        <div className="floating-chat-header">
          <div>
            <strong>AI 论文助手</strong>
            <div className="mini-tags">
              <span className="tag tag-novelty">原创 {tagStats.novelty}</span>
              <span className="tag tag-method">方法 {tagStats.method}</span>
              <span className="tag tag-result">结果 {tagStats.result}</span>
              <span className="tag tag-limitation">局限 {tagStats.limitation}</span>
            </div>
          </div>
          <div className="floating-actions">
            <button className="secondary collapse-btn" onClick={() => setModelPanelOpen((v) => !v)}>{modelPanelOpen ? '模型收起' : '模型展开'}</button>
            <button className="secondary collapse-btn" onClick={() => setChatCollapsed((v) => !v)}>{chatCollapsed ? '展开' : '收起'}</button>
          </div>
        </div>

        {!chatCollapsed ? (
          <>
            {modelPanelOpen ? (
              <section className="floating-panel-block model-block">
                <div className="preset-row">{providerPresets.map((preset) => <button key={preset.id} className="secondary chip" onClick={() => setSettings((prev) => ({ ...prev, baseUrl: preset.baseUrl, model: preset.model }))}>{preset.label}</button>)}</div>
                <label>Base URL<input value={settings.baseUrl} onChange={(e) => setSettings((prev) => ({ ...prev, baseUrl: e.target.value }))} /></label>
                <label>Model<input value={settings.model} onChange={(e) => setSettings((prev) => ({ ...prev, model: e.target.value }))} /></label>
                <label>API Key<input type="password" value={settings.apiKey} onChange={(e) => setSettings((prev) => ({ ...prev, apiKey: e.target.value }))} /></label>
                <button className="secondary" onClick={() => setSettings((prev) => ({ ...prev, apiKey: '' }))}>清空本地 API Key</button>
              </section>
            ) : null}

            <div className="chat-window">
              {analysisReady ? <div className="assistant-card">我已默认分析这篇论文的原创点、方法、结果和局限，你可以直接追问。</div> : <div className="assistant-card muted-card">先填写模型，再上传论文。我会自动生成结构化理解和默认标签。</div>}
              {answer ? <div className="assistant-card">{answer}</div> : null}
              {qaHistory.map((item) => <div key={item.id} className="chat-turns"><div className="user-card">{item.question}</div><div className="assistant-card">{item.answer}</div></div>)}
            </div>
            <div className="chat-input-row">
              <textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="针对当前论文提问，比如：这篇论文的方法创新点是什么？" />
              <button onClick={askQuestion} disabled={!question || !settings.apiKey || !segments.length}>发送</button>
            </div>
          </>
        ) : null}
      </div>

      {busy ? <div className="status-banner">{busy}</div> : null}
      {progress ? <div className="status-banner">{progress}</div> : null}
      {error ? <div className="status-banner error">{error}</div> : null}
    </div>
  )
}

export default App
