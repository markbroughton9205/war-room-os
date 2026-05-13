'use client'

import { useState, useRef, useEffect } from 'react'

const RAEL_PROFILE = `Commander: Ra'el (Mark Broughton). Mission: generational wealth and sovereignty. Philosophy: Nation of Islam economic self-determination, Black ownership, ancestral wisdom. Businesses: Higher Vision Inc, Broughton Transports LLC, RUAH patent. Family: Jasmine, seven children. Goal: Panama relocation. Motivated by vision of success. Wants truth about systems that harm Black and low income communities.`

type CouncilMessage = {
  id: string
  familyName: string
  content: string
  timestamp: string
  color: string
  icon: string
  provider: string
  messageType: string
}

type ToneMode = 'casual' | 'build' | 'business' | 'debate' | 'reflection'
type TypingFamily = 'CHATGPT FAMILY' | 'CLAUDE FAMILY'
type ToolName = 'Web' | 'Memory' | 'Files' | 'Research' | 'Repo' | 'Deployments'

const FAMILY_META: Record<TypingFamily, { color: string; icon: string }> = {
  'CHATGPT FAMILY': { color: '#34D399', icon: '🧠' },
  'CLAUDE FAMILY': { color: '#A78BFA', icon: '🔮' },
}

const TOOL_NAMES: ToolName[] = ['Web', 'Memory', 'Files', 'Research', 'Repo', 'Deployments']

function detectToneMode(message: string): ToneMode {
  const text = message.toLowerCase()

  if (/\b(build|code|bug|fix|debug|implement|component|api|route|database|deploy|typescript|react|next)\b/.test(text)) {
    return 'build'
  }

  if (/\b(revenue|business|client|customer|market|sales|pricing|profit|contract|proposal|investor|strategy)\b/.test(text)) {
    return 'business'
  }

  if (/\b(debate|argue|challenge|push back|red team|prove|disagree|versus|vs\.?)\b/.test(text)) {
    return 'debate'
  }

  if (/\b(reflect|meaning|feel|feeling|family|purpose|spirit|lesson|truth|remember|why am i|what am i)\b/.test(text)) {
    return 'reflection'
  }

  return 'casual'
}

const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms))

function MessageBubble({ msg }: { msg: CouncilMessage }) {
  const isRael = msg.familyName === "RA'EL"
  return (
    <div className={`message-fade-in flex items-start gap-3 mb-4 ${isRael ? 'flex-row-reverse' : ''}`}>
      <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm"
        style={{ background: msg.color + '22', border: `1px solid ${msg.color}40` }}>
        {msg.icon}
      </div>
      <div className={`flex-1 max-w-2xl ${isRael ? 'items-end' : 'items-start'} flex flex-col`}>
        <div className={`flex items-center gap-2 mb-1 ${isRael ? 'flex-row-reverse' : ''}`}>
          <span className="text-xs font-bold tracking-widest" style={{ color: msg.color }}>{msg.familyName}</span>
          {msg.provider && <span className="text-xs" style={{ color: '#444' }}>{msg.provider}</span>}
          <span className="text-xs" style={{ color: '#333' }}>{msg.timestamp}</span>
          <span className="text-xs px-1 rounded" style={{ color: '#555', background: '#111' }}>{msg.messageType}</span>
        </div>
        <div className="rounded-lg p-3 text-sm text-gray-300 whitespace-pre-wrap"
          style={{
            background: isRael ? '#1a1500' : 'rgba(255,255,255,0.03)',
            borderLeft: isRael ? 'none' : `2px solid ${msg.color}`,
            borderRight: isRael ? `2px solid ${msg.color}` : 'none',
          }}>
          {msg.content}
        </div>
      </div>
    </div>
  )
}

function TypingIndicator({ familyName }: { familyName: TypingFamily }) {
  const family = FAMILY_META[familyName]

  return (
    <div className="flex items-center gap-3 ml-11 mb-4 message-fade-in">
      <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm"
        style={{ background: family.color + '22', border: `1px solid ${family.color}40` }}>
        {family.icon}
      </div>
      <div className="flex items-center gap-2 rounded px-3 py-2"
        style={{ background: 'rgba(255,255,255,0.03)', borderLeft: `2px solid ${family.color}` }}>
        <span className="text-xs font-bold tracking-widest" style={{ color: family.color }}>
          {familyName} TYPING
        </span>
        <span className="typing-dot" style={{ background: family.color }} />
        <span className="typing-dot" style={{ background: family.color, animationDelay: '120ms' }} />
        <span className="typing-dot" style={{ background: family.color, animationDelay: '240ms' }} />
      </div>
    </div>
  )
}

