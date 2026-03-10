import { useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import './App.css'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

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
    label: 'SiliconFlow (OpenAI API)',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-72B-Instruct',
  },
]

const SETTINGS_KEY = 'paper-moonlight-h5-settings'

const defaultSettings = {
  baseUrl: providerPresets[0].baseUrl,
  apiKey: '',
  model: providerPresets[0].model,
  systemPrompt:
    'You are a careful paper reading assistant. Always ground your answer in the provided paper text. If evidence is weak, say so.',
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
  const [settings, setSettings] = useState(() => {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? { ...defaultSettings, ...JSON.parse(raw) } : defaultSettings
  })
  const [pdfName, setPdfName] = useState('')
  const [pdfUrl, setPdfUrl] = useState('')
  const [pageCount, setPageCount] = useState(0)
  const [fullText, setFullText] = useState('')
  const [segments, setSegments] = useState<Segment[]>([])
  const [summary, setSummary] = useState('')
  const [analysis, setAnalysis] = useState<HighlightItem[]>([])
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [selectedPage, setSelectedPage] = useState<number | 'all'>('all')
  const [busy, setBusy] = useState<string>('')
  const [error, setError] = useState('')
  const [readerMode, setReaderMode] = useState<'original' | 'translated'>('original')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  }, [settings])

  const visibleSegments = useMemo(() => {
    if (selectedPage === 'all') return segments
    return segments.filter((segment) => segment.page === selectedPage)
  }, [segments, selectedPage])

  const tagMap = useMemo(() => {
    return analysis.reduce<Record<string, HighlightItem[]>>((acc, item) => {
      acc[item.segmentId] ??= []
      acc[item.segmentId].push(item)
      return acc
    }, {})
  }, [analysis])

  async function handlePdfBuffer(buffer: ArrayBuffer, name: string) {
    try {
      setBusy('正在解析 PDF...')
      setError('')
      const parsed = await extractPdfSegments(buffer)
      setPdfName(name)
      setPageCount(parsed.pageCount)
      setFullText(parsed.fullText)
      setSegments(parsed.segments)
      setSummary('')
      setAnalysis([])
      setAnswer('')
      setSelectedPage('all')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF 解析失败')
    } finally {
      setBusy('')
    }
  }

  async function onUploadFile(file: File) {
    const buffer = await file.arrayBuffer()
    await handlePdfBuffer(buffer, file.name)
  }

  async function onLoadFromUrl() {
    if (!pdfUrl.trim()) return
    try {
      setBusy('正在下载 PDF...')
      setError('')
      const resp = await fetch(pdfUrl)
      if (!resp.ok) throw new Error(`PDF 下载失败：${resp.status}`)
      const buffer = await resp.arrayBuffer()
      await handlePdfBuffer(buffer, pdfUrl)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'URL 加载失败')
      setBusy('')
    }
  }

  async function runSummaryAndHighlights() {
    if (!fullText) return
    try {
      setBusy('正在生成摘要与高亮...')
      setError('')
      const subset = segments.slice(0, 80).map((segment) => ({
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
    } catch (e) {
      setError(e instanceof Error ? e.message : '摘要分析失败')
    } finally {
      setBusy('')
    }
  }

  async function translateVisibleSegments() {
    if (!visibleSegments.length) return
    try {
      setBusy('正在翻译当前视图...')
      setError('')
      const payload = visibleSegments.slice(0, 24).map(({ id, text }) => ({ id, text }))
      const content = await callModel({
        ...settings,
        messages: [
          {
            role: 'user',
            content:
              'Translate the following paper passages into Chinese. Return JSON array [{id, translation}] and keep technical terms accurate. ' +
              JSON.stringify(payload),
          },
        ],
      })
      const parsed = JSON.parse(normalizeJsonBlock(content)) as Array<{ id: string; translation: string }>
      const translatedMap = Object.fromEntries(parsed.map((item) => [item.id, item.translation]))
      setSegments((prev) =>
        prev.map((segment) =>
          translatedMap[segment.id]
            ? { ...segment, translation: translatedMap[segment.id] }
            : segment,
        ),
      )
      setReaderMode('translated')
    } catch (e) {
      setError(e instanceof Error ? e.message : '翻译失败')
    } finally {
      setBusy('')
    }
  }

  async function askQuestion() {
    if (!question.trim() || !fullText) return
    try {
      setBusy('正在回答问题...')
      setError('')
      const context = segments.slice(0, 120).map((s) => `[${s.id}] ${s.text}`).join('\n')
      const content = await callModel({
        ...settings,
        messages: [
          {
            role: 'user',
            content:
              'Answer only using the paper text. Cite useful segment ids in brackets when possible.\n\n' +
              `Paper text:\n${context}\n\nQuestion: ${question}`,
          },
        ],
      })
      setAnswer(content)
    } catch (e) {
      setError(e instanceof Error ? e.message : '问答失败')
    } finally {
      setBusy('')
    }
  }

  const stats = useMemo(() => {
    const novelty = analysis.filter((item) => item.tag === 'novelty').length
    const method = analysis.filter((item) => item.tag === 'method').length
    const result = analysis.filter((item) => item.tag === 'result').length
    const limitation = analysis.filter((item) => item.tag === 'limitation').length
    return { novelty, method, result, limitation }
  }, [analysis])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="panel">
          <h1>Paper Moonlight H5</h1>
          <p className="muted">纯前端论文阅读器：PDF 解析、对照翻译、摘要、高亮、问答，全程浏览器直连模型。</p>
        </div>

        <div className="panel">
          <h2>模型配置</h2>
          <div className="preset-list">
            {providerPresets.map((preset) => (
              <button
                key={preset.id}
                className="chip"
                onClick={() =>
                  setSettings((prev: typeof defaultSettings) => ({
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
              onChange={(e) => setSettings((prev: typeof defaultSettings) => ({ ...prev, baseUrl: e.target.value }))}
              placeholder="https://api.openai.com/v1"
            />
          </label>
          <label>
            Model
            <input
              value={settings.model}
              onChange={(e) => setSettings((prev: typeof defaultSettings) => ({ ...prev, model: e.target.value }))}
              placeholder="gpt-4.1-mini"
            />
          </label>
          <label>
            API Key
            <input
              type="password"
              value={settings.apiKey}
              onChange={(e) => setSettings((prev: typeof defaultSettings) => ({ ...prev, apiKey: e.target.value }))}
              placeholder="sk-..."
            />
          </label>
        </div>

        <div className="panel">
          <h2>导入 PDF</h2>
          <button onClick={() => fileInputRef.current?.click()}>上传 PDF</button>
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
          <label>
            PDF URL
            <input value={pdfUrl} onChange={(e) => setPdfUrl(e.target.value)} placeholder="https://.../paper.pdf" />
          </label>
          <button className="secondary" onClick={onLoadFromUrl}>从链接加载</button>
          {pdfName ? <p className="muted">当前文档：{pdfName}</p> : null}
          {pageCount ? <p className="muted">页数：{pageCount} · 文本块：{segments.length}</p> : null}
        </div>

        <div className="panel">
          <h2>AI 操作</h2>
          <button onClick={runSummaryAndHighlights} disabled={!fullText || !settings.apiKey}>生成摘要 + 高亮</button>
          <button className="secondary" onClick={translateVisibleSegments} disabled={!visibleSegments.length || !settings.apiKey}>
            翻译当前视图
          </button>
          <div className="inline-actions">
            <button className={readerMode === 'original' ? 'active-tab' : ''} onClick={() => setReaderMode('original')}>原文</button>
            <button className={readerMode === 'translated' ? 'active-tab' : ''} onClick={() => setReaderMode('translated')}>译文</button>
          </div>
          <div className="tag-stats">
            <span>独创性 {stats.novelty}</span>
            <span>方法 {stats.method}</span>
            <span>结果 {stats.result}</span>
            <span>局限 {stats.limitation}</span>
          </div>
        </div>
      </aside>

      <main className="content">
        <section className="top-grid">
          <div className="panel large-panel">
            <div className="section-header">
              <h2>对照阅读</h2>
              <select value={selectedPage} onChange={(e) => setSelectedPage(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
                <option value="all">全部页面</option>
                {Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => (
                  <option key={page} value={page}>第 {page} 页</option>
                ))}
              </select>
            </div>
            <div className="reader-grid">
              {visibleSegments.map((segment) => {
                const highlights = tagMap[segment.id] || []
                return (
                  <article key={segment.id} className="segment-card">
                    <div className="segment-meta">
                      <span>{segment.id}</span>
                      <span>Page {segment.page}</span>
                    </div>
                    <p>{segment.text}</p>
                    <div className="translation-box">
                      {readerMode === 'translated' ? segment.translation || '尚未翻译此段。' : segment.text}
                    </div>
                    {highlights.length ? (
                      <div className="highlight-list">
                        {highlights.map((item) => (
                          <span key={`${item.segmentId}-${item.tag}`} className={`tag tag-${item.tag}`} title={item.reason}>
                            {item.tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </article>
                )
              })}
            </div>
          </div>

          <div className="side-stack">
            <div className="panel">
              <h2>摘要</h2>
              <div className="output-box">{summary || '先导入 PDF，再点击“生成摘要 + 高亮”。'}</div>
            </div>
            <div className="panel">
              <h2>基于 PDF 问答</h2>
              <textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="例如：这篇论文的方法核心创新是什么？" />
              <button onClick={askQuestion} disabled={!question || !settings.apiKey || !fullText}>提问</button>
              <div className="output-box">{answer || '问题答案会显示在这里。'}</div>
            </div>
          </div>
        </section>

        {busy ? <div className="status-banner">{busy}</div> : null}
        {error ? <div className="status-banner error">{error}</div> : null}
      </main>
    </div>
  )
}

export default App
