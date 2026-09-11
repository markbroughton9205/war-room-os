import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'

/** Canonical provider-neutral seat for the strategy / sequencing role (NOVA). */
export const CANONICAL_STRATEGY_SEAT = 'nova' as const satisfies CouncilOrchestrationFamily

/**
 * Pre-Nebula Council keyed the strategy seat as Moonshot/`kimi`.
 * This string is a historical persisted-record id only. It is not a live provider,
 * command alias, or current Council seat.
 */
export const LEGACY_STRATEGY_SEAT_ALIAS = 'kimi' as const

export const KIMI_MOONSHOT_NOT_INSTALLED_MESSAGE =
  'KIMI / MOONSHOT PROVIDER IS NOT INSTALLED IN WAR ROOM.'

const CANONICAL_SEATS: ReadonlySet<string> = new Set([
  'chatgpt',
  'claude',
  'grok',
  'gemini',
  'red_team',
  'baby',
  'nova',
  'bridge_architect',
])

const LEGACY_PERSISTED_SEAT_ALIASES: Readonly<Record<string, CouncilOrchestrationFamily>> = Object.freeze({
  kimi: 'nova',
  moonshot: 'nova',
  'kimi family': 'nova',
  'nova council': 'nova',
})

const UNINSTALLED_COMMAND_TOKENS = new Set(['kimi', 'moonshot'])

function compactSeatKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function underscoredSeatKey(raw: string): string {
  return compactSeatKey(raw).replace(/\s+/g, '_')
}

/**
 * Current command / new-write seat resolution.
 * Does NOT map kimi or moonshot to nova. Unknown strings return null.
 */
export function canonicalizeCouncilSeat(raw: unknown): CouncilOrchestrationFamily | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const spaced = compactSeatKey(raw)
  if (!spaced) return null
  const underscored = underscoredSeatKey(raw)
  if (UNINSTALLED_COMMAND_TOKENS.has(spaced) || UNINSTALLED_COMMAND_TOKENS.has(underscored)) return null
  if (spaced === 'nova council') return 'nova'
  if (CANONICAL_SEATS.has(underscored)) return underscored as CouncilOrchestrationFamily
  return null
}

/**
 * Old persisted record reading / migration only.
 * Maps historical `kimi`, `moonshot`, and "Kimi Family" rows onto NOVA.
 * Never use this to accept a current provider invocation.
 */
export function migrateLegacyPersistedSeat(raw: unknown): CouncilOrchestrationFamily | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const spaced = compactSeatKey(raw)
  if (!spaced) return null
  const underscored = underscoredSeatKey(raw)
  if (LEGACY_PERSISTED_SEAT_ALIASES[spaced]) return LEGACY_PERSISTED_SEAT_ALIASES[spaced]
  if (LEGACY_PERSISTED_SEAT_ALIASES[underscored]) return LEGACY_PERSISTED_SEAT_ALIASES[underscored]
  return canonicalizeCouncilSeat(raw)
}

export function isLegacyStrategySeatAlias(raw: unknown): boolean {
  if (typeof raw !== 'string') return false
  const key = underscoredSeatKey(raw)
  return key === 'kimi' || key === 'moonshot' || compactSeatKey(raw) === 'kimi family'
}

function stripInvocationPrefix(normalized: string): string {
  return normalized.replace(/^(?:hey|yo|hello|hi|wassup|what['']s up|where is|call|summon)\s+/, '').trim()
}

/**
 * True when the Commander addressed Kimi/Moonshot as a current command
 * (leading token / "kimi only" / "continue kimi"). Does not fire on research
 * mentions such as KIMI_WAVE in a longer decree.
 */
export function detectUninstalledKimiMoonshotCommand(text: unknown): boolean {
  if (typeof text !== 'string' || !text.trim()) return false
  const normalized = text.trim().toLowerCase().replace(/\u2019/g, "'").replace(/\s+/g, ' ')
  const candidate = stripInvocationPrefix(normalized)
  const leading = candidate.match(/^(kimi|moonshot)(?=\s|$|[,!?:.\-])/)
  if (leading) return true
  if (/^(?:continue\s+)(kimi|moonshot)\b/.test(candidate)) return true
  if (/\b(kimi|moonshot)\s+only\b/.test(candidate)) return true
  return false
}

export function kimiMoonshotNotInstalledNotice(): string {
  return KIMI_MOONSHOT_NOT_INSTALLED_MESSAGE
}
