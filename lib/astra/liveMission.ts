/**
 * Roadmap #14 — ASTRA live mission orchestration.
 *
 * Activates the existing ASTRA foundation:
 * - Nebula identity `astra` (orchestration-only, status foundation, no live Council seat)
 * - classifyAstraIntent / decomposeAstraMission (Build #5 scout-swarm planner)
 * - planBoundedConstellation (plan only; CONSTELLATION LIVE SPAWN DEFERRED)
 *
 * Does not create ASTRA2, a second agent runtime, or unrestricted autonomy.
 * Selection of a Terra object never creates or executes a mission.
 */
import { randomUUID } from 'node:crypto'
import { planBoundedConstellation, type ConstellationPlan } from '@/lib/council/constellation'
import { classifyAstraIntent, type AstraIntent } from '@/lib/council/nebula/roundFlow'
import { isOrchestrationOnly } from '@/lib/council/nebula/roleContracts'
import { decomposeAstraMission } from '@/lib/council/scout-swarm/mission'
import type { AstraMissionPlan } from '@/lib/council/scout-swarm/types'
import {
  isTerraHandoffBody,
  type TerraCouncilHandoffPayload,
} from '@/lib/terra/councilHandoff'
import {
  isAstraObservedVessel,
  observedVesselFromTerraSeed,
  type AstraObservedVessel,
} from './observedVessel'

export const ASTRA_MISSION_STATUSES = ['planned', 'running', 'completed', 'failed'] as const
export type AstraMissionStatus = (typeof ASTRA_MISSION_STATUSES)[number]

export const ASTRA_MISSION_AUDIT_KINDS = [
  'MISSION_CREATED',
  'MISSION_EXECUTION_STARTED',
  'MISSION_COMPLETED',
  'MISSION_FAILED',
] as const
export type AstraMissionAuditKind = (typeof ASTRA_MISSION_AUDIT_KINDS)[number]

export type AstraMissionAuditEvent = {
  at: string
  kind: AstraMissionAuditKind
  detail: string
}

export type AstraPersistenceBackend = 'supabase' | 'local_filesystem_fallback'

export type AstraCouncilExecutionMeta = {
  durationMs: number
  roster: string[]
  stages: string[]
  synthesisPresent: boolean
  deliberationMode: string | null
}

export type AstraLiveMission = {
  id: string
  status: AstraMissionStatus
  objective: string
  intent: AstraIntent
  commanderUserId: string
  createdAt: string
  updatedAt: string
  plannedAt: string | null
  startedAt: string | null
  completedAt: string | null
  failedAt: string | null
  terraSeed: TerraCouncilHandoffPayload | null
  observedVessel: AstraObservedVessel | null
  plan: AstraMissionPlan | null
  constellation: ConstellationPlan | null
  constellationSpawned: false
  astraProvidesSubstantiveAnswer: false
  councilConversationId: string | null
  councilExecution: AstraCouncilExecutionMeta | null
  outcomeSummary: string | null
  error: string | null
  persistenceBackend: AstraPersistenceBackend | null
  audit: AstraMissionAuditEvent[]
}

export type CreateAstraLiveMissionInput = {
  commanderUserId: string
  objective: string
  terraSeed?: unknown
  observedVessel?: unknown
  nowIso?: string
}

export type AstraExecuteConflictCode =
  | 'already_running'
  | 'already_completed'
  | 'already_failed'

export function normalizeAstraObjective(raw: string): string | null {
  const objective = raw.trim()
  return objective.length >= 8 ? objective : null
}

export function terraSeedFromUnknown(value: unknown): TerraCouncilHandoffPayload | null {
  return isTerraHandoffBody(value) ? value : null
}

export function isAstraMissionStatus(value: unknown): value is AstraMissionStatus {
  return typeof value === 'string' && (ASTRA_MISSION_STATUSES as readonly string[]).includes(value)
}

export function astraExecuteConflict(status: AstraMissionStatus): AstraExecuteConflictCode | null {
  if (status === 'planned') return null
  if (status === 'running') return 'already_running'
  if (status === 'completed') return 'already_completed'
  return 'already_failed'
}

