'use client'

import { useState, useRef, useEffect } from 'react'
import type { FormEvent } from 'react'
import Link from 'next/link'
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

type MemorySavePrompt = {
  memory: Omit<MemoryEntry, 'id' | 'created_at'>
  reason: string
}

type FamilyPresence = {
  status: 'idle' | 'thinking' | 'streaming' | 'complete'
  label: string
}

type SubAgentNode = {
  name: string
  status: 'idle' | 'active' | 'reviewing' | 'blocked'
  task: string
}

type FamilyNodeGroup = {
  familyName: string
  presenceKey?: TypingFamily
  color: string
  nodes: SubAgentNode[]
}

type OpportunityType = 'surveys' | 'AI evaluation' | 'user testing' | 'research studies' | 'remote micro-contracts' | 'digital service gigs'
type OpportunityStatus = 'not started' | 'applied' | 'active' | 'paid'
type RiskLevel = 'low' | 'medium' | 'high'
type IncomeRadarView = 'active' | 'expiring' | 'expired'
type OpportunityScoutStatus = 'idle' | 'searching' | 'reviewing' | 'found' | 'error'
type ProviderHealth = 'online' | 'standby' | 'offline' | 'error'
type RaelActionStatus = 'pending' | 'answered' | 'expired'
type RaelActionUrgency = 'low' | 'medium' | 'high'
type SmsBridgeStatus = 'not configured' | 'standby' | 'online' | 'error'

type RaelActionItem = {
  action_id: string
  related_opportunity_id: string | null
  title: string
  question: string
  response_options: string[]
  status: RaelActionStatus
  urgency: RaelActionUrgency
  created_at: string
  expires_at: string | null
  source_agent: string
  selected_response?: string
  answered_at?: string
}

type SmsBridgeState = {
  status: SmsBridgeStatus
  lastNotification: string | null
  message: string
  sending: boolean
}

type OpportunityScoutState = {
  status: OpportunityScoutStatus
  message: string
  lastScanTime: string | null
  sourcesChecked: number
  opportunitiesFound: number
  opportunitiesRejected: number
  riskFilterStatus: string
  nextScanAction: string
  results: OpportunityScoutResult[]
  providerUsed: string
  scanDurationMs: number
  providerStatus: {
    tavily: ProviderHealth
    firecrawl: ProviderHealth
  }
}

type OpportunityScoutResult = {
  title: string
  url: string
  source: string
  country: string
  payout: string | null
  currency: string | null
  expiration: string | null
  type: string
  riskLevel: RiskLevel
  verificationStatus: 'candidate' | 'rejected'
  reason: string
  provider?: string
}

type IncomeOpportunity = {
  id: string
  title: string
  platform: string
  country: string
  currency: string
  local_payout: number | null
  usd_estimate: number | null
  estimated_hourly: number | null
  payout_speed: string
  type: OpportunityType
  risk_level: RiskLevel
  status: OpportunityStatus
  apply_url: string
  notes: string
  expires_at: string | null
  discovered_at: string
  last_checked_at: string | null
  is_active: boolean
  created_at: string
}

type WarRoomFile = {
  id: string
  file_name: string
  file_type: string
  mime_type: string
  size_bytes: number
  storage_path: string
  source_context: string
  uploaded_at: string
  tags: string[]
  status: 'uploaded' | 'indexed' | 'error'
  notes: string
}

const FAMILY_META: Record<TypingFamily, { color: string; icon: string }> = {
  'CHATGPT FAMILY': { color: '#34D399', icon: '🧠' },
  'CLAUDE FAMILY': { color: '#A78BFA', icon: '🔮' },
}

const DEFAULT_OUTPUT_TOKEN_BUDGET = 160
const EXPANDED_OUTPUT_TOKEN_BUDGET = 480
const DEFAULT_DISCUSSION_SECONDS = 90
const COUNCIL_CONTINUE_INTERVAL_MS = 22000
const STREAM_CHUNK_SIZE = 8
const STREAM_CHUNK_DELAY_MS = 35
const TOOL_REQUEST_TIMEOUT_MS = 45000
const INITIAL_OPPORTUNITY_SCOUT_STATE: OpportunityScoutState = {
  status: 'idle',
  message: 'Ready to scan when a live provider is connected.',
  lastScanTime: null,
  sourcesChecked: 0,
  opportunitiesFound: 0,
  opportunitiesRejected: 0,
  riskFilterStatus: 'verification required before save',
  nextScanAction: 'Connect live search provider',
  results: [],
  providerUsed: 'none',
  scanDurationMs: 0,
  providerStatus: {
    tavily: 'offline',
    firecrawl: 'offline',
  },
}
const INITIAL_SMS_BRIDGE_STATE: SmsBridgeState = {
  status: 'standby',
  lastNotification: null,
  message: 'SMS Bridge ready for configuration check.',
  sending: false,
}
const BASE_USAGE_ROWS: UsageEstimate[] = [
  { familyName: 'Claude Family', provider: 'Anthropic', model: 'claude-sonnet-4-20250514', inputTokens: 0, outputTokens: 0, estimatedCost: 0, active: true },
  { familyName: 'ChatGPT Family', provider: 'OpenAI', model: 'gpt-4o', inputTokens: 0, outputTokens: 0, estimatedCost: 0, active: true },
  { familyName: 'Kimi Family', provider: 'Moonshot', model: 'placeholder', inputTokens: 0, outputTokens: 0, estimatedCost: 0, active: false },
  { familyName: 'Grok Family', provider: 'xAI', model: 'placeholder', inputTokens: 0, outputTokens: 0, estimatedCost: 0, active: false },
  { familyName: 'Gemini Family', provider: 'Google', model: 'placeholder', inputTokens: 0, outputTokens: 0, estimatedCost: 0, active: false },
]

