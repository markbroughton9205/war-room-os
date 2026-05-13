'use client'

import { useState, useRef, useEffect } from 'react'
import { MatrixCodeRain } from '@/components/MatrixCodeRain'
import { TOOL_REGISTRY, type ToolId, type ToolStatus } from '@/lib/tools/toolRegistry'

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
type UsageFamily = 'Claude Family' | 'ChatGPT Family' | 'Kimi Family' | 'Grok Family' | 'Gemini Family'
type CouncilMode = 'continue' | 'expanded' | 'summarize'

type UsageEstimate = {
  familyName: UsageFamily
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  estimatedCost: number
  active: boolean
}

type ExpansionPrompt = {
  decree: string
  extraCost: number
  reason: string
  urgent: boolean
}

type ContinuationPrompt = {
  estimatedCost: number
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

const FAMILY_META: Record<TypingFamily, { color: string; icon: string }> = {
  'CHATGPT FAMILY': { color: '#34D399', icon: '🧠' },
  'CLAUDE FAMILY': { color: '#A78BFA', icon: '🔮' },
}

const DEFAULT_OUTPUT_TOKEN_BUDGET = 160
const EXPANDED_OUTPUT_TOKEN_BUDGET = 480
const DEFAULT_DISCUSSION_SECONDS = 90
const COUNCIL_CONTINUE_INTERVAL_MS = 22000
const BASE_USAGE_ROWS: UsageEstimate[] = [
  { familyName: 'Claude Family', provider: 'Anthropic', model: 'claude-sonnet-4-20250514', inputTokens: 0, outputTokens: 0, estimatedCost: 0, active: true },
  { familyName: 'ChatGPT Family', provider: 'OpenAI', model: 'gpt-4o', inputTokens: 0, outputTokens: 0, estimatedCost: 0, active: true },
  { familyName: 'Kimi Family', provider: 'Moonshot', model: 'placeholder', inputTokens: 0, outputTokens: 0, estimatedCost: 0, active: false },
  { familyName: 'Grok Family', provider: 'xAI', model: 'placeholder', inputTokens: 0, outputTokens: 0, estimatedCost: 0, active: false },
  { familyName: 'Gemini Family', provider: 'Google', model: 'placeholder', inputTokens: 0, outputTokens: 0, estimatedCost: 0, active: false },
]

const MOCK_RATES_PER_MILLION: Record<UsageFamily, { input: number; output: number }> = {
  'Claude Family': { input: 3, output: 15 },
  'ChatGPT Family': { input: 2.5, output: 10 },
  'Kimi Family': { input: 0, output: 0 },
  'Grok Family': { input: 0, output: 0 },
  'Gemini Family': { input: 0, output: 0 },
}

const INITIAL_TOOL_STATUSES = TOOL_REGISTRY.reduce((acc, tool) => {
  acc[tool.id] = tool.status
  return acc
}, {} as Record<ToolId, ToolStatus>)

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

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4))
}

function estimateFamilyCost(familyName: UsageFamily, inputTokens: number, outputTokens: number) {
  const rates = MOCK_RATES_PER_MILLION[familyName]
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000
}