export function createAstraLiveMission(input: CreateAstraLiveMissionInput): AstraLiveMission | null {
  const objective = normalizeAstraObjective(input.objective)
  if (!objective) return null
  const now = input.nowIso ?? new Date().toISOString()
  const id = `astra-mission-${randomUUID()}`
  const terraSeed = terraSeedFromUnknown(input.terraSeed)
  const extraVessel = isAstraObservedVessel(input.observedVessel) ? input.observedVessel : null
  const observedVessel = observedVesselFromTerraSeed(terraSeed, extraVessel)
  const roundRequestId = `astra-${id}`
  const plan = decomposeAstraMission({
    decree: objective,
    roundRequestId,
    logicalRequestId: id,
    nowIso: now,
  })
  const constellation = planBoundedConstellation(objective, undefined, {
    parentMissionId: id,
    createdAt: now,
  })
  return {
    id,
    status: 'planned',
    objective,
    intent: classifyAstraIntent(objective),
    commanderUserId: input.commanderUserId,
    createdAt: now,
    updatedAt: now,
    plannedAt: now,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    terraSeed,
    observedVessel,
    plan,
    constellation,
    constellationSpawned: false,
    astraProvidesSubstantiveAnswer: false,
    councilConversationId: null,
    councilExecution: null,
    outcomeSummary: null,
    error: null,
    persistenceBackend: null,
    audit: [
      {
        at: now,
        kind: 'MISSION_CREATED',
        detail: 'Commander explicitly created an ASTRA mission. Selection alone did not create it. Create did not execute.',
      },
    ],
  }
}

export function markAstraMissionRunning(mission: AstraLiveMission, nowIso = new Date().toISOString()): AstraLiveMission {
  if (astraExecuteConflict(mission.status)) return mission
  return {
    ...mission,
    status: 'running',
    updatedAt: nowIso,
    startedAt: nowIso,
    error: null,
    audit: [
      ...mission.audit,
      { at: nowIso, kind: 'MISSION_EXECUTION_STARTED', detail: 'Commander explicitly requested execution. ASTRA remains orchestration-only. Constellation workers stay planned/spawned=false.' },
    ],
  }
}

export function markAstraMissionCompleted(mission: AstraLiveMission, args: {
  councilConversationId?: string | null
  outcomeSummary: string
  councilExecution?: AstraCouncilExecutionMeta | null
  nowIso?: string
}): AstraLiveMission {
  const now = args.nowIso ?? new Date().toISOString()
  return {
    ...mission,
    status: 'completed',
    updatedAt: now,
    completedAt: now,
    failedAt: null,
    councilConversationId: args.councilConversationId ?? mission.councilConversationId,
    councilExecution: args.councilExecution ?? mission.councilExecution,
    outcomeSummary: args.outcomeSummary,
    error: null,
    audit: [
      ...mission.audit,
      { at: now, kind: 'MISSION_COMPLETED', detail: args.outcomeSummary },
    ],
  }
}

export function markAstraMissionFailed(mission: AstraLiveMission, error: string, nowIso = new Date().toISOString()): AstraLiveMission {
  return {
    ...mission,
    status: 'failed',
    updatedAt: nowIso,
    failedAt: nowIso,
    error,
    audit: [
      ...mission.audit,
      { at: nowIso, kind: 'MISSION_FAILED', detail: error },
    ],
  }
}

export function withAstraConversationId(mission: AstraLiveMission, conversationId: string, nowIso = new Date().toISOString()): AstraLiveMission {
  if (mission.councilConversationId === conversationId) return mission
  return {
    ...mission,
    councilConversationId: conversationId,
    updatedAt: nowIso,
  }
}

