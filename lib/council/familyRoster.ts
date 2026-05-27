import type { EngineId, EngineStatus } from '@/lib/engine-control/types'
import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'

/** Duty persisted under `conversation.metadata.council.duty[familyId]` or local-only mirror. */
export type CouncilDutyState =
  | 'off_duty'
  | 'standing_by'
  | 'working'
  | 'waiting_approval'
  | 'blocked'
  | 'completed'

export type FamilyRosterEntry = {
  id: CouncilOrchestrationFamily
  label: string
  role: string
  provider: string
  optional: boolean
  engineId: EngineId | null
  /** Local invoke id when cloud path absent */
  localAgentId: string | null
  defaultDuty: CouncilDutyState
}

export const LIVE_COUNCIL_CONV_STORAGE_KEY = 'war-room-live-council-conversation-id'

export const COUNCIL_PLANNING_KEYWORDS = /\b(plan|council|organize|money|income)\b/i

export const COUNCIL_ROSTER: FamilyRosterEntry[] = [
  {
    id: 'chatgpt',
    label: 'ChatGPT Family',
    role: 'Strategy, revenue, synthesis',
    provider: 'OpenAI',
    optional: false,
    engineId: 'chatgpt',
    localAgentId: 'chatgpt-family-baby',
    defaultDuty: 'standing_by',
  },
  {
    id: 'claude',
    label: 'Claude Family',
    role: 'Architecture, truth, precision',
    provider: 'Anthropic',
    optional: false,
    engineId: 'claude',
    localAgentId: 'claude-family-baby',
    defaultDuty: 'standing_by',
  },
  {
    id: 'grok',
    label: 'Grok Family',
    role: 'Signals, contradictions, framing',
    provider: 'xAI',
    optional: false,
    engineId: 'grok',
    localAgentId: 'grok-family-baby',
    defaultDuty: 'standing_by',
  },
  {
    id: 'gemini',
    label: 'Gemini Family',
    role: 'Reasoning, synthesis, long context',
    provider: 'Google',
    optional: false,
    engineId: 'gemini',
    localAgentId: null,
    defaultDuty: 'standing_by',
  },
  {
    id: 'kimi',
    label: 'Kimi Family',
    role: 'Decomposition, task sequencing, execution planning',
    provider: 'Moonshot',
    optional: false,
    engineId: 'kimi',
    localAgentId: 'kimi-family-baby',
    defaultDuty: 'standing_by',
  },
  {
    id: 'red_team',
    label: 'Red Team',
    role: 'Adversarial review',
    provider: 'Anthropic (adversarial)',
    optional: true,
    engineId: 'claude',
    localAgentId: 'red-team-baby',
    defaultDuty: 'off_duty',
  },
  {
    id: 'bridge_architect',
    label: 'Bridge Architect',
    role: 'Systems / bridge reasoning',
    provider: 'Local',
    optional: true,
    engineId: null,
    localAgentId: 'bridge-architect-baby',
    defaultDuty: 'off_duty',
  },
  {
    id: 'baby',
    label: 'Baby AI',
    role: 'Observer',
    provider: 'OpenAI / local',
    optional: true,
    engineId: 'chatgpt',
    localAgentId: 'chatgpt-family-baby',
    defaultDuty: 'off_duty',
  },
]

const DEFAULT_CORE: CouncilOrchestrationFamily[] = ['chatgpt', 'claude', 'grok', 'gemini']

const INCOME_FIRST: CouncilOrchestrationFamily[] = ['grok', 'gemini', 'chatgpt', 'claude']

export function engineRowMap(engines: EngineStatus[]): Map<EngineId, EngineStatus> {
  return new Map(engines.map(e => [e.id, e]))
}

export function isEngineFunctional(map: Map<EngineId, EngineStatus>, id: EngineId | null): boolean {
  if (!id) return false
  return Boolean(map.get(id)?.functional)
}

export function unavailableReason(row: EngineStatus | undefined): string {
  if (!row) return 'engine status unknown'
  if (row.functional) return 'ok'
  const bits = [
    row.configured ? 'configured' : 'not configured',
    row.reachable ? 'reachable' : 'not reachable',
  ]
  if (row.notes?.trim()) bits.push(row.notes.trim())
  return bits.join('; ')
}

export function detectCouncilPlanningMode(decree: string): boolean {
  return COUNCIL_PLANNING_KEYWORDS.test(decree)
}

export function decreeRequestsKimi(decree: string): boolean {
  return /\b(decompose|break\s*down|sequenc|kimi|moonshot)\b/i.test(decree)
}

export function decreeRequestsArchitecture(decree: string): boolean {
  return /\b(architecture|systems?\s*design|bridge|integrat)\b/i.test(decree)
}

export function decreeRequestsRisk(decree: string): boolean {
  return /\b(risk|adversar|red\s*team|attack\s*surface)\b/i.test(decree)
}

export function decreeMentionsBaby(decree: string): boolean {
  return /\b(baby|observer|alignment|tone)\b/i.test(decree)
}

export type CouncilParticipationToggles = {
  includeKimi: boolean
  includeRedTeam: boolean
  includeBaby: boolean
  includeBridgeArchitect: boolean
}

export function participationFromDecree(decree: string, toggles: CouncilParticipationToggles): CouncilOrchestrationFamily[] {
  const extra: CouncilOrchestrationFamily[] = []
  if (toggles.includeKimi || decreeRequestsKimi(decree)) extra.push('kimi')
  if (toggles.includeRedTeam || decreeRequestsRisk(decree)) extra.push('red_team')
  if (toggles.includeBaby || decreeMentionsBaby(decree)) extra.push('baby')
  if (toggles.includeBridgeArchitect || decreeRequestsArchitecture(decree)) extra.push('bridge_architect')
  return extra
}

/** Default decree order: functional core four; income mode prefers Grok/Gemini first. */
export function buildDecreeFamilyOrder(params: {
  incomeOperationsMode: boolean
  planningMode: boolean
  extraFamilies: CouncilOrchestrationFamily[]
  maxFamilies: number
  /** When only one family speaks, rotate through `merged` instead of always using index 0. */
  singleFamilyRotate?: number
  /** Red Team first this decree (repetition / risk / recovery challenge). */
  leadWithRedTeam?: boolean
}): CouncilOrchestrationFamily[] {
  const base = params.incomeOperationsMode ? [...INCOME_FIRST] : [...DEFAULT_CORE]
  const merged: CouncilOrchestrationFamily[] = []
  const seen = new Set<string>()
  for (const f of [...base, ...params.extraFamilies]) {
    if (seen.has(f)) continue
    seen.add(f)
    merged.push(f)
  }
  if (params.leadWithRedTeam) {
    const without = merged.filter(f => f !== 'red_team')
    merged.length = 0
    merged.push('red_team', ...without)
  }
  const planningCap = DEFAULT_CORE.length
    + params.extraFamilies.length
    + (params.leadWithRedTeam && !params.extraFamilies.includes('red_team') ? 1 : 0)
  const cap = Math.min(
    merged.length,
    params.planningMode ? Math.min(params.maxFamilies, planningCap) : params.maxFamilies,
  )
  let result = merged.slice(0, cap)
  if (
    cap === 1
    && typeof params.singleFamilyRotate === 'number'
    && merged.length > 0
  ) {
    const off = ((params.singleFamilyRotate % merged.length) + merged.length) % merged.length
    result = [merged[off]!]
  }
  return result
}