function ToolStatusPanel({ activeTools }: { activeTools: ToolName[] }) {
  return (
    <div className="border-b border-yellow-900 px-6 py-2 flex-shrink-0"
      style={{ background: 'rgba(255,215,0,0.02)' }}>
      <div className="flex items-center gap-2 overflow-x-auto">
        {TOOL_NAMES.map(tool => {
          const active = activeTools.includes(tool)

          return (
            <div key={tool}
              className="flex items-center gap-2 rounded px-3 py-2 text-xs tracking-widest whitespace-nowrap"
              style={{
                border: active ? '1px solid rgba(52,211,153,0.45)' : '1px solid #222',
                color: active ? '#34D399' : '#555',
                background: active ? 'rgba(52,211,153,0.08)' : 'rgba(255,255,255,0.02)',
              }}>
              <span className={active ? 'tool-dot-active' : ''}
                style={{
                  width: '0.45rem',
                  height: '0.45rem',
                  borderRadius: '9999px',
                  background: active ? '#34D399' : '#333',
                  boxShadow: active ? '0 0 8px rgba(52,211,153,0.8)' : 'none',
                }} />
              <span>{tool}</span>
              <span style={{ color: active ? '#7ee7b7' : '#333' }}>
                {active ? 'SCANNING' : 'IDLE'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function Home() {
  const [command, setCommand] = useState('')
  const [messages, setMessages] = useState<CouncilMessage[]>([{
    id: '0',
    familyName: 'SYSTEM',
    content: "War Room initialized. Claude and ChatGPT Family present. Speak your decree, Ra'el.",
    timestamp: '--:--',
    color: '#FFD700',
    icon: '⚔',
    provider: '',
    messageType: 'system'
  }])
  const [loading, setLoading] = useState(false)
  const [showContinue, setShowContinue] = useState(false)
  const [discussionSeconds, setDiscussionSeconds] = useState(90)
  const [typingFamily, setTypingFamily] = useState<TypingFamily | null>(null)
  const [activeTools, setActiveTools] = useState<ToolName[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!showContinue || loading || discussionSeconds === 0) return

    const timer = window.setInterval(() => {
      setDiscussionSeconds(prev => Math.max(prev - 1, 0))
    }, 1000)

    return () => window.clearInterval(timer)
  }, [showContinue, loading, discussionSeconds])

  const formatDiscussionTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60).toString().padStart(2, '0')
    const remainingSeconds = (seconds % 60).toString().padStart(2, '0')
    return `${minutes}:${remainingSeconds}`
  }

  const addMessages = (newMsgs: CouncilMessage[]) => {
    setMessages(prev => [...prev, ...newMsgs])
  }

  const addSystemMessage = (content: string) => {
    addMessages([{
      id: Date.now() + '-system',
      familyName: 'SYSTEM',
      content,
      timestamp: new Date().toLocaleTimeString(),
      color: '#FFD700',
      icon: '⚙',
      provider: '',
      messageType: 'system'
    }])
  }

  const revealFamilyMessages = async (data: { chatgpt?: string; claude?: string }) => {
    const now = new Date().toLocaleTimeString()

    if (data.chatgpt) {
      setTypingFamily('CHATGPT FAMILY')
      await wait(450)
      addMessages([{
        id: Date.now() + '-gpt',
        familyName: 'CHATGPT FAMILY',
        content: data.chatgpt,
        timestamp: now,
        color: FAMILY_META['CHATGPT FAMILY'].color,
        icon: FAMILY_META['CHATGPT FAMILY'].icon,
        provider: 'OpenAI · gpt-4o',
        messageType: 'response'
      }])
      setTypingFamily(null)
      await wait(350)
      addSystemMessage('Retrieval complete')
      setActiveTools([])
      await wait(350)
    }

    if (data.claude) {
      setTypingFamily('CLAUDE FAMILY')
      await wait(650)
      addMessages([{
        id: Date.now() + '-claude',
        familyName: 'CLAUDE FAMILY',
        content: data.claude,
        timestamp: now,
        color: FAMILY_META['CLAUDE FAMILY'].color,
        icon: FAMILY_META['CLAUDE FAMILY'].icon,
        provider: 'Anthropic · claude-sonnet',
        messageType: 'response'
      }])
      setTypingFamily(null)
    }
  }

  const submitDecree = async (decree: string, mode?: string) => {
    setLoading(true)
    setTypingFamily('CHATGPT FAMILY')
    setActiveTools(['Web', 'Research'])
    addSystemMessage('Web Research initiated')

    const threadHistory = messages.map(m => ({ sender: m.familyName, content: m.content }))
    const toneMode = detectToneMode(decree)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: decree, profile: RAEL_PROFILE, threadHistory, mode, toneMode })
      })
      const data = await res.json()
      await revealFamilyMessages(data)
      if (data.showContinue) {
        setDiscussionSeconds(90)
        setShowContinue(true)
      } else {
        setShowContinue(false)
      }
    } catch {
      setShowContinue(false)
      setTypingFamily(null)
      setActiveTools([])
      addMessages([{
        id: Date.now() + '-err',
        familyName: 'SYSTEM',
        content: 'Council unreachable.',
        timestamp: new Date().toLocaleTimeString(),
        color: '#EF4444',
        icon: '⚠',
        provider: '',
        messageType: 'system'
      }])
    } finally {
      setTypingFamily(null)
      setActiveTools([])
      setLoading(false)
    }
  }

  const handleSubmit = async () => {
    if (!command.trim() || loading) return
    const decree = command.trim()
    setCommand('')

    addMessages([{
      id: Date.now() + '-rael',
      familyName: "RA'EL",
      content: decree,
      timestamp: new Date().toLocaleTimeString(),
      color: '#FFD700',
      icon: '⚔',
      provider: '',
      messageType: 'decree'
    }])

    await submitDecree(decree)
  }

  const handleContinue = async () => {
    await submitDecree('continue council discussion', 'continue')
  }

  const handleSummarize = async () => {
    await submitDecree('summarize council discussion', 'summarize')
  }

  return (
    <main className="min-h-screen bg-black text-white flex flex-col font-mono">
      <style>{`
        .message-fade-in {
          animation: message-fade-in 220ms ease-out;
        }

        .typing-dot {
          width: 0.375rem;
          height: 0.375rem;
          border-radius: 9999px;
          animation: typing-dot 900ms ease-in-out infinite;
        }

        .tool-dot-active {
          animation: tool-dot-pulse 900ms ease-in-out infinite;
        }

        @keyframes message-fade-in {
          from {
            opacity: 0;
            transform: translateY(4px);
          }

          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes typing-dot {
          0%, 80%, 100% {
            opacity: 0.35;
            transform: translateY(0);
          }

          40% {
            opacity: 1;
            transform: translateY(-3px);
          }
        }

        @keyframes tool-dot-pulse {
          0%, 100% {
            opacity: 0.5;
            transform: scale(0.85);
          }

          50% {
            opacity: 1;
            transform: scale(1.2);
          }
        }
      `}</style>
      <div className="border-b border-yellow-900 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold tracking-widest" style={{ color: '#FFD700' }}>⚔ WAR ROOM</h1>
          <p className="text-xs tracking-widest" style={{ color: '#444' }}>RA&apos;EL — HIGHER VISION INC</p>
        </div>
        <div className="flex gap-4">
          {['CLAUDE', 'CHATGPT', 'GROK', 'GEMINI', 'RED TEAM'].map(f => (
            <div key={f} className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full" style={{ background: '#00ff41', boxShadow: '0 0 4px #00ff41' }} />
              <span className="text-xs" style={{ color: '#444' }}>{f}</span>
            </div>
          ))}
        </div>
      </div>

      <ToolStatusPanel activeTools={activeTools} />

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)}

        {typingFamily && <TypingIndicator familyName={typingFamily} />}

        {showContinue && (
          <div className="flex items-center gap-3 ml-11 mb-4 p-3 rounded"
            style={{ background: 'rgba(255,215,0,0.05)', border: '1px solid #3a2e00' }}>
            <span className="text-xs tracking-widest" style={{ color: '#888' }}>
              COUNCIL DISCUSSION ACTIVE — {formatDiscussionTime(discussionSeconds)} REMAINING
            </span>
            {discussionSeconds === 0 && !loading && (
              <>
                <button onClick={handleContinue}
                  className="text-xs px-3 py-1 rounded tracking-widest"
                  style={{ background: '#FFD700', color: '#000', fontWeight: 'bold' }}>
                  YES LET THEM TALK
                </button>
                <button onClick={() => setShowContinue(false)}
                  className="text-xs px-3 py-1 rounded tracking-widest"
                  style={{ border: '1px solid #333', color: '#666' }}>
                  NO
                </button>
                <button onClick={handleSummarize}
                  className="text-xs px-3 py-1 rounded tracking-widest"
                  style={{ border: '1px solid #FFD700', color: '#FFD700' }}>
                  SUMMARIZE NOW
                </button>
              </>
            )}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="border-t border-yellow-900 px-6 py-4 flex-shrink-0">
        <div className="flex items-center gap-3 p-3 rounded"
          style={{ background: 'rgba(255,215,0,0.03)', border: '1px solid #3a2e00' }}>
          <span style={{ color: '#FFD700' }}>⚔</span>
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !loading && handleSubmit()}
            placeholder="SPEAK YOUR DECREE, RA'EL..."
            className="flex-1 bg-transparent outline-none text-sm tracking-widest"
            style={{ color: '#FFD700', caretColor: '#FFD700' }}
            disabled={loading}
            autoFocus
          />
          <button onClick={handleSubmit} disabled={loading}
            className="px-4 py-1 text-xs tracking-widest rounded disabled:opacity-30"
            style={{ border: '1px solid #FFD700', color: '#FFD700', background: 'transparent' }}>
            {loading ? '...' : 'DECREE'}
          </button>
        </div>
      </div>
    </main>
  )
}