export function astraMissionPublicView(mission: AstraLiveMission) {
  return {
    id: mission.id,
    status: mission.status,
    objective: mission.objective,
    intent: mission.intent,
    createdAt: mission.createdAt,
    updatedAt: mission.updatedAt,
    plannedAt: mission.plannedAt,
    startedAt: mission.startedAt,
    completedAt: mission.completedAt,
    failedAt: mission.failedAt,
    astraProvidesSubstantiveAnswer: mission.astraProvidesSubstantiveAnswer,
    constellationSpawned: mission.constellationSpawned,
    constellationStatus: mission.constellation?.status ?? 'planned',
    orchestrationOnly: isOrchestrationOnly('astra'),
    selectedPermanentSeats: mission.plan?.selectedPermanentSeats ?? [],
    constellationId: mission.constellation?.constellationId ?? null,
    terraObjectId: mission.terraSeed?.lineage.objectId ?? mission.observedVessel?.mmsi ?? null,
    terraObjectType: mission.terraSeed?.lineage.type ?? null,
    terraMmsi: mission.observedVessel?.mmsi ?? null,
    terraProvider: mission.terraSeed?.lineage.provider ?? mission.observedVessel?.provider ?? null,
    terraEvidenceId: mission.terraSeed?.lineage.evidenceId ?? mission.observedVessel?.evidenceId ?? null,
    terraLatitude: mission.terraSeed?.lineage.latitude ?? mission.observedVessel?.latitude ?? null,
    terraLongitude: mission.terraSeed?.lineage.longitude ?? mission.observedVessel?.longitude ?? null,
    terraObservedAt: mission.terraSeed?.lineage.observedAt ?? mission.observedVessel?.observedAt ?? null,
    terraFreshness: mission.terraSeed?.lineage.freshness ?? mission.observedVessel?.freshness ?? null,
    terraOriginRetained: mission.terraSeed ? 'TERRA' : null,
    observedVessel: mission.observedVessel,
    councilConversationId: mission.councilConversationId,
    councilExecution: mission.councilExecution,
    outcomeSummary: mission.outcomeSummary,
    error: mission.error,
    persistenceBackend: mission.persistenceBackend,
    audit: mission.audit,
  }
}

const SECRET_PATTERN = /api[_-]?key|Bearer |sk-|service[_-]?role|SUPABASE_SERVICE/i

export function astraMissionContainsSecrets(value: unknown): boolean {
  return SECRET_PATTERN.test(JSON.stringify(value))
}

export function buildAstraCouncilChatBody(mission: AstraLiveMission, conversationId: string | null): Record<string, unknown> {
  return {
    message: mission.objective,
    raelDirectiveText: mission.objective,
    profile: '',
    threadHistory: [],
    mode: 'continue',
    toneMode: 'casual',
    orchestrationAugment: '',
    councilCommand: { mode: 'normal', directInvocation: false, targetFamilies: [] },
    councilIntentKind: 'general',
    councilActiveScope: 'general',
    councilFlowMode: 'stable_group',
    councilDeliberationMode: 'family_to_family_v1',
    councilLogicalRequestId: mission.id,
    conversationId,
    ...(mission.terraSeed ? { terraHandoff: mission.terraSeed } : {}),
  }
}

export function extractAstraCouncilOutcome(payload: Record<string, unknown>): {
  text: string
  conversationId: string | null
  meta: AstraCouncilExecutionMeta
} {
  const familyDeliberation = payload.familyDeliberation && typeof payload.familyDeliberation === 'object'
    ? payload.familyDeliberation as Record<string, unknown>
    : null
  const turns = Array.isArray(familyDeliberation?.turns) ? familyDeliberation.turns as Record<string, unknown>[] : []
  const synthesisTurn = turns.find(turn => turn.turn_id === familyDeliberation?.synthesis_turn_id)
  const synthesisText = typeof synthesisTurn?.full_response === 'string' ? synthesisTurn.full_response.trim() : ''
  const single = typeof payload.councilSingleResponse === 'string' ? payload.councilSingleResponse.trim() : ''
  const results = Array.isArray(payload.results) ? payload.results as Record<string, unknown>[] : []
  const resultText = results.map(item => typeof item.content === 'string' ? item.content.trim() : '').find(Boolean) ?? ''
  const text = single || synthesisText || resultText
  const roster = [...new Set(turns.map(turn => {
    if (typeof turn.provider_family === 'string') return turn.provider_family
    if (typeof turn.provider_label === 'string') return turn.provider_label
    return ''
  }).filter(Boolean))]
  const roles = turns.map(turn => typeof turn.turn_role === 'string' ? turn.turn_role : '').filter(Boolean)
  const conversationId = typeof payload.conversationId === 'string' && payload.conversationId.trim()
    ? payload.conversationId.trim()
    : null
  return {
    text,
    conversationId,
    meta: {
      durationMs: 0,
      roster,
      stages: roles,
      synthesisPresent: Boolean(text) && (Boolean(familyDeliberation?.synthesis_turn_id) || Boolean(single)),
      deliberationMode: familyDeliberation ? 'family_to_family_v1' : null,
    },
  }
}
