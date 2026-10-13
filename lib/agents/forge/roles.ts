import type { SpecialistRole } from './pool'
import type { TaskClass } from './types'

/**
 * Compute-stage roles. A role is a job class with its own pass criteria, not a property of a model: a model holds a role only through
 * benchmark evidence recorded for that role (rank.ts). The Phase 10 pool roles map onto these so the legacy path is unchanged.
 */
export const MODEL_ROLES = ['PRIMARY_BUILDER', 'ARCHITECT_REVIEWER', 'DEBUGGER_TEST_SPECIALIST', 'FAST_REPAIR_WORKER', 'RESEARCH_GENERALIST', 'CODE_RETRIEVAL', 'RERANKER', 'SECURITY_REVIEWER'] as const
export type ModelRole = (typeof MODEL_ROLES)[number]
export const isModelRole = (v: unknown): v is ModelRole => typeof v === 'string' && (MODEL_ROLES as readonly string[]).includes(v)

/** Legacy pool role -> compute role. ESCALATION has no compute role: a FUTURE_HEAVY model is never scheduled implicitly. */
export const LEGACY_TO_MODEL_ROLE: Record<SpecialistRole, ModelRole | null> = {
  BUILDER: 'PRIMARY_BUILDER',
  TEST_REVIEWER: 'ARCHITECT_REVIEWER',
  TEST_WRITER: 'DEBUGGER_TEST_SPECIALIST',
  TEST_CANDIDATE: 'FAST_REPAIR_WORKER',
  ESCALATION: null,
}

/** Pre-role benchmark records carry only a task class. Only these explicit one-to-one mappings count as evidence for a role; no role borrows from another. */
export const LEGACY_TASK_EVIDENCE: Partial<Record<ModelRole, TaskClass>> = {
  PRIMARY_BUILDER: 'complete_feature',
  ARCHITECT_REVIEWER: 'review',
  DEBUGGER_TEST_SPECIALIST: 'debugging',
}

/** Qualification gates per role. Proposed in the plan and fixed before any model is run; not to be changed after seeing results. */
export type RoleGate = { minRuns: number; minRate: number }
export const ROLE_GATES: Record<ModelRole, RoleGate> = {
  PRIMARY_BUILDER: { minRuns: 9, minRate: 1 },
  ARCHITECT_REVIEWER: { minRuns: 10, minRate: 0.8 },
  DEBUGGER_TEST_SPECIALIST: { minRuns: 10, minRate: 0.8 },
  FAST_REPAIR_WORKER: { minRuns: 10, minRate: 0.9 },
  RESEARCH_GENERALIST: { minRuns: 10, minRate: 0.85 },
  CODE_RETRIEVAL: { minRuns: 10, minRate: 0.9 },
  RERANKER: { minRuns: 10, minRate: 0.9 },
  SECURITY_REVIEWER: { minRuns: 10, minRate: 0.8 },
}
