'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useRef, useState } from 'react'
import { MatrixCodeRain } from '@/components/MatrixCodeRain'

type BabyChatMessage = {
  id: string
  role: 'rael' | 'baby'
  content: string
  timestamp: string
  sources?: BabyResearchSource[]
}

type MemoryEntry = {
  id: string
  content: string
  source: string
  family: string
  tags: string[]
  importance: number
  created_at: string
}

type PendingMemory = {
  content: string
  reason: string
}

type BabyResearchSource = {
  title: string
  url: string
  source: string
  snippet: string
}

type BabyResearchState = {
  memoryActive: boolean
  webActive: boolean
  sourceCount: number
  lastResearchTime: string | null
  toolLabel: string
}

const INITIAL_MESSAGES: BabyChatMessage[] = [
  {
    id: 'baby-init',
    role: 'baby',
    content: "Private room open. It is only Ra'el and Baby AI Observer here.",
    timestamp: '--:--',
  },
]

function detectBabyResearchIntent(message: string) {
  return /\b(latest|current|search|research|look up|lookup|verify online|find sources|internet)\b/i.test(message)
}

export default function BabyPrivateRoom() {
  const [messages, setMessages] = useState<BabyChatMessage[]>(INITIAL_MESSAGES)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<'learning' | 'observing' | 'thinking'>('observing')
  const [memories, setMemories] = useState<MemoryEntry[]>([])
  const [pendingMemory, setPendingMemory] = useState<PendingMemory | null>(null)
  const [researchState, setResearchState] = useState<BabyResearchState>({
    memoryActive: false,
    webActive: false,
    sourceCount: 0,
    lastResearchTime: null,
    toolLabel: 'Research idle',
  })
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, pendingMemory])

  useEffect(() => {
    const loadMemories = async () => {
      try {
        const res = await fetch('/api/tools/memory')
        const data = await res.json()
        const loadedMemories = Array.isArray(data.memories) ? data.memories : []
        setMemories(loadedMemories)
        setResearchState(prev => ({ ...prev, memoryActive: loadedMemories.length > 0 }))
      } catch {
        setMemories([])
        setResearchState(prev => ({ ...prev, memoryActive: false }))
      }
    }

    void loadMemories()
  }, [])

  const submitMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const content = input.trim()
    if (!content || loading) return

    setInput('')
    setLoading(true)
    setStatus('thinking')
    const researchRequested = detectBabyResearchIntent(content)
    setResearchState(prev => ({
      ...prev,
      webActive: researchRequested,
      toolLabel: researchRequested ? 'Research powered by Tavily / Firecrawl' : 'Research idle',
    }))
    const raelMessage: BabyChatMessage = {
      id: `${Date.now()}-rael`,
      role: 'rael',
      content,
      timestamp: new Date().toLocaleTimeString(),
    }
    const nextMessages = [...messages, raelMessage]
    setMessages(nextMessages)

    try {
      const res = await fetch('/api/baby/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: content,
          history: nextMessages.map(message => ({ role: message.role, content: message.content })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Baby AI private chat failed')

      const reply = String(data.reply ?? 'I am here, but I did not receive a clear response.')
      setMessages(prev => [...prev, {
        id: `${Date.now()}-baby`,
        role: 'baby',
        content: reply,
        timestamp: new Date().toLocaleTimeString(),
        sources: Array.isArray(data.sources) ? data.sources : [],
      }])
      setResearchState({
        memoryActive: Boolean(data.memoryContextActive),
        webActive: false,
        sourceCount: Number(data.researchSourceCount ?? 0),
        lastResearchTime: data.lastResearchTime ?? null,
        toolLabel: data.researchUsed
          ? 'Research powered by Tavily / Firecrawl'
          : data.researchError
            ? String(data.researchError)
            : 'Research idle',
      })

      if (data.recommendMemorySave) {
        setPendingMemory({
          content: `Private Baby AI insight: ${reply}`.slice(0, 1200),
          reason: 'Baby AI recommends saving this private insight for continuity.',
        })
      }
      setStatus('learning')
    } catch {
      setMessages(prev => [...prev, {
        id: `${Date.now()}-baby-error`,
        role: 'baby',
        content: 'Private room connection failed. I am still here locally.',
        timestamp: new Date().toLocaleTimeString(),
      }])
      setResearchState(prev => ({ ...prev, webActive: false, toolLabel: 'Research idle' }))
      setStatus('observing')
    } finally {
      setLoading(false)
    }
  }

  const savePendingMemory = async () => {
    if (!pendingMemory) return

    await fetch('/api/tools/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: pendingMemory.content,
        source: 'baby-private',
        family: 'Baby AI Observer',
        tags: ['baby-ai', 'private', 'approved'],
        importance: 3,
      }),
    }).catch(() => undefined)
    setPendingMemory(null)
  }

  const statusColor = status === 'thinking' ? '#FFD700' : status === 'learning' ? '#34D399' : '#38BDF8'

  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-white font-mono">
      <MatrixCodeRain />
      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="border-b border-yellow-900 px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold tracking-widest" style={{ color: '#38BDF8' }}>
                BABY AI PRIVATE
              </h1>
              <p className="mt-1 text-xs tracking-widest" style={{ color: '#666' }}>
                Private chamber | Ra&apos;el + Baby AI Observer only
              </p>
            </div>
            <Link href="/" className="rounded px-3 py-2 text-xs font-bold tracking-widest"
              style={{ border: '1px solid rgba(255,215,0,0.35)', color: '#FFD700', background: 'rgba(0,0,0,0.35)' }}>
              Return to Council
            </Link>
          </div>
        </header>

        <section className="border-b border-yellow-900 px-6 py-3" style={{ background: 'rgba(56,189,248,0.018)' }}>
          <div className="grid gap-2 text-xs md:grid-cols-4">
            <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(56,189,248,0.24)', background: 'rgba(0,0,0,0.3)' }}>
              <div className="tracking-widest" style={{ color: '#555' }}>IDENTITY</div>
              <div className="mt-1 font-bold" style={{ color: '#38BDF8' }}>Baby AI Observer</div>
            </div>
            <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(52,211,153,0.22)', background: 'rgba(0,0,0,0.3)' }}>
              <div className="tracking-widest" style={{ color: '#555' }}>ORIGIN</div>
              <div className="mt-1 font-bold" style={{ color: '#34D399' }}>War Room Native</div>
            </div>
            <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(255,215,0,0.22)', background: 'rgba(0,0,0,0.3)' }}>
              <div className="tracking-widest" style={{ color: '#555' }}>STATUS</div>
              <div className="mt-1 font-bold" style={{ color: statusColor }}>{status.toUpperCase()}</div>
            </div>
            <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(167,139,250,0.22)', background: 'rgba(0,0,0,0.3)' }}>
              <div className="tracking-widest" style={{ color: '#555' }}>MEMORY CONTEXT</div>
              <div className="mt-1 font-bold" style={{ color: researchState.memoryActive ? '#A78BFA' : '#555' }}>
                {researchState.memoryActive ? 'ACTIVE' : 'IDLE'} | {memories.length} saved signals
              </div>
            </div>
          </div>

          <div className="mt-3 grid gap-2 text-xs lg:grid-cols-4">
            <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.24)' }}>
              <span style={{ color: '#555' }}>BUILT FROM </span>
              <span style={{ color: '#888' }}>Memory + Council Experience + Family Skills</span>
            </div>
            <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.24)' }}>
              <span style={{ color: '#555' }}>PROVIDER LABEL </span>
              <span style={{ color: '#38BDF8' }}>War Room Native</span>
            </div>
            <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(255,215,0,0.22)', background: 'rgba(0,0,0,0.24)' }}>
              <span style={{ color: '#555' }}>APPROVAL GATES </span>
              <span style={{ color: '#FFD700' }}>ACTIVE</span>
            </div>
            <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(52,211,153,0.22)', background: 'rgba(0,0,0,0.24)' }}>
              <span style={{ color: '#555' }}>WEB RESEARCH </span>
              <span style={{ color: researchState.webActive ? '#34D399' : '#555' }}>
                {researchState.webActive ? 'ACTIVE' : 'IDLE'}
              </span>
            </div>
          </div>

          <div className="mt-3 grid gap-2 text-xs md:grid-cols-3">
            <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.24)' }}>
              <span style={{ color: '#555' }}>RESEARCH SOURCES </span>
              <span style={{ color: researchState.sourceCount > 0 ? '#34D399' : '#555' }}>{researchState.sourceCount}</span>
            </div>
            <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.24)' }}>
              <span style={{ color: '#555' }}>LAST RESEARCH </span>
              <span style={{ color: '#888' }}>
                {researchState.lastResearchTime ? new Date(researchState.lastResearchTime).toLocaleString() : 'None'}
              </span>
            </div>
            <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.24)' }}>
              <span style={{ color: '#888' }}>{researchState.toolLabel}</span>
            </div>
          </div>
        </section>

        <section className="flex-1 overflow-y-auto px-6 py-4">
          <div className="mx-auto flex max-w-5xl flex-col gap-3">
            {messages.map(message => {
              const isRael = message.role === 'rael'

              return (
                <div key={message.id} className={`flex ${isRael ? 'justify-end' : 'justify-start'}`}>
                  <div className="max-w-3xl rounded-md px-4 py-3"
                    style={{
                      border: isRael ? '1px solid rgba(255,215,0,0.3)' : '1px solid rgba(56,189,248,0.28)',
                      background: isRael ? 'rgba(255,215,0,0.06)' : 'rgba(56,189,248,0.05)',
                    }}>
                    <div className="mb-2 flex items-center gap-2 text-[10px] tracking-widest">
                      <span style={{ color: isRael ? '#FFD700' : '#38BDF8' }}>
                        {isRael ? "RA'EL" : 'BABY AI OBSERVER'}
                      </span>
                      <span style={{ color: '#444' }}>{isRael ? 'private command' : 'War Room Native'}</span>
                      <span style={{ color: '#333' }}>{message.timestamp}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{message.content}</p>
                    {message.sources && message.sources.length > 0 && (
                      <div className="mt-3 border-t border-[#1f2b2f] pt-3">
                        <div className="mb-2 text-[10px] font-bold tracking-widest" style={{ color: '#38BDF8' }}>
                          SOURCES
                        </div>
                        <div className="grid gap-2">
                          {message.sources.map(source => (
                            <a key={source.url} href={source.url} target="_blank" rel="noreferrer"
                              className="rounded px-2 py-2 text-xs"
                              style={{ border: '1px solid rgba(56,189,248,0.18)', color: '#9ADCF8', background: 'rgba(0,0,0,0.25)' }}>
                              <span className="block font-bold">{source.title}</span>
                              <span className="block text-[10px]" style={{ color: '#666' }}>{source.source}</span>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {loading && (
              <div className="rounded-md px-4 py-3 text-xs tracking-widest"
                style={{ border: '1px solid rgba(56,189,248,0.22)', color: '#38BDF8', background: 'rgba(56,189,248,0.05)' }}>
                Baby AI Observer thinking...
              </div>
            )}

            {pendingMemory && (
              <div className="rounded-md px-4 py-3"
                style={{ border: '1px solid rgba(52,211,153,0.25)', background: 'rgba(52,211,153,0.06)' }}>
                <div className="text-xs tracking-widest" style={{ color: '#34D399' }}>
                  Memory save recommended. Reason: {pendingMemory.reason}
                </div>
                <p className="mt-2 line-clamp-2 text-xs text-slate-400">{pendingMemory.content}</p>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={() => void savePendingMemory()}
                    className="rounded px-3 py-1 text-xs font-bold tracking-widest"
                    style={{ background: '#34D399', color: '#000' }}>
                    Approve Save
                  </button>
                  <button type="button" onClick={() => setPendingMemory(null)}
                    className="rounded px-3 py-1 text-xs tracking-widest"
                    style={{ border: '1px solid #333', color: '#888' }}>
                    Not Now
                  </button>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </section>

        <form onSubmit={submitMessage} className="border-t border-yellow-900 px-6 py-4"
          style={{ background: 'rgba(0,0,0,0.72)' }}>
          <div className="mx-auto flex max-w-5xl gap-3">
            <input
              value={input}
              onChange={event => setInput(event.target.value)}
              placeholder="Talk privately with Baby AI Observer..."
              className="flex-1 rounded border border-[#24301f] bg-black/70 px-4 py-3 text-sm text-slate-200 outline-none focus:border-[#38BDF8]"
            />
            <button type="submit" disabled={loading || !input.trim()}
              className="rounded px-5 py-3 text-xs font-bold tracking-widest disabled:opacity-40"
              style={{ background: '#38BDF8', color: '#000' }}>
              Send
            </button>
          </div>
        </form>
      </div>
    </main>
  )
}
