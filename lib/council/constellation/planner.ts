import {
  DEFAULT_CONSTELLATION_BOUNDS,
  type ConstellationBounds,
  type ConstellationPlan,
  type ConstellationSpecialistRole,
  type ConstellationStopReason,
  type TemporaryAgentPlan,
} from './types'

function createConstellationSuffix(): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 4).toUpperCase()
      : Math.random().toString(36).slice(2, 6).toUpperCase()
  return random
}

const ROLE_CATALOG: Readonly<Record<ConstellationSpecialistRole, { title: string; when: RegExp; task: string; outputSchema: string }>> = {
  research: {
    title: 'Research Agent',
    when: /\b(research|find|search|signal|evidence|source|what(?:'s|s|\s+is)\s+going)\b/i,
    task: 'Discover evidence and current signals for the mission. Do not invent sources.',
    outputSchema: 'pulsar_evidence_v1',
  },
  technical: {
    title: 'Technical Agent',
    when: /\b(architect|system|implement|code|engineer|runtime|api|model|backend)\b/i,
    task: 'Inspect technical constraints and propose a concrete implementation path.',
    outputSchema: 'orion_engineering_v1',
  },
  source: {
    title: 'Source Agent',
    when: /\b(source|citation|url|document|provenance|verify)\b/i,
    task: 'Attribute claims to sources and flag missing provenance.',
    outputSchema: 'pulsar_evidence_v1',
  },
  critic: {
    title: 'Critic Agent',
    when: /\b(risk|fail|challenge|adversar|review|weak)\b/i,
    task: 'Adversarial review of the plan: failure modes, weak evidence, recovery paths.',
    outputSchema: 'phoenix_adversarial_v1',
  },
  synthesis: {
    title: 'Synthesis Agent',
    when: /.*/,
    task: 'Integrate specialist outputs into one attributable result for ASTRA / AURORA.',
    outputSchema: 'aurora_synthesis_v1',
  },
  planning: {
    title: 'Planning Agent',
    when: /\b(plan|sequence|decompose|steps?|execution)\b/i,
    task: 'Decompose the mission into ordered steps with dependencies.',
    outputSchema: 'nova_plan_v1',
  },
  verification: {
    title: 'Verification Agent',
    when: /\b(true|false|verify|claim|check|status|health)\b/i,
    task: 'Separate fact, inference, unknown, and contradiction in specialist claims.',
    outputSchema: 'lumen_verification_v1',
  },
}

function uniqueId(constellationId: string, role: ConstellationSpecialistRole, index: number): string {
  return `${constellationId}-${role}-${index + 1}`
}

export const DEFAULT_STOPPING_CONDITIONS: readonly ConstellationStopReason[] = [
  'required_coverage_reached',
  'low_marginal_information',
  'contradictions_bounded',
  'evidence_threshold_met',
  'budget_approaching',
  'remaining_questions_not_decision_relevant',
  'max_rounds',
  'max_agents',
  'worker_expired',
]

export function defaultWorkerExpiry(createdAtIso: string, maxRounds: number): string {
  const created = Date.parse(createdAtIso) || Date.now()
  const ttlMs = Math.max(1, maxRounds) * 60 * 60 * 1000
  return new Date(created + ttlMs).toISOString()
}

export function workerIsExpired(worker: Pick<TemporaryAgentPlan, 'expiresAt'>, nowIso = new Date().toISOString()): boolean {
  return Date.parse(worker.expiresAt) <= Date.parse(nowIso)
}

export type ConstellationStopInput = {
  requiredCoverageReached: boolean
  marginalInformationLow: boolean
  contradictionsBounded: boolean
  evidenceThresholdMet: boolean
  budgetApproaching: boolean
  remainingQuestionsDecisionRelevant: boolean
  roundsUsed: number
  maxRounds: number
  agentsUsed: number
  maxAgents: number
  expiredWorkers: number
}

export function shouldStopConstellation(input: ConstellationStopInput): { stop: boolean; reasons: ConstellationStopReason[] } {
  const reasons: ConstellationStopReason[] = []
  if (input.requiredCoverageReached) reasons.push('required_coverage_reached')
  if (input.marginalInformationLow) reasons.push('low_marginal_information')
  if (input.contradictionsBounded) reasons.push('contradictions_bounded')
  if (input.evidenceThresholdMet) reasons.push('evidence_threshold_met')
  if (input.budgetApproaching) reasons.push('budget_approaching')
  if (!input.remainingQuestionsDecisionRelevant) reasons.push('remaining_questions_not_decision_relevant')
  if (input.roundsUsed >= input.maxRounds) reasons.push('max_rounds')
  if (input.agentsUsed >= input.maxAgents) reasons.push('max_agents')
  if (input.expiredWorkers > 0) reasons.push('worker_expired')
  return { stop: reasons.length > 0, reasons }
}

/**
 * ASTRA planning layer: produce a bounded Constellation plan. Does not spawn workers,
 * does not recurse, and never exceeds configured bounds. Temporary workers are role
 * instances with expiry and shutdown behavior — never new permanent identities.
 */
export function planBoundedConstellation(
  mission: string,
  bounds: ConstellationBounds = DEFAULT_CONSTELLATION_BOUNDS,
  options?: { parentMissionId?: string; createdAt?: string },
): ConstellationPlan {
  const suffix = createConstellationSuffix()
  const constellationId = `CONSTELLATION-${suffix}`
  const notes: string[] = []
  const selected = new Set<ConstellationSpecialistRole>()
  const text = mission.trim() || 'unspecified mission'
  const createdAt = options?.createdAt ?? new Date().toISOString()
  const parentMissionId = options?.parentMissionId ?? `mission-${suffix}`
  const expiresAt = defaultWorkerExpiry(createdAt, bounds.maxRounds)

  const orderedRoles: ConstellationSpecialistRole[] = [
    'research',
    'planning',
    'technical',
    'source',
    'verification',
    'critic',
    'synthesis',
  ]
  for (const role of orderedRoles) {
    if (selected.size >= bounds.maxAgentsPerConstellation) break
    if (ROLE_CATALOG[role].when.test(text)) selected.add(role)
  }
  if (!selected.has('synthesis') && selected.size < bounds.maxAgentsPerConstellation) {
    selected.add('synthesis')
  }
  if (selected.size === 0) selected.add('synthesis')

  const agents: TemporaryAgentPlan[] = [...selected].map((role, index) => {
    const id = uniqueId(constellationId, role, index)
    return {
      id,
      temporaryAgentId: id,
      displayName: `${ROLE_CATALOG[role].title} (${constellationId})`,
      role,
      task: ROLE_CATALOG[role].task,
      taskScope: ROLE_CATALOG[role].task,
      parentMissionId,
      constellationId,
      allowedTools: [],
      allowedMemoryScopes: ['working', 'constellation'],
      backendAssignment: null,
      expiresAt,
      outputSchema: ROLE_CATALOG[role].outputSchema,
      shutdownBehavior: 'retire_and_preserve_findings',
      createdBy: 'astra',
      roundIndex: 1,
      permanentIdentity: false,
    }
  })

  if (agents.length > bounds.maxAgentsPerConstellation) {
    notes.push(`trimmed_to_maxAgentsPerConstellation:${bounds.maxAgentsPerConstellation}`)
    agents.length = bounds.maxAgentsPerConstellation
  }
  const maxParallel = Math.min(bounds.maxParallelAgents, agents.length)
  notes.push(`bounded maxAgents=${bounds.maxAgentsPerConstellation} maxParallel=${maxParallel} maxRounds=${bounds.maxRounds}`)
  notes.push('Phase 1B planning only — spawned=false, temporary workers expire, no recursive spawn, no live execution.')
  notes.push('Do not create agents merely because parallelism is possible.')

  return {
    constellationId,
    displayName: constellationId,
    mission: text,
    parentMissionId,
    createdBy: 'astra',
    bounds,
    agents,
    maxParallelAgents: maxParallel,
    maxRounds: Math.min(bounds.maxRounds, DEFAULT_CONSTELLATION_BOUNDS.maxRounds),
    status: 'planned',
    spawned: false,
    stoppingConditions: DEFAULT_STOPPING_CONDITIONS,
    notes,
  }
}

export function constellationAgentIdentitiesAreUnique(plan: ConstellationPlan): boolean {
  const ids = plan.agents.map(agent => agent.temporaryAgentId)
  return new Set(ids).size === ids.length && ids.every(id => id.startsWith(plan.constellationId))
}

export function constellationRespectsBounds(plan: ConstellationPlan): boolean {
  return (
    plan.agents.length <= plan.bounds.maxAgentsPerConstellation
    && plan.maxParallelAgents <= plan.bounds.maxParallelAgents
    && plan.maxRounds <= plan.bounds.maxRounds
    && plan.spawned === false
  )
}

export function temporaryWorkersExpire(plan: ConstellationPlan): boolean {
  return plan.agents.length > 0 && plan.agents.every(agent =>
    Boolean(agent.expiresAt)
    && Number.isFinite(Date.parse(agent.expiresAt))
    && agent.shutdownBehavior === 'retire_and_preserve_findings'
    && agent.permanentIdentity === false,
  )
}

export function temporaryWorkersAreRoleInstancesNotIdentities(plan: ConstellationPlan): boolean {
  return plan.agents.every(agent => agent.permanentIdentity === false && agent.createdBy === 'astra' && !/^(aurora|nova|pulsar|phoenix|orion|lumen|solara|astra)$/i.test(agent.id))
}
