import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'

/**
 * Ra’el / user directive discipline for Live Council.
 * Parsed from decree text (client) and echoed on `/api/chat` for server-side output shaping.
 */
export type CouncilDisciplineMode =
  | 'attendance'
  | 'analysis'
  | 'debate'
  | 'silent'
  | 'execution'
  | 'research'
  | 'council'
  | 'emergency'
  | 'red_team_only'

export type CouncilCommandAuthority = 'unrestricted' | 'rael_explicit'

export type CouncilExecutionPermission = 'open' | 'limited'

export type CouncilResponseLimits = {
  maxResponsesPerFamily: number
  maxChars: number
}

export type CouncilCommand = {
  mode: CouncilDisciplineMode
  /** Who may override autonomous defaults — latest Ra’el decree wins (see page wiring). */
  authority: CouncilCommandAuthority
  /** Directive applies for the session until superseded. */
  scope: 'session'
  /** Inclusive filter from phrases like “Gemini only”. Empty = no inclusive cap (subject to mode). */
  targetFamilies: CouncilOrchestrationFamily[]
  /** From “except Claude” style phrases. */
  excludedFamilies: CouncilOrchestrationFamily[]
  /** Provider name invoked directly (e.g. "chatgpt") — single-family lock, highest routing priority. */
  directInvocation: boolean
  /** Text after the provider name for direct invocations (e.g. "status" from "grok status"). */
  directInvocationRemainder: string
  executionPermission: CouncilExecutionPermission
  responseLimits: CouncilResponseLimits
}

export const DEFAULT_COUNCIL_COMMAND: CouncilCommand = {
  mode: 'council',
  authority: 'rael_explicit',
  scope: 'session',
  targetFamilies: [],
  excludedFamilies: [],
  directInvocation: false,
  directInvocationRemainder: '',
  executionPermission: 'open',
  responseLimits: {
    maxResponsesPerFamily: 4,
    maxChars: 12_000,
  },
}

const MODES: CouncilDisciplineMode[] = [
  'attendance',
  'analysis',
  'debate',
  'silent',
  'execution',
  'research',
  'council',
  'emergency',
  'red_team_only',
]

function isDisciplineMode(v: unknown): v is CouncilDisciplineMode {
  return typeof v === 'string' && (MODES as string[]).includes(v)
}

const FAMILY_IDS: CouncilOrchestrationFamily[] = [
  'chatgpt',
  'claude',
  'grok',
  'gemini',
  'red_team',
  'baby',
  'kimi',
  'bridge_architect',
]

function coerceFamilyArray(v: unknown): CouncilOrchestrationFamily[] {
  if (!Array.isArray(v)) return []
  const out: CouncilOrchestrationFamily[] = []
  for (const x of v) {
    if (typeof x === 'string' && (FAMILY_IDS as string[]).includes(x)) {
      out.push(x as CouncilOrchestrationFamily)
    }
  }
  return out
}

/** Merge JSON body field into defaults (POST /api/chat). */
export function coerceCouncilCommand(raw: unknown): CouncilCommand {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_COUNCIL_COMMAND }
  const o = raw as Partial<CouncilCommand>
  const maxR = Number((o.responseLimits as CouncilResponseLimits | undefined)?.maxResponsesPerFamily)
  const maxC = Number((o.responseLimits as CouncilResponseLimits | undefined)?.maxChars)
  return {
    ...DEFAULT_COUNCIL_COMMAND,
    mode: isDisciplineMode(o.mode) ? o.mode : DEFAULT_COUNCIL_COMMAND.mode,
    authority: o.authority === 'unrestricted' ? 'unrestricted' : 'rael_explicit',
    scope: 'session',
    targetFamilies: coerceFamilyArray(o.targetFamilies),
    excludedFamilies: coerceFamilyArray(o.excludedFamilies),
    directInvocation: o.directInvocation === true,
    directInvocationRemainder:
      typeof o.directInvocationRemainder === 'string' ? o.directInvocationRemainder : '',
    executionPermission: o.executionPermission === 'limited' ? 'limited' : 'open',
    responseLimits: {
      maxResponsesPerFamily: Number.isFinite(maxR) && maxR >= 1 ? Math.floor(maxR) : DEFAULT_COUNCIL_COMMAND.responseLimits.maxResponsesPerFamily,
      maxChars: Number.isFinite(maxC) && maxC >= 80 ? Math.floor(maxC) : DEFAULT_COUNCIL_COMMAND.responseLimits.maxChars,
    },
  }
}
