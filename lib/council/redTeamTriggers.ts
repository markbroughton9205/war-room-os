import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'

/** Dedupe key for one-shot Gemini repair action queue (sessionStorage + conversation metadata). */
export const GEMINI_REPAIR_ENQUEUE_METADATA_KEY = 'gemini_repair_enqueued'

const RISK_KEYWORD_GROUPS: string[][] = [
  ['sovereignty'],
  ['vendor lock'],
  ['lock-in', 'lock in'],
  ['architecture'],
  ['architecture claim'],
  ['system design'],
  ['security claim'],
  ['zero trust'],
  ['income risk'],
  ['financial risk'],
  ['revenue'],
  ['profit margin'],
  ['cash flow'],
  ['pricing model'],
  ['provider failure'],
  ['strategy blocked'],
]

function normalizeWhitespace(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Strip leading "Family Name:" style prefix from assistant content if present. */
export function stripAssistantFamilyPrefix(content: string): string {
  const t = content.trim()
  const m = t.match(
    /^(?:chatgpt|claude|grok|gemini|kimi|red team|baby ai|bridge architect)\s+family\s*:\s*/i,
  )
  if (m) return t.slice(m[0].length).trim()
  const m2 = t.match(/^red\s+team\s*:\s*/i)
  if (m2) return t.slice(m2[0].length).trim()
  return t
}

function normalizedThemeSeed(content: string): string {
  const stripped = stripAssistantFamilyPrefix(content)
  const n = normalizeWhitespace(stripped).replace(/[^a-z0-9\s]/gi, ' ')
  return n.replace(/\s+/g, ' ').slice(0, 80)
}

function tokenOverlapRatio(a: string, b: string): number {
  const ta = new Set(
    a.split(' ').filter(w => w.length > 3),
  )
  const tb = new Set(
    b.split(' ').filter(w => w.length > 3),
  )
  if (!ta.size && !tb.size) return 0
  let inter = 0
  for (const w of ta) {
    if (tb.has(w)) inter++
  }
  const union = new Set([...ta, ...tb]).size
  return union ? inter / union : 0
}

function themesMatch(contentA: string, contentB: string): boolean {
  const sa = normalizedThemeSeed(contentA)
  const sb = normalizedThemeSeed(contentB)
  if (sa.length < 14 || sb.length < 14) return false
  if (sa === sb) return true
  const shorter = sa.length <= sb.length ? sa : sb
  const longer = sa.length > sb.length ? sa : sb
  const chunk = shorter.slice(0, Math.min(48, shorter.length))
  if (chunk.length >= 14 && longer.includes(chunk)) return true
  return tokenOverlapRatio(sa, sb) >= 0.5
}

const FAMILY_NAME_TO_ORCH: Record<string, CouncilOrchestrationFamily | null> = {
  'chatgpt family': 'chatgpt',
  'claude family': 'claude',
  'grok family': 'grok',
  'gemini family': 'gemini',
  'kimi family': 'kimi',
  'red team': 'red_team',
  'baby ai': 'baby',
  'bridge architect': 'bridge_architect',
}

function familyLabelToOrch(familyName: string): CouncilOrchestrationFamily | null {
  const k = normalizeWhitespace(familyName)
  return FAMILY_NAME_TO_ORCH[k] ?? null
}

export type CouncilMessageLike = {
  familyName: string
  content: string
  messageType?: string
}

export type RedTeamEarlyContext = {
  /** Latest Ra'el decree text (this round). */
  decree: string
  /** Recent council messages (most recent last). */
  messages: CouncilMessageLike[]
  /** If the last council model call failed for a cloud family, Red Team may challenge recovery. */
  lastCouncilFamilyError: CouncilOrchestrationFamily | null
}

function isAssistantCouncilMessage(m: CouncilMessageLike): boolean {
  if (m.messageType === 'system' || m.messageType === 'decree') return false
  const n = m.familyName.trim().toUpperCase()
  if (n === "RA'EL" || n === 'RAEL' || n === 'SYSTEM') return false
  return Boolean(m.content?.trim())
}

function detectRepetitionAcrossFamilies(messages: CouncilMessageLike[]): boolean {
  const assistants = messages.filter(isAssistantCouncilMessage).slice(-8)
  if (assistants.length < 2) return false
  const byOrch: { family: CouncilOrchestrationFamily; content: string }[] = []
  for (const m of assistants) {
    const orch = familyLabelToOrch(m.familyName)
    if (!orch || orch === 'red_team' || orch === 'baby') continue
    byOrch.push({ family: orch, content: m.content })
  }
  const families = new Set(byOrch.map(x => x.family))
  if (families.size < 2) return false
  for (let i = 0; i < byOrch.length; i++) {
    for (let j = i + 1; j < byOrch.length; j++) {
      const a = byOrch[i]!
      const b = byOrch[j]!
      if (a.family === b.family) continue
      if (themesMatch(a.content, b.content)) return true
    }
  }
  return false
}

export function textContainsRedTeamRiskKeywords(text: string): boolean {
  const lower = text.toLowerCase()
  for (const group of RISK_KEYWORD_GROUPS) {
    if (group.some(g => lower.includes(g.toLowerCase()))) return true
  }
  return false
}

function recentThreadText(messages: CouncilMessageLike[], maxChars: number): string {
  const tail = messages.slice(-12)
  return tail.map(m => `${m.familyName}: ${m.content}`).join('\n').slice(-maxChars)
}

/**
 * When true, caller should run Red Team once (decree order lead and/or next orchestration pick)
 * before normal cadence — repetition, risk language, or a prior family provider failure.
 */
export function shouldInjectRedTeamEarly(ctx: RedTeamEarlyContext): boolean {
  if (ctx.lastCouncilFamilyError && ctx.lastCouncilFamilyError !== 'red_team') {
    return true
  }
  const combined = `${ctx.decree}\n${recentThreadText(ctx.messages, 8000)}`
  if (textContainsRedTeamRiskKeywords(combined)) return true
  if (detectRepetitionAcrossFamilies(ctx.messages)) return true
  return false
}
