import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'

export type DirectInvocationResult = {
  invoked: boolean
  family: CouncilOrchestrationFamily | null
  remainder: string
}

type InvocationEntry = {
  family: CouncilOrchestrationFamily
  aliases: string[]
}

/** Longer aliases must sort first when scanning. */
const INVOCATION_TABLE: InvocationEntry[] = [
  {
    family: 'bridge_architect',
    aliases: ['bridge architect', 'bridge-architect', 'bridge'],
  },
  {
    family: 'red_team',
    aliases: ['red team', 'red_team', 'red-team', 'redteam'],
  },
  { family: 'chatgpt', aliases: ['chat gpt', 'chatgpt', 'openai'] },
  { family: 'claude', aliases: ['claude', 'anthropic'] },
  { family: 'grok', aliases: ['grok', 'xai'] },
  { family: 'gemini', aliases: ['gemini', 'google ai', 'google'] },
  { family: 'kimi', aliases: ['kimi', 'moonshot'] },
  { family: 'baby', aliases: ['baby ai', 'baby', 'observer'] },
]

const SORTED_ALIASES: { family: CouncilOrchestrationFamily; alias: string }[] = INVOCATION_TABLE.flatMap(
  entry => entry.aliases.map(alias => ({ family: entry.family, alias })),
).sort((a, b) => b.alias.length - a.alias.length)

/** Leading council/attendance phrases suppress direct lock (e.g. "council chatgpt"). */
const SUPPRESS_DIRECT_PREFIX =
  /^\s*(?:council|attendance|war\s*council|roll\s*call)\b/i

/** Whole-decree attendance / roll-call must not lock to a provider alias embedded in the text. */
const SUPPRESS_DIRECT_ATTENDANCE_BODY =
  /\b(?:attendance|roll\s*call|presence\s*only|one\s*(?:response|line)\s*each)\b/i

const INVOCATION_PREFIX_RE =
  /^(?:hey|yo|hello|hi|wassup|what's up|where is|call|summon)\s+/i

const RAW_INVOCATION_PREFIX_RE =
  /^\s*(?:hey|yo|hello|hi|wassup|what['’]s\s+up|where\s+is|call|summon)\s+/i

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeComparable(text: string): string {
  return text.trim().toLowerCase().replace(/\u2019/g, "'").replace(/\s+/g, ' ')
}

function stripAliasPrefix(raw: string, alias: string): string {
  const re = new RegExp(`^\\s*${escapeRegex(alias)}\\s*[,!?:.\\-]*\\s*`, 'i')
  const m = raw.match(re)
  if (!m) return raw.trim()
  return raw.slice(m[0].length).trim()
}

function stripInvocationPrefix(raw: string): string {
  return raw.replace(RAW_INVOCATION_PREFIX_RE, '').trim()
}

function matchesAtStart(normalized: string, alias: string): boolean {
  const a = alias.toLowerCase()
  if (normalized === a) return true
  if (normalized.startsWith(`${a} `)) return true
  if (/^[,!?:.\-]/.test(normalized.charAt(a.length)) && normalized.startsWith(a)) return true
  return false
}

/** True when decree opens with council/attendance framing instead of a bare provider name. */
export function decreeSuppressesDirectInvocation(text: string): boolean {
  const raw = typeof text === 'string' ? text : ''
  if (SUPPRESS_DIRECT_PREFIX.test(raw)) return true
  if (SUPPRESS_DIRECT_ATTENDANCE_BODY.test(raw)) return true
  return false
}

/**
 * Detect Ra'el addressing a single council family by provider name.
 * Exact name or name-first (case-insensitive); remainder is text after the alias.
 */
export function detectDirectInvocation(text: string): DirectInvocationResult {
  const raw = typeof text === 'string' ? text.trim() : ''
  if (!raw) return { invoked: false, family: null, remainder: '' }

  if (decreeSuppressesDirectInvocation(raw)) {
    return { invoked: false, family: null, remainder: raw }
  }

  const normalized = normalizeComparable(raw)
  const normalizedCandidate = normalized.replace(INVOCATION_PREFIX_RE, '').trim()
  const rawCandidate = normalizedCandidate === normalized ? raw : stripInvocationPrefix(raw)

  for (const { family, alias } of SORTED_ALIASES) {
    if (!matchesAtStart(normalizedCandidate, alias)) continue
    const remainder = stripAliasPrefix(rawCandidate, alias)
    return { invoked: true, family, remainder }
  }

  return { invoked: false, family: null, remainder: raw }
}

export function familyDisplayName(family: CouncilOrchestrationFamily): string {
  if (family === 'red_team') return 'Red Team'
  if (family === 'bridge_architect') return 'Bridge Architect'
  return family.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
