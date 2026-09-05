import type { NebulaAgentId } from '@/lib/council/nebula/identity'
import type { NebulaMemoryScope } from '@/lib/council/nebula/memory'

/**
 * ASTRA Constellation foundation — bounded temporary specialist teams.
 * Temporary agents are role instances, not new permanent identities.
 * Phase 1B: planning + lifecycle contracts. No live spawning, no recursive creation.
 */

export type ConstellationId = string
export type TemporaryAgentId = string

export type ConstellationSpecialistRole =
  | 'research'
  | 'technical'
  | 'source'
  | 'critic'
  | 'synthesis'
  | 'planning'
  | 'verification'

export type ConstellationBounds = {
  maxAgentsPerConstellation: number
  maxParallelAgents: number
  maxRounds: number
}

export const DEFAULT_CONSTELLATION_BOUNDS: ConstellationBounds = Object.freeze({
  maxAgentsPerConstellation: 8,
  maxParallelAgents: 4,
  maxRounds: 3,
})

export type TemporaryWorkerShutdownBehavior = 'retire_and_preserve_findings' | 'discard'

export type TemporaryAgentPlan = {
  /** Unique within the constellation and across concurrent constellations. */
  id: TemporaryAgentId
  temporaryAgentId: TemporaryAgentId
  displayName: string
  role: ConstellationSpecialistRole
  task: string
  taskScope: string
  parentMissionId: string
  constellationId: ConstellationId
  allowedTools: readonly string[]
  allowedMemoryScopes: readonly NebulaMemoryScope[]
  backendAssignment: string | null
  expiresAt: string
  outputSchema: string
  shutdownBehavior: TemporaryWorkerShutdownBehavior
  /** Attribution: this temporary worker was created by ASTRA for a specific mission. */
  createdBy: Extract<NebulaAgentId, 'astra'>
  roundIndex: number
  /** Temporary workers are never permanent Nebula identities. */
  permanentIdentity: false
}

export type ConstellationStopReason =
  | 'required_coverage_reached'
  | 'low_marginal_information'
  | 'contradictions_bounded'
  | 'evidence_threshold_met'
  | 'budget_approaching'
  | 'remaining_questions_not_decision_relevant'
  | 'max_rounds'
  | 'max_agents'
  | 'worker_expired'

export type ConstellationPlan = {
  constellationId: ConstellationId
  displayName: string
  mission: string
  parentMissionId: string
  createdBy: Extract<NebulaAgentId, 'astra'>
  bounds: ConstellationBounds
  agents: TemporaryAgentPlan[]
  maxParallelAgents: number
  maxRounds: number
  status: 'planned'
  /** Always false until a later live-execution phase. */
  spawned: false
  stoppingConditions: readonly ConstellationStopReason[]
  notes: string[]
}

export type ConstellationLifecycle = {
  constellationId: ConstellationId
  status: 'planned' | 'running' | 'synthesizing' | 'terminated'
  terminateAfterMission: true
  autonomousRecursiveSpawnEnabled: false
  workersExpire: true
}