function formatCost(cost: number) {
  return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`
}

function createUsageEstimate(inputText: string, outputBudget: number) {
  const inputTokens = estimateTokens(inputText)

  return BASE_USAGE_ROWS.map(row => {
    if (!row.active) return row

    return {
      ...row,
      inputTokens,
      outputTokens: outputBudget,
      estimatedCost: estimateFamilyCost(row.familyName, inputTokens, outputBudget),
    }
  })
}

function totalUsageCost(rows: UsageEstimate[]) {
  return rows.reduce((total, row) => total + row.estimatedCost, 0)
}

function detectExpansionNeed(message: string): Omit<ExpansionPrompt, 'decree'> | null {
  const text = message.toLowerCase()

  if (/\b(legal|lawsuit|medical|tax|financial risk|urgent|emergency|security breach|compliance)\b/.test(text)) {
    return {
      extraCost: totalUsageCost(createUsageEstimate(message, EXPANDED_OUTPUT_TOKEN_BUDGET)) - totalUsageCost(createUsageEstimate(message, DEFAULT_OUTPUT_TOKEN_BUDGET)),
      reason: 'high-stakes context benefits from a more careful pass',
      urgent: true,
    }
  }

  if (/\b(deep|deeper|detailed|long|comprehensive|full analysis|analyze fully|research deeply|break it all down)\b/.test(text)) {
    return {
      extraCost: totalUsageCost(createUsageEstimate(message, EXPANDED_OUTPUT_TOKEN_BUDGET)) - totalUsageCost(createUsageEstimate(message, DEFAULT_OUTPUT_TOKEN_BUDGET)),
      reason: 'the decree asks for expanded analysis',
      urgent: false,
    }
  }

  return null
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

function ToolStatusPanel({ toolStatuses }: { toolStatuses: Record<ToolId, ToolStatus> }) {
  return (
    <div className="border-b border-yellow-900 px-6 py-2 flex-shrink-0"
      style={{ background: 'rgba(255,215,0,0.02)' }}>
      <div className="flex items-center gap-2 overflow-x-auto">
        {TOOL_REGISTRY.map(tool => {
          const status = toolStatuses[tool.id] ?? tool.status
          const active = status !== 'idle'

          return (
            <div key={tool.id}
              className="flex items-center gap-2 rounded px-3 py-2 text-xs tracking-widest whitespace-nowrap"
              title={`${tool.description} Endpoint: ${tool.endpoint}${tool.requiresAuth ? ' Auth required.' : ''}`}
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
              <span>{tool.name}</span>
              <span style={{ color: active ? '#7ee7b7' : '#333' }}>
                {status.toUpperCase()}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TokenUsagePanel({
  rows,
  currentCost,
  sessionTotal,
}: {
  rows: UsageEstimate[]
  currentCost: number
  sessionTotal: number
}) {
  return (
    <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0"
      style={{ background: 'rgba(255,255,255,0.015)' }}>
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#FFD700' }}>TOKEN USAGE</h2>
          <p className="text-xs" style={{ color: '#555' }}>Mock estimates. Concise mode is default.</p>
        </div>
        <div className="flex gap-4 text-xs tracking-widest">
          <span style={{ color: '#888' }}>CURRENT {formatCost(currentCost)}</span>
          <span style={{ color: '#FFD700' }}>SESSION {formatCost(sessionTotal)}</span>
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-5">
        {rows.map(row => (
          <div key={row.familyName} className="rounded px-3 py-2"
            style={{
              border: row.active ? '1px solid #2b3325' : '1px solid #1a1a1a',
              background: row.active ? 'rgba(255,215,0,0.025)' : 'rgba(255,255,255,0.01)',
            }}>
            <div className="text-xs font-bold tracking-widest" style={{ color: row.active ? '#ddd' : '#444' }}>
              {row.familyName}
            </div>
            <div className="text-xs mt-1" style={{ color: '#555' }}>{row.provider} · {row.model}</div>
            <div className="text-xs mt-2" style={{ color: row.active ? '#888' : '#333' }}>
              IN {row.inputTokens} · OUT {row.outputTokens}
            </div>
            <div className="text-xs mt-1" style={{ color: row.active ? '#34D399' : '#333' }}>
              {formatCost(row.estimatedCost)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function MemoryPanel({ memories }: { memories: MemoryEntry[] }) {
  return (
    <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0"
      style={{ background: 'rgba(52,211,153,0.025)' }}>
      <div className="flex items-center justify-between gap-4 mb-2">
        <h2 className="text-xs font-bold tracking-widest" style={{ color: '#34D399' }}>
          MEMORY LOG
        </h2>
        <span className="text-xs tracking-widest" style={{ color: '#555' }}>
          LATEST {memories.length}
        </span>
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        {memories.length === 0 ? (
          <div className="text-xs" style={{ color: '#555' }}>
            No saved War Room memories yet.
          </div>
        ) : memories.slice(0, 3).map(memory => (
          <div key={memory.id || `${memory.created_at}-${memory.content}`} className="rounded border border-[#00ff41]/10 bg-black/30 px-3 py-2">
            <div className="flex items-center justify-between gap-2 text-[10px] tracking-widest">
              <span style={{ color: '#34D399' }}>{memory.family}</span>
              <span style={{ color: '#555' }}>I{memory.importance}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-slate-400">{memory.content}</p>
            <div className="mt-1 truncate text-[10px]" style={{ color: '#555' }}>
              {memory.source} {memory.tags.length ? `· ${memory.tags.join(', ')}` : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CodexAgentPlaceholder() {
  return (
    <div className="border-b border-yellow-900 px-6 py-2 flex-shrink-0"
      style={{ background: 'rgba(0,255,65,0.025)' }}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tracking-widest">
        <span style={{ color: '#FFD700' }}>Codex Agent — Engineering / Deployment</span>
        <span style={{ color: '#666' }}>Status: standby</span>
        <span style={{ color: '#34D399' }}>
          Capability: feature deployment, code patching, repo operations
        </span>
      </div>
    </div>
  )
}

function ExpansionPermissionPrompt({
  prompt,
  onApprove,
  onDecline,
  onSummarize,
}: {
  prompt: ExpansionPrompt
  onApprove: () => void
  onDecline: () => void
  onSummarize: () => void
}) {
  return (
    <div className="message-fade-in ml-11 mb-4 p-3 rounded"
      style={{ background: 'rgba(255,215,0,0.06)', border: '1px solid #3a2e00' }}>
      {prompt.urgent && (
        <div className="text-xs font-bold tracking-widest mb-2" style={{ color: '#EF4444' }}>
          URGENT: expanded analysis recommended.
        </div>
      )}
      <div className="text-xs tracking-widest" style={{ color: '#ddd' }}>
        Council requests expanded analysis. Estimated extra usage: {formatCost(prompt.extraCost)}. Reason: {prompt.reason}. Continue?
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        <button onClick={onApprove} className="text-xs px-3 py-1 rounded tracking-widest"
          style={{ background: '#FFD700', color: '#000', fontWeight: 'bold' }}>
          Approve
        </button>
        <button onClick={onDecline} className="text-xs px-3 py-1 rounded tracking-widest"
          style={{ border: '1px solid #333', color: '#888' }}>
          Decline
        </button>
        <button onClick={onSummarize} className="text-xs px-3 py-1 rounded tracking-widest"
          style={{ border: '1px solid #FFD700', color: '#FFD700' }}>
          Summarize instead
        </button>
      </div>
    </div>
  )
}

function ContinuationPermissionPrompt({
  prompt,
  onAllow,
  onPause,
  onStop,
  onSummarize,
}: {
  prompt: ContinuationPrompt
  onAllow: () => void
  onPause: () => void
  onStop: () => void
  onSummarize: () => void
}) {
  return (
    <div className="message-fade-in ml-11 mb-4 p-3 rounded"
      style={{ background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.25)' }}>
      <div className="text-xs tracking-widest" style={{ color: '#ddd' }}>
        Council wants to continue discussion. Estimated extra usage: {formatCost(prompt.estimatedCost)}.
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        <button onClick={onAllow} className="text-xs px-3 py-1 rounded tracking-widest"
          style={{ background: '#34D399', color: '#000', fontWeight: 'bold' }}>
          Allow
        </button>
        <button onClick={onPause} className="text-xs px-3 py-1 rounded tracking-widest"
          style={{ border: '1px solid #333', color: '#888' }}>
          Pause
        </button>
        <button onClick={onStop} className="text-xs px-3 py-1 rounded tracking-widest"
          style={{ border: '1px solid #333', color: '#888' }}>
          Stop
        </button>
        <button onClick={onSummarize} className="text-xs px-3 py-1 rounded tracking-widest"
          style={{ border: '1px solid #FFD700', color: '#FFD700' }}>
          Summarize
        </button>
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
  const [discussionSeconds, setDiscussionSeconds] = useState(DEFAULT_DISCUSSION_SECONDS)
  const [typingFamily, setTypingFamily] = useState<TypingFamily | null>(null)
  const [toolStatuses, setToolStatuses] = useState<Record<ToolId, ToolStatus>>(INITIAL_TOOL_STATUSES)
  const [memories, setMemories] = useState<MemoryEntry[]>([])
  const [usageRows, setUsageRows] = useState<UsageEstimate[]>(BASE_USAGE_ROWS)
  const [currentDecreeCost, setCurrentDecreeCost] = useState(0)
  const [sessionCost, setSessionCost] = useState(0)
  const [expansionPrompt, setExpansionPrompt] = useState<ExpansionPrompt | null>(null)
  const [discussionExpiredNoticeShown, setDiscussionExpiredNoticeShown] = useState(false)
  const [councilPaused, setCouncilPaused] = useState(false)
  const [continuationPrompt, setContinuationPrompt] = useState<ContinuationPrompt | null>(null)
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const lastAutoContinueAtRef = useRef(0)
  const addSystemMessageRef = useRef<((content: string) => void) | null>(null)
  const submitDecreeRef = useRef<((decree: string, mode?: CouncilMode) => Promise<void>) | null>(null)
  const estimateContinuationCostRef = useRef<(() => number) | null>(null)
  const loadMemoriesRef = useRef<(() => Promise<void>) | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const councilPausedRef = useRef(false)
  const councilStoppedRef = useRef(false)

  useEffect(() => {
    if (!autoScrollEnabled) return
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, autoScrollEnabled])

  useEffect(() => {
    if (!showContinue || councilPaused || discussionSeconds === 0) return

    const timer = window.setInterval(() => {
      setDiscussionSeconds(prev => Math.max(prev - 1, 0))
    }, 1000)

    return () => window.clearInterval(timer)
  }, [showContinue, councilPaused, discussionSeconds])

  useEffect(() => {
    councilPausedRef.current = councilPaused
    councilStoppedRef.current = !showContinue
  }, [councilPaused, showContinue])

  const formatDiscussionTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60).toString().padStart(2, '0')
    const remainingSeconds = (seconds % 60).toString().padStart(2, '0')
    return `${minutes}:${remainingSeconds}`
  }

  const addMessages = (newMsgs: CouncilMessage[]) => {
    setMessages(prev => [...prev, ...newMsgs])
  }

  const setToolStatus = (toolId: ToolId, status: ToolStatus) => {
    setToolStatuses(prev => ({ ...prev, [toolId]: status }))
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

  useEffect(() => {
    addSystemMessageRef.current = addSystemMessage
  })

  const estimateContinuationCost = () => {
    const threadText = messages.map(m => `${m.familyName}: ${m.content}`).join('\n')
    const rows = createUsageEstimate(`continue council discussion\n${threadText}`, DEFAULT_OUTPUT_TOKEN_BUDGET)
    return totalUsageCost(rows)
  }

  useEffect(() => {
    estimateContinuationCostRef.current = estimateContinuationCost
  })

  const cancelActiveCouncilRequest = () => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setTypingFamily(null)
    setToolStatus('web', 'idle')
    setToolStatus('research', 'idle')
    setLoading(false)
  }

  const loadMemories = async () => {
    setToolStatus('memory', 'active')
    try {
      const res = await fetch('/api/tools/memory')
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Memory retrieval failed')
      setMemories(data.memories ?? [])
      setToolStatus('memory', 'complete')
    } catch {
      setToolStatus('memory', 'error')
    }
  }

  useEffect(() => {
    loadMemoriesRef.current = loadMemories
  })

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadMemoriesRef.current?.()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [])

  const saveMemory = async (memory: Omit<MemoryEntry, 'id' | 'created_at'>) => {
    setToolStatus('memory', 'active')
    try {
      const res = await fetch('/api/tools/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(memory),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Memory save failed')

      if (data.memory) {
        setMemories(prev => [data.memory, ...prev].slice(0, 10))
      }
      setToolStatus('memory', 'complete')
      addSystemMessage('Memory saved')
    } catch {
      setToolStatus('memory', 'error')
      addSystemMessage('Memory save failed')
    }
  }

  const revealFamilyMessages = async (data: { chatgpt?: string; claude?: string }, inputText: string) => {
    const now = new Date().toLocaleTimeString()
    const inputTokens = estimateTokens(inputText)
    const nextUsageRows = BASE_USAGE_ROWS.map(row => {
      if (!row.active) return row

      const outputText = row.familyName === 'ChatGPT Family' ? data.chatgpt || '' : data.claude || ''
      const outputTokens = outputText ? estimateTokens(outputText) : 0

      return {
        ...row,
        inputTokens,
        outputTokens,
        estimatedCost: estimateFamilyCost(row.familyName, inputTokens, outputTokens),
      }
    })

    if (data.chatgpt) {
      setTypingFamily('CHATGPT FAMILY')
      await wait(450)
      if (councilPausedRef.current || councilStoppedRef.current) return
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
      if (councilPausedRef.current || councilStoppedRef.current) return
      addSystemMessage('Retrieval complete')
      setToolStatus('web', 'idle')
      setToolStatus('research', 'idle')
      await wait(350)
    }

    if (data.claude) {
      setTypingFamily('CLAUDE FAMILY')
      await wait(650)
      if (councilPausedRef.current || councilStoppedRef.current) return
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

    const finalCost = totalUsageCost(nextUsageRows)
    setUsageRows(nextUsageRows)
    setCurrentDecreeCost(finalCost)
    setSessionCost(prev => prev + finalCost)
  }

  const submitDecree = async (decree: string, mode?: CouncilMode) => {
    const controller = new AbortController()
    abortControllerRef.current = controller
    councilStoppedRef.current = false
    setLoading(true)
    setTypingFamily('CHATGPT FAMILY')
    setContinuationPrompt(null)
    if (mode === 'continue') {
      addSystemMessage('Council channel continuing')
    } else {
      setToolStatus('web', 'scanning')
      setToolStatus('research', 'scanning')
      addSystemMessage('Web Research initiated')
    }

    const threadHistory = messages.map(m => ({ sender: m.familyName, content: m.content }))
    const inputText = `${decree}\n${threadHistory.map(m => `${m.sender}: ${m.content}`).join('\n')}`
    const projectedUsage = createUsageEstimate(inputText, mode === 'expanded' ? EXPANDED_OUTPUT_TOKEN_BUDGET : DEFAULT_OUTPUT_TOKEN_BUDGET)
    setUsageRows(projectedUsage)
    setCurrentDecreeCost(totalUsageCost(projectedUsage))
    const toneMode = detectToneMode(decree)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: decree, profile: RAEL_PROFILE, threadHistory, mode, toneMode }),
        signal: controller.signal,
      })
      const data = await res.json()
      if (controller.signal.aborted || councilPausedRef.current || councilStoppedRef.current) return
      await revealFamilyMessages(data, inputText)
      if (controller.signal.aborted || councilPausedRef.current || councilStoppedRef.current) return
      if (data.showContinue || (mode === 'continue' && discussionSeconds > 0)) {
        if (mode !== 'continue') {
          setDiscussionSeconds(DEFAULT_DISCUSSION_SECONDS)
          setDiscussionExpiredNoticeShown(false)
          lastAutoContinueAtRef.current = Date.now()
        }
        setShowContinue(true)
      } else {
        setShowContinue(false)
      }
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return
      setShowContinue(false)
      setTypingFamily(null)
      setToolStatus('web', 'idle')
      setToolStatus('research', 'idle')
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
      if (abortControllerRef.current === controller) abortControllerRef.current = null
      setTypingFamily(null)
      setToolStatus('web', 'idle')
      setToolStatus('research', 'idle')
      setLoading(false)
    }
  }

  useEffect(() => {
    submitDecreeRef.current = submitDecree
  })

  const handleSubmit = async () => {
    if (!command.trim() || loading) return
    const decree = command.trim()
    setCommand('')

    const expansionNeed = detectExpansionNeed(decree)
    if (expansionNeed) {
      setExpansionPrompt({ decree, ...expansionNeed })
      setUsageRows(createUsageEstimate(decree, DEFAULT_OUTPUT_TOKEN_BUDGET))
      setCurrentDecreeCost(totalUsageCost(createUsageEstimate(decree, DEFAULT_OUTPUT_TOKEN_BUDGET)))
      return
    }

    await sendRaelDecree(decree)
  }

  const sendRaelDecree = async (decree: string, mode?: CouncilMode) => {
    setExpansionPrompt(null)

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

    void saveMemory({
      content: decree,
      source: 'decree',
      family: "RA'EL",
      tags: [detectToneMode(decree), mode ?? 'standard'],
      importance: mode === 'expanded' ? 3 : 2,
    })

    await submitDecree(decree, mode)
  }

  const handleSummarize = async () => {
    setContinuationPrompt(null)
    await submitDecree('summarize council discussion', 'summarize')
  }

  useEffect(() => {
    if (!showContinue || discussionSeconds > 0 || discussionExpiredNoticeShown) return

    const notice = window.setTimeout(() => {
      addSystemMessageRef.current?.('Council requests additional discussion time.')
      setDiscussionExpiredNoticeShown(true)
    }, 0)

    return () => window.clearTimeout(notice)
  }, [showContinue, discussionSeconds, discussionExpiredNoticeShown])

  useEffect(() => {
    if (!showContinue || councilPaused || discussionSeconds === 0 || loading || expansionPrompt || continuationPrompt) return

    const loop = window.setInterval(() => {
      const now = Date.now()
      if (now - lastAutoContinueAtRef.current < COUNCIL_CONTINUE_INTERVAL_MS) return

      lastAutoContinueAtRef.current = now
      setContinuationPrompt({ estimatedCost: estimateContinuationCostRef.current?.() ?? 0 })
    }, 1000)

    return () => window.clearInterval(loop)
  }, [showContinue, councilPaused, discussionSeconds, loading, expansionPrompt, continuationPrompt])

  const extendCouncilDiscussion = (seconds: number) => {
    setDiscussionSeconds(seconds)
    setDiscussionExpiredNoticeShown(false)
    setShowContinue(true)
    lastAutoContinueAtRef.current = Date.now()
  }

  const handleApproveAdditionalDiscussion = () => {
    extendCouncilDiscussion(DEFAULT_DISCUSSION_SECONDS)
  }

  const handleDeclineAdditionalDiscussion = () => {
    stopCouncil()
  }

  const pauseCouncil = () => {
    setCouncilPaused(true)
    setContinuationPrompt(null)
    cancelActiveCouncilRequest()
  }

  const resumeCouncil = () => {
    setCouncilPaused(false)
    councilPausedRef.current = false
    lastAutoContinueAtRef.current = Date.now()
  }

  const stopCouncil = () => {
    councilStoppedRef.current = true
    setShowContinue(false)
    setCouncilPaused(false)
    setContinuationPrompt(null)
    setDiscussionExpiredNoticeShown(false)
    cancelActiveCouncilRequest()
    addSystemMessage('Council paused. Awaiting Ra’el’s next decree.')
  }

  const allowContinuationRound = async () => {
    if (loading || councilPaused || discussionSeconds === 0) return
    setContinuationPrompt(null)
    lastAutoContinueAtRef.current = Date.now()
    await submitDecreeRef.current?.('continue council discussion', 'continue')
  }

  const handleScroll = () => {
    const el = scrollContainerRef.current
    if (!el) return

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setAutoScrollEnabled(distanceFromBottom < 80)
  }

  const jumpToLatest = () => {
    setAutoScrollEnabled(true)
    window.requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    })
  }

  const handleExpansionApprove = async () => {
    if (!expansionPrompt || loading) return
    await sendRaelDecree(expansionPrompt.decree, 'expanded')
  }

  const handleExpansionDecline = async () => {
    if (!expansionPrompt || loading) return
    await sendRaelDecree(expansionPrompt.decree)
  }

  const handleExpansionSummarize = async () => {
    if (!expansionPrompt || loading) return
    await sendRaelDecree(expansionPrompt.decree, 'summarize')
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-white flex flex-col font-mono">
      <MatrixCodeRain />
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
      <div className="relative z-10 border-b border-yellow-900 px-6 py-4 flex items-center justify-between flex-shrink-0">
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

      <div className="relative z-10 flex-shrink-0">
        <ToolStatusPanel toolStatuses={toolStatuses} />
        <TokenUsagePanel rows={usageRows} currentCost={currentDecreeCost} sessionTotal={sessionCost} />
        <MemoryPanel memories={memories} />
        <CodexAgentPlaceholder />
      </div>

      <div className="relative z-10 border-b border-yellow-900 px-6 py-2 flex items-center gap-2 flex-shrink-0"
        style={{ background: 'rgba(0,0,0,0.45)' }}>
        {!councilPaused ? (
          <button onClick={pauseCouncil}
            className="text-xs px-3 py-1 rounded tracking-widest"
            style={{ border: '1px solid #333', color: '#888' }}>
            Pause Council
          </button>
        ) : (
          <button onClick={resumeCouncil}
            className="text-xs px-3 py-1 rounded tracking-widest"
            style={{ background: '#34D399', color: '#000', fontWeight: 'bold' }}>
            Resume Council
          </button>
        )}
        <button onClick={stopCouncil}
          className="text-xs px-3 py-1 rounded tracking-widest"
          style={{ border: '1px solid #EF4444', color: '#EF4444' }}>
          Stop Council
        </button>
        {councilPaused && (
          <span className="text-xs tracking-widest" style={{ color: '#FFD700' }}>
            COUNCIL PAUSED
          </span>
        )}
      </div>

      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="relative z-10 flex-1 overflow-y-auto px-6 py-4"
      >
        {messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)}

        {expansionPrompt && (
          <ExpansionPermissionPrompt
            prompt={expansionPrompt}
            onApprove={handleExpansionApprove}
            onDecline={handleExpansionDecline}
            onSummarize={handleExpansionSummarize}
          />
        )}

        {continuationPrompt && (
          <ContinuationPermissionPrompt
            prompt={continuationPrompt}
            onAllow={allowContinuationRound}
            onPause={pauseCouncil}
            onStop={stopCouncil}
            onSummarize={handleSummarize}
          />
        )}

        {typingFamily && <TypingIndicator familyName={typingFamily} />}

        {showContinue && (
          <div className="flex items-center gap-3 ml-11 mb-4 p-3 rounded"
            style={{ background: 'rgba(255,215,0,0.05)', border: '1px solid #3a2e00' }}>
            <span className="text-xs tracking-widest" style={{ color: '#888' }}>
              {discussionSeconds > 0
                ? `COUNCIL DISCUSSION ACTIVE — ${formatDiscussionTime(discussionSeconds)} REMAINING`
                : 'Council requests additional discussion time.'}
            </span>
            {discussionSeconds === 0 && !loading && (
              <>
                <button onClick={handleApproveAdditionalDiscussion}
                  className="text-xs px-3 py-1 rounded tracking-widest"
                  style={{ background: '#FFD700', color: '#000', fontWeight: 'bold' }}>
                  Approve
                </button>
                <button onClick={handleDeclineAdditionalDiscussion}
                  className="text-xs px-3 py-1 rounded tracking-widest"
                  style={{ border: '1px solid #333', color: '#666' }}>
                  Decline
                </button>
                <button onClick={() => extendCouncilDiscussion(30)}
                  className="text-xs px-3 py-1 rounded tracking-widest"
                  style={{ border: '1px solid #333', color: '#888' }}>
                  +30 sec
                </button>
                <button onClick={() => extendCouncilDiscussion(120)}
                  className="text-xs px-3 py-1 rounded tracking-widest"
                  style={{ border: '1px solid #333', color: '#888' }}>
                  +2 min
                </button>
                <button onClick={handleSummarize}
                  className="text-xs px-3 py-1 rounded tracking-widest"
                  style={{ border: '1px solid #FFD700', color: '#FFD700' }}>
                  Summarize
                </button>
              </>
            )}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {!autoScrollEnabled && (
        <button onClick={jumpToLatest}
          className="fixed bottom-24 right-6 z-20 text-xs px-3 py-2 rounded tracking-widest"
          style={{ background: '#FFD700', color: '#000', fontWeight: 'bold' }}>
          Jump to latest
        </button>
      )}

      <div className="relative z-10 border-t border-yellow-900 px-6 py-4 flex-shrink-0">
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
