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
  tags: string[]
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

const providerPresets: ProviderPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI Compatible',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4.1-mini',
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-72B-Instruct',
  },
]

const SETTINGS_KEY = 'paper-moonlight-h5-settings'
const RECENT_URLS_KEY = 'paper-moonlight-h5-recent-urls'

const defaultSettings: Settings = {
  baseUrl: providerPresets[0].baseUrl,
  apiKey: '',
  model: providerPresets[0].model,
  systemPrompt:
    'You are a careful paper reading assistant. Always ground your answer in the provided paper text. If evidence is weak, say so.',
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
    if (paragraph.length <= 420) {
      return [{ id: `p${page}-${index}-0`, page, text: paragraph, tags: [] as string[] }]
    }

    const slices: Segment[] = []
    const parts = paragraph.match(/[^.!?。！？]+[.!?。！？]?/g) ?? [paragraph]
    let buf = ''
    let chunkIndex = 0
    for (const part of parts) {
      const next = `${buf} ${part}`.trim()
      if (next.length > 420 && buf) {
        slices.push({ id: `p${page}-${index}-${chunkIndex++}`, page, text: buf, tags: [] })
        buf = part.trim()
      } else {
        buf = next
      }
    }
    if (buf) slices.push({ id: `p${page}-${index}-${chunkIndex}`, page, text: buf, tags: [] })
    return slices
  })
}

async function extractPdfSegments(buffer: ArrayBuffer) {
  const pdfjsLib = await getPdfLib()
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
  const segments: Segment[] = []
  let fullText = ''

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const textContent = await page.getTextContent()
    const lines = textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (!lines) continue
    fullText += `\n\n[Page ${pageNumber}]\n${lines}`
    segments.push(...chunkText(lines, pageNumber))
  }

  return {
    pageCount: pdf.numPages,
    fullText: fullText.trim(),
    segments,
  }
}

function normalizeJsonBlock(text: string) {
  const fenced = text.match(/```json([\s\S]*?)```/i)
  if (fenced) return fenced[1].trim()
  return text.trim()
}