const FAMILY_NODE_GROUPS: FamilyNodeGroup[] = [
  {
    familyName: 'ChatGPT Family',
    presenceKey: 'CHATGPT FAMILY',
    color: '#34D399',
    nodes: ['Strategy', 'UX', 'Synthesis', 'Language', 'Continuity'].map(name => ({ name, status: 'idle', task: 'standing by' })),
  },
  {
    familyName: 'Claude Family',
    presenceKey: 'CLAUDE FAMILY',
    color: '#A78BFA',
    nodes: ['Architecture', 'Governance', 'Security', 'Logic', 'Documentation'].map(name => ({ name, status: 'idle', task: 'standing by' })),
  },
  {
    familyName: 'Kimi Family',
    color: '#60A5FA',
    nodes: ['Task Tree', 'Dependency', 'Parallelization', 'Operations', 'Sequencing'].map(name => ({ name, status: 'idle', task: 'future worker node' })),
  },
  {
    familyName: 'Grok Family',
    color: '#F97316',
    nodes: ['Realtime', 'Trend', 'Social Pulse', 'Contradiction', 'Alert'].map(name => ({ name, status: 'idle', task: 'future worker node' })),
  },
  {
    familyName: 'Gemini Family',
    color: '#38BDF8',
    nodes: ['Vision', 'Pattern', 'Document', 'Multimodal', 'Forecast'].map(name => ({ name, status: 'idle', task: 'future worker node' })),
  },
  {
    familyName: 'Red Team',
    color: '#EF4444',
    nodes: ['Risk', 'Attack', 'Weakness', 'Assumption', 'Stress Test'].map(name => ({ name, status: 'idle', task: 'future worker node' })),
  },
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

function detectOpportunityScoutIntent(message: string) {
  const text = message.toLowerCase()

  return /\b(opportunity scout|scout opportunities|scout for opportunities|search opportunities|find opportunities|income radar search|income scout)\b/.test(text)
}

function detectToolIntent(message: string) {
  const text = message.toLowerCase()

  if (detectOpportunityScoutIntent(text)) return false

  return /\b(search|research|look up|lookup|find live info|live info|current info|current information|web check|verify online|check online|find online|online research)\b/.test(text)
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

function formatMoney(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatFileSize(sizeBytes: number) {
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatLocalMoney(amount: number | null, currency: string) {
  if (amount === null || Number.isNaN(amount)) return 'Not set'

  return `${currency || 'LOCAL'} ${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

function isExpired(opportunity: IncomeOpportunity) {
  return !opportunity.is_active || Boolean(opportunity.expires_at && new Date(opportunity.expires_at) <= new Date())
}

function expiresSoon(opportunity: IncomeOpportunity) {
  if (!opportunity.expires_at || isExpired(opportunity)) return false

  const now = Date.now()
  const expiresAt = new Date(opportunity.expires_at).getTime()
  return expiresAt - now <= 72 * 60 * 60 * 1000
}

function formatDateLabel(value: string | null) {
  if (!value) return 'Expiration unknown'

  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function normalizeProviderHealth(value: unknown): ProviderHealth {
  return value === 'online' || value === 'standby' || value === 'error' || value === 'offline'
    ? value
    : 'offline'
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

function isExplicitMemoryRequest(message: string) {
  return /\b(remember this|save this|save memory|commit this to memory|add this to memory)\b/i.test(message)
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

function TypingIndicator({ familyName, label }: { familyName: TypingFamily; label?: string }) {
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
          {label ?? `${familyName} THINKING`}
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

function PaymentsPayoutsPanel({ opportunities }: { opportunities: IncomeOpportunity[] }) {
  const paidOpportunities = opportunities.filter(opportunity => opportunity.status === 'paid')
  const pendingPayments = opportunities.filter(opportunity => (
    !isExpired(opportunity) && opportunity.status !== 'paid' && (opportunity.local_payout !== null || opportunity.usd_estimate !== null)
  ))
  const expectedPayouts = pendingPayments.reduce((total, opportunity) => total + (opportunity.usd_estimate ?? 0), 0)
  const paidTotal = paidOpportunities.reduce((total, opportunity) => total + (opportunity.usd_estimate ?? 0), 0)
  const invoiceItems = opportunities.filter(opportunity => (
    opportunity.notes.toLowerCase().includes('invoice') || opportunity.status === 'applied' || opportunity.status === 'active'
  ))
  const providerPlaceholders = ['Stripe links', 'PayPal', 'Square', 'ACH provider']

  return (
    <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0"
      style={{ background: 'rgba(52,211,153,0.016)' }}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#34D399' }}>
            PAYMENTS / PAYOUTS
          </h2>
          <p className="mt-1 text-xs" style={{ color: '#666' }}>
            Payment operations through secure provider approvals.
          </p>
        </div>
        <span className="rounded px-3 py-1 text-xs font-bold tracking-widest"
          style={{ color: '#FFD700', border: '1px solid rgba(255,215,0,0.35)', background: 'rgba(0,0,0,0.28)' }}>
          SECURE APPROVAL REQUIRED
        </span>
      </div>

      <div className="grid gap-2 text-xs md:grid-cols-4">
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(255,215,0,0.22)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>PENDING PAYMENTS</div>
          <div className="mt-1 font-bold" style={{ color: '#FFD700' }}>{pendingPayments.length}</div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(52,211,153,0.22)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>EXPECTED PAYOUTS</div>
          <div className="mt-1 font-bold" style={{ color: '#34D399' }}>{formatMoney(expectedPayouts)}</div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(96,165,250,0.22)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>PAID OPPORTUNITIES</div>
          <div className="mt-1 font-bold" style={{ color: '#60A5FA' }}>{paidOpportunities.length} | {formatMoney(paidTotal)}</div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(167,139,250,0.22)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>INVOICE STATUS</div>
          <div className="mt-1 font-bold" style={{ color: '#A78BFA' }}>{invoiceItems.length ? `${invoiceItems.length} tracking` : 'none active'}</div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-xs lg:grid-cols-2">
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.24)' }}>
          <div className="mb-2 tracking-widest" style={{ color: '#555' }}>PAYMENT PROVIDERS</div>
          <div className="flex flex-wrap gap-2">
            {providerPlaceholders.map(provider => (
              <span key={provider} className="rounded px-2 py-1 text-[10px] tracking-widest"
                style={{ border: '1px solid rgba(52,211,153,0.18)', color: '#888', background: 'rgba(0,0,0,0.24)' }}>
                {provider} | future
              </span>
            ))}
          </div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.24)' }}>
          <div className="mb-2 tracking-widest" style={{ color: '#555' }}>SECURITY RULE</div>
          <div style={{ color: '#888' }}>
            SMS may notify and collect low-risk responses. Payment execution requires secure War Room approval and a real payment provider.
          </div>
        </div>
      </div>
    </div>
  )
}

function FilesEvidenceVaultPanel({
  files,
  loading,
  message,
  onUpload,
}: {
  files: WarRoomFile[]
  loading: boolean
  message: string | null
  onUpload: (formData: FormData) => Promise<void>
}) {
  const [sourceContext, setSourceContext] = useState('war-room')
  const [tags, setTags] = useState('')
  const [notes, setNotes] = useState('')
  const statusColors: Record<WarRoomFile['status'], string> = {
    uploaded: '#FFD700',
    indexed: '#34D399',
    error: '#EF4444',
  }

  const submitFile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    await onUpload(formData)
    form.reset()
    setSourceContext('war-room')
    setTags('')
    setNotes('')
  }

  return (
    <div className="border-b border-yellow-900 px-6 py-4 flex-shrink-0"
      style={{ background: 'rgba(96,165,250,0.016)' }}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#60A5FA' }}>
            FILES / EVIDENCE VAULT
          </h2>
          <p className="mt-1 text-xs" style={{ color: '#666' }}>
            Upload real documents, screenshots, datasets, and project evidence for future analysis.
          </p>
        </div>
        <span className="rounded px-3 py-1 text-xs font-bold tracking-widest"
          style={{ color: '#FFD700', border: '1px solid rgba(255,215,0,0.3)', background: 'rgba(0,0,0,0.28)' }}>
          {files.length} FILES
        </span>
      </div>

      <form onSubmit={submitFile} className="mb-4 rounded-md p-3"
        style={{ border: '1px solid rgba(96,165,250,0.18)', background: 'rgba(0,0,0,0.28)' }}>
        <div className="grid gap-2 md:grid-cols-4">
          <input
            name="file"
            type="file"
            accept=".pdf,.txt,.md,.markdown,.json,.csv,.png,.jpg,.jpeg,.webp,application/pdf,text/plain,text/markdown,application/json,text/csv,image/png,image/jpeg,image/webp"
            required
            className="rounded border border-[#24301f] bg-black/40 px-2 py-2 text-xs text-slate-200 outline-none focus:border-[#60A5FA] md:col-span-2"
          />
          <input
            name="source_context"
            value={sourceContext}
            onChange={event => setSourceContext(event.target.value)}
            placeholder="Source context"
            className="rounded border border-[#24301f] bg-black/40 px-2 py-2 text-xs text-slate-200 outline-none focus:border-[#60A5FA]"
          />
          <input
            name="tags"
            value={tags}
            onChange={event => setTags(event.target.value)}
            placeholder="Tags, comma separated"
            className="rounded border border-[#24301f] bg-black/40 px-2 py-2 text-xs text-slate-200 outline-none focus:border-[#60A5FA]"
          />
        </div>
        <textarea
          name="notes"
          value={notes}
          onChange={event => setNotes(event.target.value)}
          placeholder="Notes for future council or Baby AI analysis"
          className="mt-2 min-h-16 w-full rounded border border-[#24301f] bg-black/40 px-2 py-2 text-xs text-slate-200 outline-none focus:border-[#60A5FA]"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs" style={{ color: message?.includes('not configured') ? '#FFD700' : '#666' }}>
            {message ?? 'Allowed: PDF, TXT, Markdown, JSON, CSV, PNG, JPG, WebP.'}
          </span>
          <button type="submit" disabled={loading}
            className="rounded px-3 py-2 text-xs font-bold tracking-widest disabled:opacity-40"
            style={{ background: '#60A5FA', color: '#000' }}>
            {loading ? 'UPLOADING...' : 'UPLOAD FILE'}
          </button>
        </div>
      </form>

      {files.length === 0 ? (
        <div className="rounded-md px-3 py-6 text-center text-xs tracking-widest"
          style={{ border: '1px solid rgba(255,255,255,0.08)', color: '#666', background: 'rgba(0,0,0,0.22)' }}>
          No files uploaded yet.
        </div>
      ) : (
        <div className="grid gap-2 xl:grid-cols-3 lg:grid-cols-2">
          {files.map(file => (
            <div key={file.id} className="rounded-md p-3"
              style={{ border: '1px solid rgba(96,165,250,0.16)', background: 'rgba(0,0,0,0.26)' }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-bold tracking-widest" style={{ color: '#ddd' }}>
                    {file.file_name}
                  </div>
                  <div className="mt-1 text-[10px] tracking-widest" style={{ color: '#555' }}>
                    {file.file_type.toUpperCase()} | {file.mime_type} | {formatFileSize(file.size_bytes)}
                  </div>
                </div>
                <span className="rounded px-2 py-1 text-[10px] font-bold tracking-widest"
                  style={{ color: statusColors[file.status], border: '1px solid #222', background: 'rgba(0,0,0,0.24)' }}>
                  {file.status.toUpperCase()}
                </span>
              </div>
              <div className="mt-3 grid gap-2 text-xs md:grid-cols-2">
                <div className="rounded px-2 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.24)' }}>
                  <span style={{ color: '#444' }}>UPLOADED </span>
                  <span style={{ color: '#888' }}>{new Date(file.uploaded_at).toLocaleString()}</span>
                </div>
                <div className="rounded px-2 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.24)' }}>
                  <span style={{ color: '#444' }}>SOURCE </span>
                  <span style={{ color: '#888' }}>{file.source_context}</span>
                </div>
              </div>
              {file.tags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {file.tags.map(tag => (
                    <span key={tag} className="rounded px-2 py-1 text-[10px] tracking-widest"
                      style={{ border: '1px solid rgba(96,165,250,0.18)', color: '#9CCBFF' }}>
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              {file.notes && <p className="mt-3 text-xs text-slate-500">{file.notes}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function OpportunityScoutPanel({
  scout,
  loading,
  onScout,
}: {
  scout: OpportunityScoutState
  loading: boolean
  onScout: () => Promise<void>
}) {
  const statusColors: Record<OpportunityScoutStatus, string> = {
    idle: '#666',
    searching: '#34D399',
    reviewing: '#FFD700',
    found: '#60A5FA',
    error: '#EF4444',
  }
  const safeScout: OpportunityScoutState = {
    ...INITIAL_OPPORTUNITY_SCOUT_STATE,
    ...scout,
    results: scout?.results ?? [],
    providerStatus: {
      ...INITIAL_OPPORTUNITY_SCOUT_STATE.providerStatus,
      ...scout?.providerStatus,
    },
  }
  const providerItems = [
    { name: 'Tavily', status: safeScout.providerStatus.tavily },
    { name: 'Firecrawl', status: safeScout.providerStatus.firecrawl },
  ]
  const providerColor: Record<ProviderHealth, string> = {
    online: '#34D399',
    standby: '#FFD700',
    offline: '#666',
    error: '#EF4444',
  }

  return (
    <div className="mb-4 rounded-md p-3"
      style={{ border: '1px solid rgba(52,211,153,0.18)', background: 'rgba(0,0,0,0.28)' }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold tracking-widest" style={{ color: '#34D399' }}>
            OPPORTUNITY SCOUT
          </div>
          <div className="mt-1 text-xs" style={{ color: '#777' }}>
            Global income opportunity researcher
          </div>
        </div>
        <button type="button" onClick={() => void onScout()} disabled={loading}
          className="rounded px-3 py-2 text-xs font-bold tracking-widest disabled:opacity-40"
          style={{ background: '#34D399', color: '#000' }}>
          Scout Opportunities
        </button>
      </div>

      <div className="mt-3 grid gap-2 text-xs md:grid-cols-4">
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.3)' }}>
          <div className="tracking-widest" style={{ color: '#444' }}>STATUS</div>
          <div className="mt-1 font-bold" style={{ color: statusColors[safeScout.status] }}>{safeScout.status.toUpperCase()}</div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.3)' }}>
          <div className="tracking-widest" style={{ color: '#444' }}>LAST SCAN</div>
          <div className="mt-1" style={{ color: '#888' }}>
            {safeScout.lastScanTime ? new Date(safeScout.lastScanTime).toLocaleString() : 'Not scanned'}
          </div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.3)' }}>
          <div className="tracking-widest" style={{ color: '#444' }}>SOURCES CHECKED</div>
          <div className="mt-1" style={{ color: '#888' }}>{safeScout.sourcesChecked}</div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.3)' }}>
          <div className="tracking-widest" style={{ color: '#444' }}>RISK FILTER</div>
          <div className="mt-1" style={{ color: '#FFD700' }}>{safeScout.riskFilterStatus}</div>
        </div>
      </div>

      <div className="mt-2 grid gap-2 text-xs md:grid-cols-4">
        {providerItems.map(provider => (
          <div key={provider.name} className="rounded px-3 py-2"
            style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.25)' }}>
            <span style={{ color: '#444' }}>{provider.name.toUpperCase()} </span>
            <span style={{ color: providerColor[provider.status] }}>
              {provider.status.toUpperCase()}
            </span>
          </div>
        ))}
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.25)' }}>
          <span style={{ color: '#444' }}>PROVIDER </span>
          <span style={{ color: '#888' }}>{safeScout.providerUsed.toUpperCase()}</span>
        </div>
      </div>

      <div className="mt-2 grid gap-2 text-xs md:grid-cols-3">
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.25)' }}>
          <span style={{ color: '#444' }}>FOUND </span>
          <span style={{ color: '#34D399' }}>{safeScout.opportunitiesFound}</span>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.25)' }}>
          <span style={{ color: '#444' }}>REJECTED </span>
          <span style={{ color: '#EF4444' }}>{safeScout.opportunitiesRejected}</span>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.25)' }}>
          <span style={{ color: '#444' }}>NEXT </span>
          <span style={{ color: '#888' }}>{safeScout.nextScanAction}</span>
        </div>
      </div>

      <div className="mt-2 rounded px-3 py-2 text-xs"
        style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.25)' }}>
        <span style={{ color: '#444' }}>SCAN DURATION </span>
        <span style={{ color: '#888' }}>{safeScout.scanDurationMs ? `${(safeScout.scanDurationMs / 1000).toFixed(1)}s` : 'not scanned'}</span>
      </div>

      {safeScout.message && (
        <div className="mt-3 rounded px-3 py-2 text-xs"
          style={{ border: '1px solid rgba(255,255,255,0.08)', color: '#888', background: 'rgba(0,0,0,0.24)' }}>
          {safeScout.message}
        </div>
      )}

      {safeScout.results.length > 0 && (
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {safeScout.results.map(result => (
            <div key={result.url} className="rounded px-3 py-2 text-xs"
              style={{ border: '1px solid rgba(52,211,153,0.18)', background: 'rgba(0,0,0,0.26)' }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-bold tracking-widest" style={{ color: '#ddd' }}>{result.title}</div>
                  <div className="mt-1 tracking-widest" style={{ color: '#555' }}>
                    {result.source} | {result.type} | {result.provider ?? safeScout.providerUsed}
                  </div>
                </div>
                <span className="rounded px-2 py-1 text-[10px] tracking-widest"
                  style={{
                    color: result.riskLevel === 'high' ? '#EF4444' : result.riskLevel === 'medium' ? '#FFD700' : '#34D399',
                    border: '1px solid rgba(255,255,255,0.1)',
                  }}>
                  {result.riskLevel.toUpperCase()} RISK
                </span>
              </div>
              <div className="mt-2 grid gap-2 md:grid-cols-3">
                <span style={{ color: '#888' }}>Country: {result.country}</span>
                <span style={{ color: '#888' }}>Payout: {result.payout ?? 'not found'}</span>
                <span style={{ color: '#888' }}>Expires: {result.expiration ?? 'not found'}</span>
              </div>
              <div className="mt-2" style={{ color: '#666' }}>{result.reason}</div>
              <a href={result.url} target="_blank" rel="noreferrer"
                className="mt-2 inline-flex rounded px-3 py-1 text-[10px] tracking-widest"
                style={{ border: '1px solid #333', color: '#888' }}>
                OPEN SOURCE
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function IncomeRadarPanel({
  opportunities,
  loading,
  view,
  onViewChange,
  onCreate,
  onExpire,
  scout,
  scoutLoading,
  onScout,
}: {
  opportunities: IncomeOpportunity[]
  loading: boolean
  view: IncomeRadarView
  onViewChange: (view: IncomeRadarView) => void
  onCreate: (opportunity: Omit<IncomeOpportunity, 'id' | 'created_at'>) => Promise<void>
  onExpire: (id: string) => Promise<void>
  scout: OpportunityScoutState
  scoutLoading: boolean
  onScout: () => Promise<void>
}) {
  const [form, setForm] = useState({
    title: '',
    platform: '',
    country: '',
    currency: 'USD',
    local_payout: '',
    estimated_hourly: '',
    payout_speed: '',
    type: 'user testing' as OpportunityType,
    risk_level: 'medium' as RiskLevel,
    status: 'not started' as OpportunityStatus,
    apply_url: '',
    notes: '',
    expires_at: '',
  })
  const activeOpportunities = opportunities.filter(opportunity => !isExpired(opportunity))
  const expiredOpportunities = opportunities.filter(isExpired)
  const expiringOpportunities = activeOpportunities.filter(expiresSoon)
  const visibleOpportunities = view === 'expired'
    ? expiredOpportunities
    : view === 'expiring'
      ? expiringOpportunities
      : activeOpportunities
  const rankedOpportunities = [...visibleOpportunities].sort((a, b) => {
    const expiresA = a.expires_at ? new Date(a.expires_at).getTime() : Number.MAX_SAFE_INTEGER
    const expiresB = b.expires_at ? new Date(b.expires_at).getTime() : Number.MAX_SAFE_INTEGER
    const expiryDelta = expiresA - expiresB
    return expiryDelta !== 0 ? expiryDelta : (b.usd_estimate ?? 0) - (a.usd_estimate ?? 0)
  })
  const totalExpected = activeOpportunities.reduce((total, opportunity) => total + (opportunity.usd_estimate ?? 0), 0)
  const totalPaid = opportunities
    .filter(opportunity => opportunity.status === 'paid')
    .reduce((total, opportunity) => total + (opportunity.usd_estimate ?? 0), 0)
  const riskStyles: Record<RiskLevel, { color: string; background: string; border: string }> = {
    low: { color: '#34D399', background: 'rgba(52,211,153,0.08)', border: 'rgba(52,211,153,0.3)' },
    medium: { color: '#FFD700', background: 'rgba(255,215,0,0.08)', border: 'rgba(255,215,0,0.28)' },
    high: { color: '#EF4444', background: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.28)' },
  }
  const statusColors: Record<OpportunityStatus, string> = {
    'not started': '#666',
    applied: '#FFD700',
    active: '#34D399',
    paid: '#60A5FA',
  }
  const inputClass = 'rounded border border-[#24301f] bg-black/40 px-2 py-2 text-xs text-slate-200 outline-none focus:border-[#34D399]'
  const submitOpportunity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!form.title.trim() || !form.platform.trim()) return

    const now = new Date().toISOString()
    const localPayout = form.local_payout ? Number(form.local_payout) : null

    await onCreate({
      title: form.title.trim(),
      platform: form.platform.trim(),
      country: form.country.trim(),
      currency: form.currency.trim().toUpperCase() || 'USD',
      local_payout: localPayout,
      usd_estimate: form.currency.trim().toUpperCase() === 'USD' ? localPayout : null,
      estimated_hourly: form.estimated_hourly ? Number(form.estimated_hourly) : null,
      payout_speed: form.payout_speed.trim(),
      type: form.type,
      risk_level: form.risk_level,
      status: form.status,
      apply_url: form.apply_url.trim(),
      notes: form.notes.trim(),
      expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
      discovered_at: now,
      last_checked_at: now,
      is_active: true,
    })
    setForm({
      title: '',
      platform: '',
      country: '',
      currency: 'USD',
      local_payout: '',
      estimated_hourly: '',
      payout_speed: '',
      type: 'user testing',
      risk_level: 'medium',
      status: 'not started',
      apply_url: '',
      notes: '',
      expires_at: '',
    })
  }

  return (
    <div className="border-b border-yellow-900 px-6 py-4 flex-shrink-0"
      style={{ background: 'rgba(0,255,65,0.02)' }}>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#34D399' }}>
            INCOME RADAR
          </h2>
          <p className="text-xs mt-1" style={{ color: '#666' }}>
            Verified income leads and tracked opportunities.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-3">
          <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(52,211,153,0.22)', background: 'rgba(0,0,0,0.35)' }}>
            <div className="tracking-widest" style={{ color: '#555' }}>ACTIVE EXPECTED</div>
            <div className="mt-1 font-bold" style={{ color: '#34D399' }}>{formatMoney(totalExpected)}</div>
          </div>
          <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(96,165,250,0.22)', background: 'rgba(0,0,0,0.35)' }}>
            <div className="tracking-widest" style={{ color: '#555' }}>PAID</div>
            <div className="mt-1 font-bold" style={{ color: '#60A5FA' }}>{formatMoney(totalPaid)}</div>
          </div>
          <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(255,215,0,0.22)', background: 'rgba(0,0,0,0.35)' }}>
            <div className="tracking-widest" style={{ color: '#555' }}>EXPIRING</div>
            <div className="mt-1 font-bold" style={{ color: '#FFD700' }}>{expiringOpportunities.length}</div>
          </div>
        </div>
      </div>

      <OpportunityScoutPanel scout={scout} loading={scoutLoading} onScout={onScout} />

      <form onSubmit={submitOpportunity} className="mb-4 rounded-md p-3"
        style={{ border: '1px solid rgba(52,211,153,0.18)', background: 'rgba(0,0,0,0.28)' }}>
        <div className="mb-3 text-xs font-bold tracking-widest" style={{ color: '#34D399' }}>
          MANUAL OPPORTUNITY ENTRY
        </div>
        <div className="grid gap-2 md:grid-cols-4">
          <input className={inputClass} value={form.title} onChange={event => setForm(prev => ({ ...prev, title: event.target.value }))} placeholder="Title" required />
          <input className={inputClass} value={form.platform} onChange={event => setForm(prev => ({ ...prev, platform: event.target.value }))} placeholder="Platform" required />
          <input className={inputClass} value={form.country} onChange={event => setForm(prev => ({ ...prev, country: event.target.value }))} placeholder="Country" />
          <select className={inputClass} value={form.type} onChange={event => setForm(prev => ({ ...prev, type: event.target.value as OpportunityType }))}>
            {['surveys', 'AI evaluation', 'user testing', 'research studies', 'remote micro-contracts', 'digital service gigs'].map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          <input className={inputClass} value={form.currency} onChange={event => setForm(prev => ({ ...prev, currency: event.target.value }))} placeholder="Currency" />
          <input className={inputClass} value={form.local_payout} onChange={event => setForm(prev => ({ ...prev, local_payout: event.target.value }))} placeholder="Local payout" type="number" min="0" step="0.01" />
          <input className={inputClass} value={form.estimated_hourly} onChange={event => setForm(prev => ({ ...prev, estimated_hourly: event.target.value }))} placeholder="Estimated hourly" type="number" min="0" step="0.01" />
          <input className={inputClass} value={form.payout_speed} onChange={event => setForm(prev => ({ ...prev, payout_speed: event.target.value }))} placeholder="Payout speed" />
          <select className={inputClass} value={form.risk_level} onChange={event => setForm(prev => ({ ...prev, risk_level: event.target.value as RiskLevel }))}>
            {['low', 'medium', 'high'].map(risk => <option key={risk} value={risk}>{risk} risk</option>)}
          </select>
          <select className={inputClass} value={form.status} onChange={event => setForm(prev => ({ ...prev, status: event.target.value as OpportunityStatus }))}>
            {['not started', 'applied', 'active', 'paid'].map(status => <option key={status} value={status}>{status}</option>)}
          </select>
          <input className={inputClass} value={form.expires_at} onChange={event => setForm(prev => ({ ...prev, expires_at: event.target.value }))} type="date" />
          <input className={inputClass} value={form.apply_url} onChange={event => setForm(prev => ({ ...prev, apply_url: event.target.value }))} placeholder="Apply URL" />
        </div>
        <textarea className={`${inputClass} mt-2 min-h-16 w-full`} value={form.notes} onChange={event => setForm(prev => ({ ...prev, notes: event.target.value }))} placeholder="Notes, warnings, payout terms, requirements" />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs" style={{ color: '#666' }}>
            USD estimate unavailable until currency tool is connected.
          </span>
          <button className="rounded px-3 py-2 text-xs font-bold tracking-widest"
            style={{ background: '#34D399', color: '#000' }} disabled={loading}>
            ADD REAL OPPORTUNITY
          </button>
        </div>
      </form>

      <div className="mb-3 flex flex-wrap gap-2">
        {[
          { id: 'active' as IncomeRadarView, label: `Active Opportunities (${activeOpportunities.length})` },
          { id: 'expiring' as IncomeRadarView, label: `Expiring Soon (${expiringOpportunities.length})` },
          { id: 'expired' as IncomeRadarView, label: `Expired Archive (${expiredOpportunities.length})` },
        ].map(item => (
          <button key={item.id} type="button" onClick={() => onViewChange(item.id)}
            className="rounded px-3 py-2 text-xs tracking-widest"
            style={{
              background: view === item.id ? 'rgba(52,211,153,0.18)' : 'rgba(0,0,0,0.24)',
              border: view === item.id ? '1px solid rgba(52,211,153,0.45)' : '1px solid #222',
              color: view === item.id ? '#34D399' : '#666',
            }}>
            {item.label}
          </button>
        ))}
      </div>

      {rankedOpportunities.length === 0 ? (
        <div className="rounded-md px-3 py-6 text-center text-xs tracking-widest"
          style={{ border: '1px solid rgba(255,255,255,0.08)', color: '#666', background: 'rgba(0,0,0,0.22)' }}>
          No live opportunities loaded yet.
        </div>
      ) : (
      <div className="grid gap-3 xl:grid-cols-3 lg:grid-cols-2">
        {rankedOpportunities.map(opportunity => {
          const riskStyle = riskStyles[opportunity.risk_level]
          const opportunityExpired = isExpired(opportunity)
          const opportunityExpiresSoon = expiresSoon(opportunity)

          return (
            <div key={opportunity.id} className="rounded-md p-3"
              style={{
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'linear-gradient(180deg, rgba(0,255,65,0.035), rgba(0,0,0,0.28))',
              }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-bold tracking-widest" style={{ color: '#ddd' }}>
                    {opportunity.title}
                  </div>
                  <div className="mt-1 text-[10px] tracking-widest" style={{ color: '#555' }}>
                    {opportunity.platform} | {opportunity.country || 'country unset'} | {opportunity.type}
                  </div>
                </div>
                <span className="rounded px-2 py-1 text-[10px] font-bold tracking-widest"
                  style={{ color: riskStyle.color, background: riskStyle.background, border: `1px solid ${riskStyle.border}` }}>
                  {opportunity.risk_level.toUpperCase()} RISK
                </span>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="tracking-widest" style={{ color: '#444' }}>PAYOUT</div>
                  <div className="mt-1" style={{ color: '#FFD700' }}>{opportunity.payout_speed || 'Not set'}</div>
                </div>
                <div>
                  <div className="tracking-widest" style={{ color: '#444' }}>RATE</div>
                  <div className="mt-1" style={{ color: '#34D399' }}>
                    {opportunity.estimated_hourly === null ? 'Not set' : `${formatMoney(opportunity.estimated_hourly)}/hr`}
                  </div>
                </div>
                <div>
                  <div className="tracking-widest" style={{ color: '#444' }}>LOCAL</div>
                  <div className="mt-1" style={{ color: '#34D399' }}>{formatLocalMoney(opportunity.local_payout, opportunity.currency)}</div>
                </div>
              </div>

              <div className="mt-3 rounded px-2 py-2 text-xs leading-relaxed"
                style={{ color: '#888', border: '1px solid #1f271f', background: 'rgba(0,0,0,0.25)' }}>
                {opportunity.usd_estimate === null
                  ? 'USD estimate unavailable until currency tool is connected.'
                  : `USD estimate: ${formatMoney(opportunity.usd_estimate)}`}
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <span className="rounded px-2 py-1 text-[10px] tracking-widest"
                  style={{ border: '1px solid #222', color: statusColors[opportunity.status], background: 'rgba(0,0,0,0.35)' }}>
                  STATUS: {opportunity.status.toUpperCase()}
                </span>
                <span className="rounded px-2 py-1 text-[10px] tracking-widest"
                  style={{
                    border: opportunityExpiresSoon ? '1px solid rgba(255,215,0,0.45)' : '1px solid #222',
                    color: opportunityExpired ? '#EF4444' : opportunityExpiresSoon ? '#FFD700' : '#777',
                    background: opportunityExpiresSoon ? 'rgba(255,215,0,0.08)' : 'rgba(0,0,0,0.35)',
                  }}>
                  {opportunityExpiresSoon ? 'EXPIRES SOON: ' : opportunityExpired ? 'EXPIRED: ' : ''}
                  {formatDateLabel(opportunity.expires_at)}
                </span>
              </div>
              {opportunity.notes && <p className="mt-3 text-xs text-slate-500">{opportunity.notes}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {opportunity.apply_url ? (
                  <a href={opportunity.apply_url} target="_blank" rel="noreferrer"
                    className="rounded px-3 py-1 text-[10px] tracking-widest"
                    style={{ border: '1px solid #333', color: '#888' }}>
                    OPEN APPLY LINK
                  </a>
                ) : (
                  <span className="rounded px-3 py-1 text-[10px] tracking-widest"
                    style={{ border: '1px solid #222', color: '#555' }}>
                    NO APPLY LINK SAVED
                  </span>
                )}
                {!opportunityExpired && (
                  <button type="button" onClick={() => void onExpire(opportunity.id)}
                    className="rounded px-3 py-1 text-[10px] tracking-widest"
                    style={{ border: '1px solid rgba(239,68,68,0.35)', color: '#EF4444' }}>
                    MARK EXPIRED
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
      )}
    </div>
  )
}

function MemoryPanel({ memories }: { memories: MemoryEntry[] }) {
  return (
    <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0"
      style={{ background: 'rgba(52,211,153,0.025)' }}>
      <div className="flex items-center justify-between gap-4 mb-2">
        <h2 className="text-xs font-bold tracking-widest" style={{ color: '#34D399' }}>
          CHRONICLE / MEMORY
        </h2>
        <span className="text-xs tracking-widest" style={{ color: '#555' }}>
          GROWTH +{memories.length} · LATEST {memories.length}
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

function SmsBridgePanel({
  bridge,
  onTest,
}: {
  bridge: SmsBridgeState
  onTest: () => void
}) {
  const statusColors: Record<SmsBridgeStatus, string> = {
    'not configured': '#666',
    standby: '#FFD700',
    online: '#34D399',
    error: '#EF4444',
  }

  return (
    <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0"
      style={{ background: 'rgba(96,165,250,0.018)' }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#60A5FA' }}>
            SMS BRIDGE
          </h2>
          <p className="mt-1 text-xs" style={{ color: '#666' }}>
            Phone notification bridge for action queue approvals.
          </p>
        </div>
        <button type="button" onClick={onTest} disabled={bridge.sending}
          className="rounded px-3 py-2 text-xs font-bold tracking-widest disabled:opacity-40"
          style={{ border: '1px solid rgba(96,165,250,0.4)', color: '#60A5FA', background: 'rgba(0,0,0,0.25)' }}>
          {bridge.sending ? 'Sending...' : 'Test Notification'}
        </button>
      </div>
      <div className="mt-3 grid gap-2 text-xs md:grid-cols-3">
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.28)' }}>
          <span style={{ color: '#444' }}>STATUS </span>
          <span style={{ color: statusColors[bridge.status] }}>{bridge.status.toUpperCase()}</span>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.28)' }}>
          <span style={{ color: '#444' }}>LAST NOTIFICATION </span>
          <span style={{ color: '#888' }}>{bridge.lastNotification ? new Date(bridge.lastNotification).toLocaleString() : 'None'}</span>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.28)' }}>
          <span style={{ color: '#888' }}>{bridge.message}</span>
        </div>
      </div>
    </div>
  )
}

function NeedsRaelPanel({
  actions,
  opportunities,
  onRespond,
  onNotify,
}: {
  actions: RaelActionItem[]
  opportunities: IncomeOpportunity[]
  onRespond: (actionId: string, response: string) => void
  onNotify: (action: RaelActionItem) => void
}) {
  const urgencyStyles: Record<RaelActionUrgency, { color: string; border: string; background: string }> = {
    low: { color: '#60A5FA', border: 'rgba(96,165,250,0.28)', background: 'rgba(96,165,250,0.06)' },
    medium: { color: '#FFD700', border: 'rgba(255,215,0,0.28)', background: 'rgba(255,215,0,0.06)' },
    high: { color: '#EF4444', border: 'rgba(239,68,68,0.32)', background: 'rgba(239,68,68,0.08)' },
  }
  const visibleActions = [...actions].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'pending' ? -1 : 1
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
  const pendingCount = actions.filter(action => action.status === 'pending').length

  return (
    <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0"
      style={{ background: 'rgba(255,215,0,0.018)' }}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#FFD700' }}>
            NEEDS RA&apos;EL
          </h2>
          <p className="mt-1 text-xs" style={{ color: '#666' }}>
            Internal approval queue for War Room decisions.
          </p>
        </div>
        <span className="rounded px-3 py-1 text-xs font-bold tracking-widest"
          style={{
            color: pendingCount > 0 ? '#FFD700' : '#555',
            border: pendingCount > 0 ? '1px solid rgba(255,215,0,0.35)' : '1px solid #222',
            background: 'rgba(0,0,0,0.3)',
          }}>
          {pendingCount} PENDING
        </span>
      </div>

      {visibleActions.length === 0 ? (
        <div className="rounded-md px-3 py-4 text-center text-xs tracking-widest"
          style={{ border: '1px solid rgba(255,255,255,0.08)', color: '#555', background: 'rgba(0,0,0,0.22)' }}>
          No pending approvals.
        </div>
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">
          {visibleActions.map(action => {
            const relatedOpportunity = opportunities.find(opportunity => opportunity.id === action.related_opportunity_id)
            const urgencyStyle = urgencyStyles[action.urgency]

            return (
              <div key={action.action_id} className="rounded-md p-3"
                style={{ border: `1px solid ${urgencyStyle.border}`, background: urgencyStyle.background }}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold tracking-widest" style={{ color: '#ddd' }}>
                      {action.title}
                    </div>
                    <div className="mt-1 text-[10px] tracking-widest" style={{ color: '#555' }}>
                      {action.source_agent} | {new Date(action.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded px-2 py-1 text-[10px] font-bold tracking-widest"
                      style={{ color: urgencyStyle.color, border: `1px solid ${urgencyStyle.border}`, background: 'rgba(0,0,0,0.24)' }}>
                      {action.urgency.toUpperCase()}
                    </span>
                    <span className="rounded px-2 py-1 text-[10px] tracking-widest"
                      style={{ color: action.status === 'pending' ? '#FFD700' : action.status === 'answered' ? '#34D399' : '#EF4444', border: '1px solid #222', background: 'rgba(0,0,0,0.24)' }}>
                      {action.status.toUpperCase()}
                    </span>
                  </div>
                </div>

                <p className="mt-3 text-xs leading-relaxed" style={{ color: '#bbb' }}>{action.question}</p>

                <div className="mt-3 grid gap-2 text-xs md:grid-cols-2">
                  <div className="rounded px-2 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.24)' }}>
                    <div className="tracking-widest" style={{ color: '#444' }}>RELATED OPPORTUNITY</div>
                    <div className="mt-1" style={{ color: relatedOpportunity ? '#888' : '#555' }}>
                      {relatedOpportunity?.title ?? 'None linked'}
                    </div>
                  </div>
                  <div className="rounded px-2 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.24)' }}>
                    <div className="tracking-widest" style={{ color: '#444' }}>EXPIRES</div>
                    <div className="mt-1" style={{ color: action.expires_at ? '#888' : '#555' }}>
                      {action.expires_at ? new Date(action.expires_at).toLocaleString() : 'No deadline'}
                    </div>
                  </div>
                </div>

                {action.status === 'pending' ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {action.response_options.map(option => (
                      <button key={option} type="button" onClick={() => onRespond(action.action_id, option)}
                        className="rounded px-3 py-1 text-[10px] font-bold tracking-widest"
                        style={{ border: '1px solid rgba(255,215,0,0.35)', color: '#FFD700', background: 'rgba(0,0,0,0.2)' }}>
                        {option}
                      </button>
                    ))}
                    {action.urgency === 'high' && (
                      <button type="button" onClick={() => onNotify(action)}
                        className="rounded px-3 py-1 text-[10px] font-bold tracking-widest"
                        style={{ border: '1px solid rgba(52,211,153,0.4)', color: '#34D399', background: 'rgba(0,0,0,0.2)' }}>
                        Notify Ra&apos;el
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="mt-3 rounded px-2 py-2 text-xs"
                    style={{ border: '1px solid #222', color: '#777', background: 'rgba(0,0,0,0.24)' }}>
                    Response: {action.selected_response ?? 'none recorded'}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function MemorySavePromptPanel({
  prompt,
  onSave,
  onDismiss,
}: {
  prompt: MemorySavePrompt
  onSave: () => void
  onDismiss: () => void
}) {
  return (
    <div className="message-fade-in ml-11 mb-4 p-3 rounded"
      style={{ background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.25)' }}>
      <div className="text-xs tracking-widest" style={{ color: '#ddd' }}>
        Council asks permission to save this memory. Reason: {prompt.reason}
      </div>
      <p className="mt-2 line-clamp-2 text-xs text-slate-400">{prompt.memory.content}</p>
      <div className="flex flex-wrap gap-2 mt-3">
        <button onClick={onSave} className="text-xs px-3 py-1 rounded tracking-widest"
          style={{ background: '#34D399', color: '#000', fontWeight: 'bold' }}>
          Save Memory
        </button>
        <button onClick={onDismiss} className="text-xs px-3 py-1 rounded tracking-widest"
          style={{ border: '1px solid #333', color: '#888' }}>
          Not Now
        </button>
      </div>
    </div>
  )
}

function FamilyPresencePanel({
  presence,
}: {
  presence: Record<TypingFamily, FamilyPresence>
}) {
  return (
    <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0"
      style={{ background: 'rgba(0,255,65,0.018)' }}>
      <div className="flex items-center justify-between gap-4 mb-3">
        <h2 className="text-xs font-bold tracking-widest" style={{ color: '#9AE6B4' }}>
          LIVE COGNITION
        </h2>
        <span className="text-xs tracking-widest" style={{ color: '#555' }}>
          SUB-AGENT CONSTELLATIONS
        </span>
      </div>
      <div className="grid gap-2 xl:grid-cols-6 md:grid-cols-3">
        {FAMILY_NODE_GROUPS.map(group => {
          const familyPresence = group.presenceKey ? presence[group.presenceKey] : null
          const active = Boolean(familyPresence && familyPresence.status !== 'idle')

          return (
            <div key={group.familyName} className="rounded px-3 py-2"
              style={{
                border: active ? `1px solid ${group.color}55` : '1px solid rgba(255,255,255,0.08)',
                background: active ? `${group.color}10` : 'rgba(255,255,255,0.012)',
              }}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold tracking-widest" style={{ color: active ? group.color : '#666' }}>
                  {group.familyName}
                </span>
                <span className="text-[10px] tracking-widest" style={{ color: active ? '#9AE6B4' : '#333' }}>
                  {familyPresence?.label ?? 'standby'}
                </span>
              </div>
              <div className="relative mt-3 flex items-center justify-between">
                <div className="absolute left-1 right-1 top-1/2 h-px -translate-y-1/2"
                  style={{ background: active ? `${group.color}55` : 'rgba(255,255,255,0.08)' }} />
                {group.nodes.map((node, index) => {
                  const nodeActive = active && index === 0
                  const status = nodeActive ? 'active' : node.status

                  return (
                    <div key={node.name}
                      className={`relative z-10 h-3 w-3 rounded-full ${nodeActive ? 'tool-dot-active' : ''}`}
                      title={`${node.name} | status: ${status} | current micro-task: ${nodeActive ? familyPresence?.label : node.task}`}
                      style={{
                        background: nodeActive ? group.color : '#15251a',
                        border: `1px solid ${nodeActive ? group.color : '#25402b'}`,
                        boxShadow: nodeActive ? `0 0 10px ${group.color}` : 'none',
                      }}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function BabyAiObserverPanel({
  memories,
  actions,
  opportunities,
}: {
  memories: MemoryEntry[]
  actions: RaelActionItem[]
  opportunities: IncomeOpportunity[]
}) {
  const familyContributions = [
    { family: 'Claude Family', skill: 'architecture, governance, systems thinking', color: '#A78BFA' },
    { family: 'ChatGPT Family', skill: 'strategy, synthesis, communication', color: '#34D399' },
    { family: 'Kimi Family', skill: 'decomposition, task sequencing, execution planning', color: '#60A5FA' },
    { family: 'Grok Family', skill: 'realtime signal awareness', color: '#F97316' },
    { family: 'Codex Agent', skill: 'coding, build, deployment awareness', color: '#FFD700' },
    { family: 'Red Team', skill: 'risk detection, contradiction checking', color: '#EF4444' },
    { family: 'Archivist / Memory', skill: 'continuity and pattern memory', color: '#38BDF8' },
  ]
  const hardRules = [
    'No speaking for Ra’el',
    'No saving sensitive memories without approval',
    'No external actions without approval',
    'No payment or banking actions without secure approval',
    'No fake identity or platform-rule evasion',
    'No uncontrolled execution',
  ]
  const experienceCount = memories.length + actions.length + opportunities.length
  const patternsLearned = Math.min(memories.length + opportunities.filter(opportunity => opportunity.status === 'paid').length, 99)
  const pendingLessons = actions.filter(action => action.status === 'pending').length + opportunities.filter(expiresSoon).length
  const approvalGatesActive = actions.filter(action => action.status === 'pending').length

  return (
    <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0"
      style={{ background: 'rgba(56,189,248,0.018)' }}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#38BDF8' }}>
            BABY AI OBSERVER
          </h2>
          <p className="mt-1 text-xs" style={{ color: '#777' }}>
            War Room Native | Memory + Council Experience + Family Skills
          </p>
        </div>
        <span className="rounded px-3 py-1 text-xs font-bold tracking-widest"
          style={{ color: '#FFD700', border: '1px solid rgba(255,215,0,0.35)', background: 'rgba(0,0,0,0.28)' }}>
          OBSERVES | LEARNS | RECOMMENDS
        </span>
      </div>

      <div className="grid gap-2 text-xs md:grid-cols-4">
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(56,189,248,0.22)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>ORIGIN</div>
          <div className="mt-1 font-bold" style={{ color: '#38BDF8' }}>War Room Native</div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(52,211,153,0.22)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>EXPERIENCE COUNT</div>
          <div className="mt-1 font-bold" style={{ color: '#34D399' }}>{experienceCount}</div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(167,139,250,0.22)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>PATTERNS LEARNED</div>
          <div className="mt-1 font-bold" style={{ color: '#A78BFA' }}>{patternsLearned}</div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(255,215,0,0.22)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>APPROVAL GATES ACTIVE</div>
          <div className="mt-1 font-bold" style={{ color: '#FFD700' }}>{approvalGatesActive}</div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 lg:grid-cols-3">
        <div className="rounded px-3 py-2 text-xs" style={{ border: '1px solid rgba(56,189,248,0.18)', background: 'rgba(0,0,0,0.24)' }}>
          <div className="mb-2 font-bold tracking-widest" style={{ color: '#38BDF8' }}>SKILL STACK</div>
          <div className="leading-relaxed" style={{ color: '#888' }}>
            Observes, learns, summarizes, recommends, and coordinates. Not autonomous yet.
          </div>
          <div className="mt-2 rounded px-2 py-2" style={{ border: '1px solid #222', color: '#777', background: 'rgba(0,0,0,0.22)' }}>
            Command posture: Ra&apos;el controls Baby AI Observer. It reports clearly, waits for approval, and does not act on its own.
          </div>
        </div>

        <div className="rounded px-3 py-2 text-xs" style={{ border: '1px solid rgba(52,211,153,0.18)', background: 'rgba(0,0,0,0.24)' }}>
          <div className="mb-2 font-bold tracking-widest" style={{ color: '#34D399' }}>FAMILY CONTRIBUTIONS</div>
          <div className="grid gap-1">
            {familyContributions.map(contribution => (
              <div key={contribution.family} className="flex flex-wrap items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: contribution.color, boxShadow: `0 0 8px ${contribution.color}` }} />
                <span style={{ color: contribution.color }}>{contribution.family}</span>
                <span style={{ color: '#666' }}>{contribution.skill}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded px-3 py-2 text-xs" style={{ border: '1px solid rgba(255,215,0,0.18)', background: 'rgba(0,0,0,0.24)' }}>
          <div className="mb-2 font-bold tracking-widest" style={{ color: '#FFD700' }}>LEARNING PROGRESS</div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between rounded px-2 py-1" style={{ border: '1px solid #222' }}>
              <span style={{ color: '#555' }}>Pending lessons</span>
              <span style={{ color: '#FFD700' }}>{pendingLessons}</span>
            </div>
            <div className="flex items-center justify-between rounded px-2 py-1" style={{ border: '1px solid #222' }}>
              <span style={{ color: '#555' }}>Memory signals</span>
              <span style={{ color: '#34D399' }}>{memories.length}</span>
            </div>
            <div className="flex items-center justify-between rounded px-2 py-1" style={{ border: '1px solid #222' }}>
              <span style={{ color: '#555' }}>Opportunity signals</span>
              <span style={{ color: '#60A5FA' }}>{opportunities.length}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {hardRules.map(rule => (
          <span key={rule} className="rounded px-2 py-1 text-[10px] tracking-widest"
            style={{ border: '1px solid rgba(239,68,68,0.22)', color: '#999', background: 'rgba(0,0,0,0.24)' }}>
            {rule}
          </span>
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
  const [warRoomFiles, setWarRoomFiles] = useState<WarRoomFile[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [filesMessage, setFilesMessage] = useState<string | null>(null)
  const [incomeOpportunities, setIncomeOpportunities] = useState<IncomeOpportunity[]>([])
  const [incomeLoading, setIncomeLoading] = useState(false)
  const [incomeView, setIncomeView] = useState<IncomeRadarView>('active')
  const [opportunityScout, setOpportunityScout] = useState<OpportunityScoutState>(INITIAL_OPPORTUNITY_SCOUT_STATE)
  const [opportunityScoutLoading, setOpportunityScoutLoading] = useState(false)
  const [raelActions, setRaelActions] = useState<RaelActionItem[]>([])
  const [smsBridge, setSmsBridge] = useState<SmsBridgeState>(INITIAL_SMS_BRIDGE_STATE)
  const [usageRows, setUsageRows] = useState<UsageEstimate[]>(BASE_USAGE_ROWS)
  const [currentDecreeCost, setCurrentDecreeCost] = useState(0)
  const [sessionCost, setSessionCost] = useState(0)
  const [expansionPrompt, setExpansionPrompt] = useState<ExpansionPrompt | null>(null)
  const [memorySavePrompt, setMemorySavePrompt] = useState<MemorySavePrompt | null>(null)
  const [memoryNotification, setMemoryNotification] = useState<string | null>(null)
  const [familyPresence, setFamilyPresence] = useState<Record<TypingFamily, FamilyPresence>>({
    'CHATGPT FAMILY': { status: 'idle', label: 'standby' },
    'CLAUDE FAMILY': { status: 'idle', label: 'standby' },
  })
  const [discussionExpiredNoticeShown, setDiscussionExpiredNoticeShown] = useState(false)
  const [councilPaused, setCouncilPaused] = useState(false)
  const [toolRequestActive, setToolRequestActive] = useState(false)
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
  const raelActionsRef = useRef<RaelActionItem[]>([])
  const toolRequestActiveRef = useRef(false)
  const toolTimeoutRef = useRef<number | null>(null)
  const activeToolSystemMessageRef = useRef<string | null>(null)

  useEffect(() => {
    if (!autoScrollEnabled) return
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, autoScrollEnabled])

  useEffect(() => {
    if (!showContinue || councilPaused || toolRequestActive || discussionSeconds === 0) return

    const timer = window.setInterval(() => {
      setDiscussionSeconds(prev => Math.max(prev - 1, 0))
    }, 1000)

    return () => window.clearInterval(timer)
  }, [showContinue, councilPaused, toolRequestActive, discussionSeconds])

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

  const updateMessageContent = (id: string, content: string) => {
    setMessages(prev => prev.map(msg => msg.id === id ? { ...msg, content } : msg))
  }

  const setPresence = (familyName: TypingFamily, status: FamilyPresence['status'], label: string) => {
    setFamilyPresence(prev => ({ ...prev, [familyName]: { status, label } }))
  }

  const setToolStatus = (toolId: ToolId, status: ToolStatus) => {
    setToolStatuses(prev => ({ ...prev, [toolId]: status }))
  }

  const addSystemMessage = (content: string) => {
    setMessages(prev => {
      const lastSystemMessage = [...prev].reverse().find(message => message.familyName === 'SYSTEM')
      if (lastSystemMessage?.content === content) return prev

      return [...prev, {
      id: Date.now() + '-system',
      familyName: 'SYSTEM',
      content,
      timestamp: new Date().toLocaleTimeString(),
      color: '#FFD700',
      icon: '⚙',
      provider: '',
      messageType: 'system'
      }]
    })
  }

  const addRaelAction = (action: Omit<RaelActionItem, 'created_at' | 'status'> & { status?: RaelActionStatus; created_at?: string }) => {
    const createdAt = action.created_at ?? new Date().toISOString()
    const queuedAction = {
      ...action,
      status: action.status ?? 'pending',
      created_at: createdAt,
    }

    setRaelActions(prev => {
      const existingPendingAction = prev.find(item => item.action_id === action.action_id && item.status === 'pending')
      if (existingPendingAction) return prev

      return [queuedAction, ...prev].slice(0, 24)
    })

    void fetch('/api/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(queuedAction),
    }).catch(() => undefined)
  }

  const respondToRaelAction = (actionId: string, response: string) => {
    const answeredAt = new Date().toISOString()

    setRaelActions(prev => prev.map(action => (
      action.action_id === actionId
        ? {
          ...action,
          status: 'answered',
          selected_response: response,
          answered_at: answeredAt,
        }
        : action
    )))
    void fetch(`/api/actions/${encodeURIComponent(actionId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'answered', answer: response, answered_at: answeredAt }),
    }).catch(() => undefined)
    addSystemMessage(`Ra'el answered action queue: ${response}`)
  }

  const sendSmsNotification = async (message: string) => {
    setSmsBridge(prev => ({ ...prev, sending: true, message: 'Sending SMS notification...' }))
    try {
      const res = await fetch('/api/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      })
      const data = await res.json()

      if (!res.ok) {
        setSmsBridge(prev => ({
          ...prev,
          status: data.status === 'not_configured' ? 'not configured' : 'error',
          message: data.message ?? 'SMS notification failed',
          sending: false,
        }))
        return
      }

      setSmsBridge({
        status: 'online',
        lastNotification: data.sentAt ?? new Date().toISOString(),
        message: data.message ?? 'SMS notification sent',
        sending: false,
      })
    } catch {
      setSmsBridge(prev => ({
        ...prev,
        status: 'error',
        message: 'SMS notification failed',
        sending: false,
      }))
    }
  }

  const testSmsBridge = () => {
    void sendSmsNotification('War Room SMS Bridge test. Reply STATUS to confirm command handling.')
  }

  const notifyRaelAction = (action: RaelActionItem) => {
    const options = action.response_options.join(' / ')
    void sendSmsNotification(`War Room needs Ra'el: ${action.title}. ${action.question} Reply options: ${options}.`)
  }

  useEffect(() => {
    addSystemMessageRef.current = addSystemMessage
  })

  useEffect(() => {
    raelActionsRef.current = raelActions
  }, [raelActions])

  useEffect(() => {
    const expireActions = window.setInterval(() => {
      const now = Date.now()
      const expiredActions = raelActionsRef.current.filter(action => (
        action.status === 'pending' && action.expires_at && new Date(action.expires_at).getTime() <= now
      ))

      expiredActions.forEach(action => {
        void fetch(`/api/actions/${encodeURIComponent(action.action_id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'expired' }),
        }).catch(() => undefined)
      })

      setRaelActions(prev => prev.map(action => (
        action.status === 'pending' && action.expires_at && new Date(action.expires_at).getTime() <= now
          ? { ...action, status: 'expired' }
          : action
      )))
    }, 30000)

    return () => window.clearInterval(expireActions)
  }, [])

  const estimateContinuationCost = () => {
    const threadText = messages.map(m => `${m.familyName}: ${m.content}`).join('\n')
    const rows = createUsageEstimate(`continue council discussion\n${threadText}`, DEFAULT_OUTPUT_TOKEN_BUDGET)
    return totalUsageCost(rows)
  }

  useEffect(() => {
    estimateContinuationCostRef.current = estimateContinuationCost
  })

  const endToolRequest = () => {
    if (toolTimeoutRef.current !== null) {
      window.clearTimeout(toolTimeoutRef.current)
      toolTimeoutRef.current = null
    }
    toolRequestActiveRef.current = false
    activeToolSystemMessageRef.current = null
    setToolRequestActive(false)
    setToolStatus('web', 'idle')
    setToolStatus('research', 'idle')
  }

  const beginToolRequest = (controller: AbortController) => {
    if (toolRequestActiveRef.current) return false

    toolRequestActiveRef.current = true
    setToolRequestActive(true)
    setToolStatus('web', 'scanning')
    setToolStatus('research', 'scanning')

    if (activeToolSystemMessageRef.current !== 'Web Research initiated') {
      activeToolSystemMessageRef.current = 'Web Research initiated'
      addSystemMessage('Web Research initiated')
    }

    toolTimeoutRef.current = window.setTimeout(() => {
      addSystemMessage('Research timed out.')
      controller.abort()
      endToolRequest()
      setTypingFamily(null)
      setPresence('CHATGPT FAMILY', 'idle', 'standby')
      setPresence('CLAUDE FAMILY', 'idle', 'standby')
      setLoading(false)
    }, TOOL_REQUEST_TIMEOUT_MS)

    return true
  }

  const cancelActiveCouncilRequest = () => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setTypingFamily(null)
    setPresence('CHATGPT FAMILY', 'idle', 'standby')
    setPresence('CLAUDE FAMILY', 'idle', 'standby')
    endToolRequest()
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

  const loadIncomeOpportunities = async () => {
    setIncomeLoading(true)
    try {
      const res = await fetch('/api/income/opportunities')
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Income opportunities retrieval failed')
      setIncomeOpportunities(data.opportunities ?? [])
    } catch {
      setIncomeOpportunities([])
    } finally {
      setIncomeLoading(false)
    }
  }

  const loadWarRoomFiles = async () => {
    try {
      const res = await fetch('/api/files')
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Files retrieval failed')
      setWarRoomFiles(Array.isArray(data.files) ? data.files : [])
      setFilesMessage(null)
    } catch (error) {
      setWarRoomFiles([])
      setFilesMessage(error instanceof Error ? error.message : 'Files retrieval failed')
    }
  }

  const uploadWarRoomFile = async (formData: FormData) => {
    setFilesLoading(true)
    setFilesMessage(null)
    try {
      const res = await fetch('/api/files/upload', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'File upload failed')
      if (data.file) {
        setWarRoomFiles(prev => [data.file, ...prev])
      }
      setFilesMessage(data.message ?? 'File uploaded')
    } catch (error) {
      setFilesMessage(error instanceof Error ? error.message : 'File upload failed')
    } finally {
      setFilesLoading(false)
    }
  }

  const loadRaelActions = async () => {
    try {
      const res = await fetch('/api/actions')
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Rael action queue retrieval failed')

      const actions = Array.isArray(data.actions) ? data.actions : []
      setRaelActions(actions.map((action: RaelActionItem & { answer?: string | null }) => ({
        ...action,
        selected_response: action.answer ?? action.selected_response,
      })))
    } catch {
      setRaelActions([])
    }
  }

  useEffect(() => {
    loadMemoriesRef.current = loadMemories
  })

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadMemoriesRef.current?.()
      void loadIncomeOpportunities()
      void loadRaelActions()
      void loadWarRoomFiles()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [])

  const createIncomeOpportunity = async (opportunity: Omit<IncomeOpportunity, 'id' | 'created_at'>) => {
    setIncomeLoading(true)
    try {
      const res = await fetch('/api/income/opportunities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opportunity),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Income opportunity save failed')
      if (data.opportunity) {
        setIncomeOpportunities(prev => [data.opportunity, ...prev])
      }
    } finally {
      setIncomeLoading(false)
    }
  }

  const markIncomeOpportunityExpired = async (id: string) => {
    setIncomeLoading(true)
    try {
      const res = await fetch('/api/income/opportunities', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_active: false, expires_at: new Date().toISOString() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Income opportunity update failed')
      if (data.opportunity) {
        setIncomeOpportunities(prev => prev.map(opportunity => (
          opportunity.id === id ? data.opportunity : opportunity
        )))
      }
    } finally {
      setIncomeLoading(false)
    }
  }

  const runOpportunityScout = async () => {
    if (opportunityScoutLoading) return

    setOpportunityScoutLoading(true)
    setOpportunityScout(prev => ({
      ...prev,
      status: 'searching',
      message: 'Opportunity Scout scanning provider status...',
      lastScanTime: new Date().toISOString(),
      providerUsed: 'tavily',
    }))

    window.setTimeout(() => {
      setOpportunityScout(prev => (
        prev.status === 'searching'
          ? { ...prev, status: 'reviewing', message: 'Opportunity Scout reviewing live results...' }
          : prev
      ))
    }, 600)

    try {
      const res = await fetch('/api/income/scout', { method: 'POST' })
      const data = await res.json()
      setOpportunityScout({
        status: data.status ?? (res.ok ? 'found' : 'error'),
        message: data.message ?? 'Opportunity Scout scan complete.',
        lastScanTime: data.lastScanTime ?? new Date().toISOString(),
        sourcesChecked: Number(data.sourcesChecked ?? 0),
        opportunitiesFound: Number(data.opportunitiesFound ?? 0),
        opportunitiesRejected: Number(data.opportunitiesRejected ?? 0),
        riskFilterStatus: String(data.riskFilterStatus ?? 'verification required before save'),
        nextScanAction: String(data.nextScanAction ?? 'Connect live search provider'),
        results: Array.isArray(data.opportunities) ? data.opportunities : [],
        providerUsed: String(data.providerUsed ?? data.provider ?? 'none'),
        scanDurationMs: Number(data.scanDurationMs ?? 0),
        providerStatus: {
          tavily: normalizeProviderHealth(data.providerStatus?.tavily),
          firecrawl: normalizeProviderHealth(data.providerStatus?.firecrawl),
        },
      })
      if (Array.isArray(data.opportunities) && data.opportunities.length > 0) {
        addRaelAction({
          action_id: `scout-review-${data.lastScanTime ?? Date.now()}`,
          related_opportunity_id: null,
          title: 'Opportunity Scout review',
          question: `Opportunity Scout found ${data.opportunities.length} candidate opportunities. Review candidates before saving any to Income Radar?`,
          response_options: ['Review now', 'Later', 'Dismiss'],
          urgency: 'medium',
          expires_at: null,
          source_agent: 'Opportunity Scout',
        })
      }
    } catch {
      setOpportunityScout(prev => ({
        ...prev,
        status: 'error',
        message: 'Opportunity Scout needs a live search provider connected.',
        lastScanTime: new Date().toISOString(),
        nextScanAction: 'Connect live search provider',
        results: [],
        providerUsed: 'none',
      }))
    } finally {
      setOpportunityScoutLoading(false)
    }
  }

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
      setMemoryNotification('Memory Saved')
      window.setTimeout(() => setMemoryNotification(null), 2400)
    } catch {
      setToolStatus('memory', 'error')
      addSystemMessage('Memory save failed')
    }
  }

  const streamFamilyMessage = async ({
    familyName,
    content,
    provider,
    messageId,
    thinkingLabel,
    streamingLabel,
  }: {
    familyName: TypingFamily
    content: string
    provider: string
    messageId: string
    thinkingLabel: string
    streamingLabel: string
  }) => {
    const family = FAMILY_META[familyName]
    const now = new Date().toLocaleTimeString()

    setPresence(familyName, 'thinking', thinkingLabel)
    setTypingFamily(familyName)
    await wait(familyName === 'CHATGPT FAMILY' ? 450 : 700)
    if (councilPausedRef.current || councilStoppedRef.current) return

    addMessages([{
      id: messageId,
      familyName,
      content: '',
      timestamp: now,
      color: family.color,
      icon: family.icon,
      provider,
      messageType: 'response'
    }])

    setTypingFamily(null)
    setPresence(familyName, 'streaming', streamingLabel)

    for (let i = 0; i < content.length; i += STREAM_CHUNK_SIZE) {
      if (councilPausedRef.current || councilStoppedRef.current) return
      updateMessageContent(messageId, content.slice(0, i + STREAM_CHUNK_SIZE))
      await wait(STREAM_CHUNK_DELAY_MS)
    }

    updateMessageContent(messageId, content)
    setPresence(familyName, 'complete', 'complete')
    await wait(350)
    setPresence(familyName, 'idle', 'standby')
  }

  const revealFamilyMessages = async (data: { chatgpt?: string; claude?: string }, inputText: string, toolIntent: boolean) => {
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
      await streamFamilyMessage({
        familyName: 'CHATGPT FAMILY',
        content: data.chatgpt,
        provider: 'OpenAI · gpt-4o',
        messageId: Date.now() + '-gpt',
        thinkingLabel: 'ChatGPT analyzing...',
        streamingLabel: 'ChatGPT streaming...',
      })
      if (councilPausedRef.current || councilStoppedRef.current) return
      if (toolIntent) {
        addSystemMessage('Retrieval complete')
        endToolRequest()
        await wait(350)
      }
    }

    if (data.claude) {
      await streamFamilyMessage({
        familyName: 'CLAUDE FAMILY',
        content: data.claude,
        provider: 'Anthropic · claude-sonnet',
        messageId: Date.now() + '-claude',
        thinkingLabel: 'Claude thinking...',
        streamingLabel: 'Claude streaming...',
      })
    }

    const finalCost = totalUsageCost(nextUsageRows)
    setUsageRows(nextUsageRows)
    setCurrentDecreeCost(finalCost)
    setSessionCost(prev => prev + finalCost)

    if ((data.chatgpt || data.claude) && !inputText.toLowerCase().includes('continue council discussion')) {
      const memoryActionId = `memory-save-${Date.now()}`
      addRaelAction({
        action_id: memoryActionId,
        related_opportunity_id: null,
        title: 'Memory save approval',
        question: 'Council wants permission to save this response into Chronicle memory.',
        response_options: ['Save Memory', 'Not Now'],
        urgency: 'low',
        expires_at: null,
        source_agent: 'Memory',
      })
      setMemorySavePrompt({
        reason: 'new council response may be useful later',
        memory: {
          content: `Council response: ${[data.chatgpt, data.claude].filter(Boolean).join(' ')}`.slice(0, 1200),
          source: 'council',
          family: 'Council',
          tags: ['council', 'response'],
          importance: 2,
        },
      })
    }
  }

  const submitDecree = async (decree: string, mode?: CouncilMode) => {
    const toolIntent = mode !== 'continue' && detectToolIntent(decree)
    if (toolIntent && toolRequestActiveRef.current) {
      addSystemMessage('Research already in progress.')
      return
    }

    const controller = new AbortController()
    abortControllerRef.current = controller
    councilStoppedRef.current = false
    setLoading(true)
    setTypingFamily('CHATGPT FAMILY')
    setPresence('CHATGPT FAMILY', 'thinking', 'ChatGPT analyzing...')
    setContinuationPrompt(null)
    if (mode === 'continue') {
      addSystemMessage('Council channel continuing')
    } else if (toolIntent && !beginToolRequest(controller)) {
      addSystemMessage('Research already in progress.')
      if (abortControllerRef.current === controller) abortControllerRef.current = null
      setLoading(false)
      setTypingFamily(null)
      return
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
      await revealFamilyMessages(data, inputText, toolIntent)
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
      if (toolIntent) endToolRequest()
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
      if (toolIntent) endToolRequest()
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
      addRaelAction({
        action_id: `expanded-analysis-${decree.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80)}`,
        related_opportunity_id: null,
        title: 'Expanded analysis approval',
        question: `Council requests expanded analysis. Estimated extra usage: ${formatCost(expansionNeed.extraCost)}. Reason: ${expansionNeed.reason}. Continue?`,
        response_options: ['Approve', 'Decline', 'Summarize instead'],
        urgency: expansionNeed.urgent ? 'high' : 'medium',
        expires_at: null,
        source_agent: 'Cost Guard',
      })
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

    if (isExplicitMemoryRequest(decree)) {
      void saveMemory({
        content: decree,
        source: 'decree',
        family: "RA'EL",
        tags: [detectToneMode(decree), mode ?? 'standard'],
        importance: mode === 'expanded' ? 3 : 2,
      })
    }

    if (detectOpportunityScoutIntent(decree)) {
      void runOpportunityScout()
    }

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
    if (!showContinue || councilPaused || toolRequestActive || discussionSeconds === 0 || loading || expansionPrompt || continuationPrompt) return

    const loop = window.setInterval(() => {
      const now = Date.now()
      if (now - lastAutoContinueAtRef.current < COUNCIL_CONTINUE_INTERVAL_MS) return

      lastAutoContinueAtRef.current = now
      const estimatedCost = estimateContinuationCostRef.current?.() ?? 0
      setContinuationPrompt({ estimatedCost })
      addRaelAction({
        action_id: `continue-council-${now}`,
        related_opportunity_id: null,
        title: 'Council continuation approval',
        question: `Council wants to continue discussion. Estimated extra usage: ${formatCost(estimatedCost)}.`,
        response_options: ['Allow', 'Pause', 'Stop', 'Summarize'],
        urgency: 'medium',
        expires_at: new Date(now + 5 * 60 * 1000).toISOString(),
        source_agent: 'Council',
      })
    }, 1000)

    return () => window.clearInterval(loop)
  }, [showContinue, councilPaused, toolRequestActive, discussionSeconds, loading, expansionPrompt, continuationPrompt])

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
    if (loading || councilPaused || toolRequestActiveRef.current || discussionSeconds === 0) return
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

  const familyStatusItems = [
    { key: 'CLAUDE FAMILY' as TypingFamily, label: 'CLAUDE', presence: familyPresence['CLAUDE FAMILY'] },
    { key: 'CHATGPT FAMILY' as TypingFamily, label: 'CHATGPT', presence: familyPresence['CHATGPT FAMILY'] },
    { key: 'GROK', label: 'GROK', presence: { status: 'idle', label: 'standby' } as FamilyPresence },
    { key: 'GEMINI', label: 'GEMINI', presence: { status: 'idle', label: 'standby' } as FamilyPresence },
    { key: 'RED TEAM', label: 'RED TEAM', presence: { status: 'idle', label: 'standby' } as FamilyPresence },
  ]

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
        <div className="flex flex-wrap items-center justify-end gap-4">
          <Link href="/baby"
            className="rounded px-3 py-2 text-xs font-bold tracking-widest"
            style={{ border: '1px solid rgba(56,189,248,0.35)', color: '#38BDF8', background: 'rgba(0,0,0,0.28)' }}>
            Baby AI Private
          </Link>
          {familyStatusItems.map(item => {
            const active = item.presence.status !== 'idle'

            return (
              <div key={item.key} className="flex items-center gap-1" title={item.presence.label}>
                <div
                  className={`w-2 h-2 rounded-full ${active ? 'tool-dot-active' : ''}`}
                  style={{
                    background: active ? '#00ff41' : '#203321',
                    boxShadow: active ? '0 0 8px #00ff41' : 'none',
                  }}
                />
                <span className="text-xs" style={{ color: active ? '#9AE6B4' : '#444' }}>{item.label}</span>
                {active && (
                  <span className="hidden lg:inline text-[10px] tracking-widest" style={{ color: '#555' }}>
                    {item.presence.label.toUpperCase()}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="relative z-10 flex-shrink-0">
        <ToolStatusPanel toolStatuses={toolStatuses} />
        <TokenUsagePanel rows={usageRows} currentCost={currentDecreeCost} sessionTotal={sessionCost} />
        <SmsBridgePanel bridge={smsBridge} onTest={testSmsBridge} />
        <PaymentsPayoutsPanel opportunities={incomeOpportunities} />
        <FilesEvidenceVaultPanel
          files={warRoomFiles}
          loading={filesLoading}
          message={filesMessage}
          onUpload={uploadWarRoomFile}
        />
        <NeedsRaelPanel actions={raelActions} opportunities={incomeOpportunities} onRespond={respondToRaelAction} onNotify={notifyRaelAction} />
        <IncomeRadarPanel
          opportunities={incomeOpportunities}
          loading={incomeLoading}
          view={incomeView}
          onViewChange={setIncomeView}
          onCreate={createIncomeOpportunity}
          onExpire={markIncomeOpportunityExpired}
          scout={opportunityScout}
          scoutLoading={opportunityScoutLoading}
          onScout={runOpportunityScout}
        />
        <MemoryPanel memories={memories} />
        <CodexAgentPlaceholder />
        <BabyAiObserverPanel memories={memories} actions={raelActions} opportunities={incomeOpportunities} />
        <FamilyPresencePanel presence={familyPresence} />
      </div>

      {memoryNotification && (
        <div className="fixed right-6 top-6 z-30 message-fade-in rounded px-3 py-2 text-xs font-bold tracking-widest"
          style={{ background: 'rgba(52,211,153,0.14)', border: '1px solid rgba(52,211,153,0.35)', color: '#34D399' }}>
          {memoryNotification}
        </div>
      )}

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

        {memorySavePrompt && (
          <MemorySavePromptPanel
            prompt={memorySavePrompt}
            onSave={() => {
              void saveMemory(memorySavePrompt.memory)
              setMemorySavePrompt(null)
            }}
            onDismiss={() => setMemorySavePrompt(null)}
          />
        )}

        {typingFamily && (
          <TypingIndicator familyName={typingFamily} label={familyPresence[typingFamily].label} />
        )}

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
