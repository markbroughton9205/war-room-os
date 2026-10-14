import { schedule, type Placement, type PlacementOk, type World } from './scheduler'
import type { ModelRole } from './roles'

/**
 * Task intent -> role -> model. The scheduler picks the model for a role from that role's own evidence; this layer only maps what Foundry wants done
 * to a role and says what happens when no model is qualified for it. Fallbacks are explicit and conservative:
 *   BUILDER        the PRIMARY_BUILDER may do the work itself (repair, diagnosis, research notes);
 *   DETERMINISTIC  a non-model method exists (keyword search, keep the retrieval order);
 *   NONE           nothing stands in: an independent review or a security review is never done by the model that wrote the code, and is reported UNAVAILABLE.
 * Intents with no qualifying evidence for a smaller role go to the builder: 'small_implementation' is deliberately mapped to the builder because the
 * FAST_REPAIR suite measures bounded edits, not writing new code.
 */
export type TaskIntent =
  | 'syntax_import_repair' | 'bounded_edit' | 'small_implementation' | 'feature_build' | 'multi_file_implementation'
  | 'architecture_decision' | 'contract_review' | 'failure_diagnosis' | 'technical_research' | 'repo_context_search' | 'rerank_candidates' | 'security_review'

export const INTENT_ROLE: Record<TaskIntent, ModelRole> = {
  syntax_import_repair: 'FAST_REPAIR_WORKER', bounded_edit: 'FAST_REPAIR_WORKER',
  small_implementation: 'PRIMARY_BUILDER', feature_build: 'PRIMARY_BUILDER', multi_file_implementation: 'PRIMARY_BUILDER',
  architecture_decision: 'ARCHITECT_REVIEWER', contract_review: 'ARCHITECT_REVIEWER', failure_diagnosis: 'DEBUGGER_TEST_SPECIALIST',
  technical_research: 'RESEARCH_GENERALIST', repo_context_search: 'CODE_RETRIEVAL', rerank_candidates: 'RERANKER', security_review: 'SECURITY_REVIEWER',
}
export type Fallback = 'BUILDER' | 'DETERMINISTIC' | 'NONE'
export const ROLE_FALLBACK: Record<ModelRole, Fallback> = {
  PRIMARY_BUILDER: 'NONE', FAST_REPAIR_WORKER: 'BUILDER', DEBUGGER_TEST_SPECIALIST: 'BUILDER', RESEARCH_GENERALIST: 'BUILDER',
  ARCHITECT_REVIEWER: 'NONE', SECURITY_REVIEWER: 'NONE', CODE_RETRIEVAL: 'DETERMINISTIC', RERANKER: 'DETERMINISTIC',
}

export type RouteOutcome = {
  intent: TaskIntent; role: ModelRole
  via: 'SPECIALIST' | 'PRIMARY_BUILDER' | 'FALLBACK_BUILDER' | 'FALLBACK_DETERMINISTIC' | 'UNAVAILABLE'
  modelRef: string | null; nodeId: string | null; placement: Placement; fallbackPlacement?: Placement; reason: string
}

export function routeTask(intent: TaskIntent, world: World, jobId = `route-${intent}`): RouteOutcome {
  const role = INTENT_ROLE[intent]
  const placement = schedule({ jobId, role }, world)
  if (placement.ok) return { intent, role, via: role === 'PRIMARY_BUILDER' ? 'PRIMARY_BUILDER' : 'SPECIALIST', modelRef: placement.modelRef, nodeId: placement.nodeId, placement, reason: `${role === 'PRIMARY_BUILDER' && /designated primary builder/.test(placement.reason) ? role : role + ' qualified'}: ${placement.reason}` }
  const fb = ROLE_FALLBACK[role]
  if (fb === 'BUILDER') {
    const b = schedule({ jobId: `${jobId}-builder`, role: 'PRIMARY_BUILDER' }, world)
    if (b.ok) return { intent, role, via: 'FALLBACK_BUILDER', modelRef: b.modelRef, nodeId: b.nodeId, placement, fallbackPlacement: b, reason: `no model is qualified for ${role} (${placement.reason}); the primary builder does it itself` }
    return { intent, role, via: 'UNAVAILABLE', modelRef: null, nodeId: null, placement, fallbackPlacement: b, reason: `no ${role} and no primary builder can be placed: ${b.reason}` }
  }
  if (fb === 'DETERMINISTIC') return { intent, role, via: 'FALLBACK_DETERMINISTIC', modelRef: null, nodeId: null, placement, reason: `no model is qualified for ${role}; the deterministic method (keyword search / retrieval order) is used` }
  return { intent, role, via: 'UNAVAILABLE', modelRef: null, nodeId: null, placement, reason: `${placement.reason}; no substitute is allowed for ${role}` }
}

export function routingTable(world: World): RouteOutcome[] {
  return (Object.keys(INTENT_ROLE) as TaskIntent[]).map((i) => routeTask(i, world))
}
export type { PlacementOk }