function normalizePdfUrl(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (/arxiv\.org\/abs\//i.test(trimmed)) {
    return trimmed.replace('/abs/', '/pdf/').replace(/(#.*)?$/, '.pdf')
  }
  return trimmed
}

async function callModel({
  baseUrl,
  apiKey,
  model,
  systemPrompt,
  messages,
}: {
  baseUrl: string
  apiKey: string
  model: string
  systemPrompt: string
  messages: ChatMessage[]
}) {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
    }),
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
  const [fullText, setFullText] = useState('')
  const [segments, setSegments] = useState<Segment[]>([])
  const [summary, setSummary] = useState('')
  const [analysis, setAnalysis] = useState<HighlightItem[]>([])
  const [question, setQuestion] = useState('')
  const [qaHistory, setQaHistory] = useState<QaItem[]>([])
  const [answer, setAnswer] = useState('')
  const [selectedPage, setSelectedPage] = useState<number | 'all'>('all')
  const [searchText, setSearchText] = useState('')
  const [activeTag, setActiveTag] = useState<HighlightTag | 'all'>('all')
  const [busy, setBusy] = useState('')
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [readerMode, setReaderMode] = useState<'original' | 'translated'>('original')
  const [dragging, setDragging] = useState(false)
  const [activeSidebar, setActiveSidebar] = useState<'document' | 'model'>('document')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    localStorage.setItem(RECENT_URLS_KEY, JSON.stringify(recentUrls.slice(0, 5)))
  }, [recentUrls])

  const tagMap = useMemo(() => {
    return analysis.reduce<Record<string, HighlightItem[]>>((acc, item) => {
      acc[item.segmentId] ??= []
      acc[item.segmentId].push(item)
      return acc
    }, {})
  }, [analysis])

  const visibleSegments = useMemo(() => {
    const keyword = searchText.trim().toLowerCase()
    return segments.filter((segment) => {
      if (selectedPage !== 'all' && segment.page !== selectedPage) return false
      if (
        keyword &&
        !segment.text.toLowerCase().includes(keyword) &&
        !segment.translation?.toLowerCase().includes(keyword)
      ) {
        return false
      }
      if (activeTag !== 'all' && !(tagMap[segment.id] || []).some((t) => t.tag === activeTag)) return false
      return true
    })
  }, [segments, selectedPage, searchText, activeTag, tagMap])

  const readingStats = useMemo(() => {
    const novelty = analysis.filter((item) => item.tag === 'novelty').length
    const method = analysis.filter((item) => item.tag === 'method').length
    const result = analysis.filter((item) => item.tag === 'result').length
    const limitation = analysis.filter((item) => item.tag === 'limitation').length
    return {
      novelty,
      method,
      result,
      limitation,
      totalSegments: segments.length,
      visibleSegments: visibleSegments.length,
    }
  }, [analysis, segments.length, visibleSegments.length])

  async function handlePdfBuffer(buffer: ArrayBuffer, name: string) {
    try {
      setBusy('正在解析 PDF…')
      setProgress('重建页面与文本块')
      setError('')
      const parsed = await extractPdfSegments(buffer)
      setPdfName(name)
      setPageCount(parsed.pageCount)
      setFullText(parsed.fullText)
      setSegments(parsed.segments)
      setSummary('')
      setAnalysis([])
      setAnswer('')
      setQaHistory([])
      setSelectedPage('all')
      setReaderMode('original')
      setSearchText('')
      setActiveTag('all')
      setActiveSidebar('document')
      setProgress(`已载入 ${parsed.pageCount} 页，${parsed.segments.length} 个阅读块`)
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
      if (!contentType.includes('pdf') && !normalized.toLowerCase().endsWith('.pdf')) {
        throw new Error('URL 返回内容不是 PDF，请检查链接或使用可直连 PDF 的地址')
      }
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

  async function runSummaryAndHighlights() {
    if (!fullText) return
    try {
      setBusy('正在生成摘要与结构高亮…')
      setProgress('抽取前 120 段进行结构化分析')
      setError('')
      const subset = segments.slice(0, 120).map((segment) => ({
        id: segment.id,
        page: segment.page,
        text: segment.text,
      }))

      const content = await callModel({
        ...settings,
        messages: [
          {
            role: 'user',
            content:
              'You will read paper segments and return JSON with keys summary and highlights. ' +
              'summary should be concise markdown in Chinese. highlights should be an array of objects with segmentId, tag(novelty|method|result|limitation), reason. ' +
              `Paper segments: ${JSON.stringify(subset)}`,
          },
        ],
      })

      const parsed = JSON.parse(normalizeJsonBlock(content)) as AnalysisBundle
      setSummary(parsed.summary || '')
      setAnalysis(parsed.highlights || [])
      setProgress(`完成：摘要 + 高亮 ${parsed.highlights?.length ?? 0} 条`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '摘要分析失败')
    } finally {
      setBusy('')
    }
  }

  async function translateVisibleSegments() {
    if (!visibleSegments.length) return
    try {
      setBusy('正在翻译当前视图…')
      setError('')
      const chunks: Array<Array<{ id: string; text: string }>> = []
      const payload = visibleSegments.map(({ id, text }) => ({ id, text }))
      for (let i = 0; i < payload.length; i += 20) chunks.push(payload.slice(i, i + 20))

      const translatedMap: Record<string, string> = {}
      for (let i = 0; i < chunks.length; i += 1) {
        setProgress(`翻译进度 ${i + 1}/${chunks.length}`)
        const content = await callModel({
          ...settings,
          messages: [
            {
              role: 'user',
              content:
                'Translate the following paper passages into Chinese. Return JSON array [{id, translation}] and keep technical terms accurate. ' +
                JSON.stringify(chunks[i]),
            },
          ],
        })
        const parsed = JSON.parse(normalizeJsonBlock(content)) as Array<{ id: string; translation: string }>
        parsed.forEach((item) => {
          translatedMap[item.id] = item.translation
        })
      }

      setSegments((prev) =>
        prev.map((segment) =>
          translatedMap[segment.id] ? { ...segment, translation: translatedMap[segment.id] } : segment,
        ),
      )
      setReaderMode('translated')
      setProgress(`翻译完成，共 ${Object.keys(translatedMap).length} 段`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '翻译失败')
    } finally {
      setBusy('')
    }
  }

  async function askQuestion() {
    if (!question.trim() || !fullText) return
    try {
      setBusy('正在回答问题…')
      setProgress('聚合论文上下文并生成回答')
      setError('')
      const context = segments.slice(0, 160).map((s) => `[${s.id}] ${s.text}`).join('\n')
      const content = await callModel({
        ...settings,
        messages: [
          {
            role: 'user',
            content:
              'Answer only using the paper text. Cite useful segment ids in brackets when possible. If confidence is low, say uncertain.\n\n' +
              `Paper text:\n${context}\n\nQuestion: ${question}`,
          },
        ],
      })
      setAnswer(content)
      setQaHistory((prev) => [{ id: crypto.randomUUID(), question, answer: content }, ...prev].slice(0, 8))
    } catch (e) {
      setError(e instanceof Error ? e.message : '问答失败')
    } finally {
      setBusy('')
    }
  }

  function clearLocalSecrets() {
    setSettings((prev) => ({ ...prev, apiKey: '' }))
  }

  const heroDescription = pdfName
    ? `${pdfName} · ${pageCount} 页 · ${segments.length} 个阅读块`
    : '上传 PDF 或输入链接，进入对照阅读、摘要、高亮与问答工作流。'

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark">M</div>
          <div>
            <div className="eyebrow">AI Paper Reader</div>
            <h1>Paper Moonlight H5</h1>
          </div>
        </div>
        <div className="topbar-center">
          <p>{heroDescription}</p>
        </div>
        <div className="topbar-actions">
          <button onClick={() => fileInputRef.current?.click()}>上传 PDF</button>
          <button className="secondary" onClick={runSummaryAndHighlights} disabled={!fullText || !settings.apiKey}>
            生成摘要
          </button>
          <button className="secondary" onClick={translateVisibleSegments} disabled={!visibleSegments.length || !settings.apiKey}>
            翻译当前视图
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="left-rail">
          <div className="rail-tabs">
            <button className={activeSidebar === 'document' ? 'active-tab' : ''} onClick={() => setActiveSidebar('document')}>
              文档
            </button>
            <button className={activeSidebar === 'model' ? 'active-tab' : ''} onClick={() => setActiveSidebar('model')}>
              模型
            </button>
          </div>

          {activeSidebar === 'document' ? (
            <>
              <section className="soft-panel">
                <h2>导入论文</h2>
                <button onClick={() => fileInputRef.current?.click()}>选择本地 PDF</button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void onUploadFile(file)
                  }}
                />
                <div
                  className={`dropzone ${dragging ? 'dragging' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragging(true)
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragging(false)
                    const file = e.dataTransfer.files?.[0]
                    if (file) void onUploadFile(file)
                  }}
                >
                  拖拽 PDF 到这里
                </div>
                <label>
                  PDF / arXiv 链接
                  <input
                    value={pdfUrl}
                    onChange={(e) => setPdfUrl(e.target.value)}
                    placeholder="https://.../paper.pdf 或 arxiv abs"
                  />
                </label>
                <button className="secondary" onClick={() => onLoadFromUrl()}>
                  从链接加载
                </button>
                {!!recentUrls.length && (
                  <div className="recent-urls">
                    <div className="subtle-label">最近导入</div>
                    {recentUrls.map((url) => (
                      <button key={url} className="url-chip" onClick={() => onLoadFromUrl(url)} title={url}>
                        {url}
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section className="soft-panel compact-gap">
                <h2>阅读控制</h2>
                <label>
                  页码筛选
                  <select
                    value={selectedPage}
                    onChange={(e) => setSelectedPage(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                  >
                    <option value="all">全部页面</option>
                    {Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => (
                      <option key={page} value={page}>
                        第 {page} 页
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  搜索
                  <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="搜索原文或译文" />
                </label>
                <label>
                  高亮标签
                  <select value={activeTag} onChange={(e) => setActiveTag(e.target.value as HighlightTag | 'all')}>
                    <option value="all">全部标签</option>
                    <option value="novelty">novelty</option>
                    <option value="method">method</option>
                    <option value="result">result</option>
                    <option value="limitation">limitation</option>
                  </select>
                </label>
                <div className="mode-switch">
                  <button className={readerMode === 'original' ? 'active-tab' : ''} onClick={() => setReaderMode('original')}>
                    原文
                  </button>
                  <button className={readerMode === 'translated' ? 'active-tab' : ''} onClick={() => setReaderMode('translated')}>
                    译文
                  </button>
                </div>
              </section>

              <section className="soft-panel stats-panel">
                <div>
                  <div className="metric-value">{readingStats.visibleSegments}</div>
                  <div className="metric-label">当前可见段落</div>
                </div>
                <div>
                  <div className="metric-value">{readingStats.novelty}</div>
                  <div className="metric-label">创新点</div>
                </div>
                <div>
                  <div className="metric-value">{readingStats.method}</div>
                  <div className="metric-label">方法</div>
                </div>
                <div>
                  <div className="metric-value">{readingStats.result}</div>
                  <div className="metric-label">结果</div>
                </div>
              </section>
            </>
          ) : (
            <section className="soft-panel">
              <h2>模型配置</h2>
              <div className="preset-list">
                {providerPresets.map((preset) => (
                  <button
                    key={preset.id}
                    className="chip"
                    onClick={() =>
                      setSettings((prev) => ({
                        ...prev,
                        baseUrl: preset.baseUrl,
                        model: preset.model,
                      }))
                    }
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <label>
                Base URL
                <input
                  value={settings.baseUrl}
                  onChange={(e) => setSettings((prev) => ({ ...prev, baseUrl: e.target.value }))}
                  placeholder="https://api.openai.com/v1"
                />
              </label>
              <label>
                Model
                <input
                  value={settings.model}
                  onChange={(e) => setSettings((prev) => ({ ...prev, model: e.target.value }))}
                  placeholder="gpt-4.1-mini"
                />
              </label>
              <label>
                API Key
                <input
                  type="password"
                  value={settings.apiKey}
                  onChange={(e) => setSettings((prev) => ({ ...prev, apiKey: e.target.value }))}
                  placeholder="sk-..."
                  autoComplete="off"
                />
              </label>
              <label>
                System Prompt
                <textarea
                  value={settings.systemPrompt}
                  onChange={(e) => setSettings((prev) => ({ ...prev, systemPrompt: e.target.value }))}
                />
              </label>
              <button className="secondary" onClick={clearLocalSecrets}>
                清空本地 API Key
              </button>
              <p className="muted small-text">密钥只保存在当前浏览器 localStorage，不会被提交到仓库。</p>
            </section>
          )}
        </aside>

        <main className="reader-column">
          <section className="reader-hero">
            <div>
              <div className="eyebrow">Focused Reading Workspace</div>
              <h2>{pdfName || '把论文导进来，开始高效精读'}</h2>
              <p>
                让正文成为中心，摘要、高亮、翻译和问答都围绕正文展开，而不是把阅读打断成一堆工具卡片。
              </p>
            </div>
            <div className="reader-hero-stats">
              <div>
                <strong>{pageCount || '--'}</strong>
                <span>页数</span>
              </div>
              <div>
                <strong>{segments.length || '--'}</strong>
                <span>阅读块</span>
              </div>
              <div>
                <strong>{readingStats.limitation}</strong>
                <span>局限</span>
              </div>
            </div>
          </section>

          <section className="reading-surface">
            {visibleSegments.length ? (
              visibleSegments.map((segment) => {
                const highlights = tagMap[segment.id] || []
                return (
                  <article key={segment.id} className={`reading-block ${highlights.length ? 'has-highlight' : ''}`}>
                    <div className="reading-meta">
                      <span>{segment.id}</span>
                      <span>Page {segment.page}</span>
                    </div>
                    <div className="reading-text">{segment.text}</div>
                    <div className={`reading-translation ${readerMode === 'translated' ? 'active' : ''}`}>
                      {readerMode === 'translated' ? segment.translation || '尚未翻译此段。' : '切换到“译文”模式可查看对应翻译。'}
                    </div>
                    {highlights.length ? (
                      <div className="highlight-list">
                        {highlights.map((item, idx) => (
                          <span key={`${item.segmentId}-${item.tag}-${idx}`} className={`tag tag-${item.tag}`} title={item.reason}>
                            {item.tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </article>
                )
              })
            ) : (
              <div className="empty-state">
                <h3>还没有论文内容</h3>
                <p>先上传 PDF 或导入链接。导入后，这里会变成你的主阅读区。</p>
              </div>
            )}
          </section>
        </main>

        <aside className="right-rail">
          <section className="soft-panel action-panel">
            <h2>AI 助读</h2>
            <button onClick={runSummaryAndHighlights} disabled={!fullText || !settings.apiKey}>
              生成摘要 + 高亮
            </button>
            <button className="secondary" onClick={translateVisibleSegments} disabled={!visibleSegments.length || !settings.apiKey}>
              翻译当前视图
            </button>
          </section>

          <section className="soft-panel insight-panel">
            <div className="section-title-row">
              <h2>摘要与洞察</h2>
              <span className="subtle-label">{analysis.length ? `${analysis.length} 条结构化标记` : '待生成'}</span>
            </div>
            <div className="summary-box">{summary || '这里会显示论文摘要、核心结论和结构化洞察。'}</div>
            <div className="tag-stats">
              <span className="tag tag-novelty">创新 {readingStats.novelty}</span>
              <span className="tag tag-method">方法 {readingStats.method}</span>
              <span className="tag tag-result">结果 {readingStats.result}</span>
              <span className="tag tag-limitation">局限 {readingStats.limitation}</span>
            </div>
          </section>

          <section className="soft-panel qa-panel">
            <div className="section-title-row">
              <h2>基于论文问答</h2>
              <span className="subtle-label">只基于当前导入内容</span>
            </div>
            <textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="例如：这篇论文的方法核心创新是什么？" />
            <button onClick={askQuestion} disabled={!question || !settings.apiKey || !fullText}>
              提问
            </button>
            <div className="output-box">{answer || '问题答案会显示在这里。'}</div>
            {!!qaHistory.length && (
              <div className="qa-history">
                <div className="subtle-label">最近问答</div>
                {qaHistory.map((item) => (
                  <details key={item.id}>
                    <summary>{item.question}</summary>
                    <div className="output-box">{item.answer}</div>
                  </details>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>

      {busy ? <div className="status-banner">{busy}</div> : null}
      {progress ? <div className="status-banner">{progress}</div> : null}
      {error ? <div className="status-banner error">{error}</div> : null}
    </div>
  )
}

export default App
