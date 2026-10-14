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

/**
 * Mission phase plan for a one-GPU node. Helper work that must happen BEFORE the builder (retrieval, then research) is grouped so each helper model loads once and
 * unloads before the builder loads; the builder phase runs without helper churn; work that needs a helper AFTER the build is listed last. The estimate counts every
 * model switch (a helper loading, the builder loading) with the measured load time, so a specialist whose switch cost exceeds its saving can be rejected.
 */
export type MissionPhase = { name: 'RETRIEVAL' | 'RESEARCH' | 'BUILD' | 'POST'; role: ModelRole; modelRef: string | null; intents: TaskIntent[]; loadMs: number | 'UNKNOWN' }
const PRE_ORDER: ModelRole[] = ['CODE_RETRIEVAL', 'RESEARCH_GENERALIST']
export function planPhases(intents: TaskIntent[], world: World): { phases: MissionPhase[]; switches: number; estimatedSwitchMs: number | 'UNKNOWN'; notes: string[] } {
  const routes = [...new Set(intents)].map((i) => routeTask(i, world))
  const notes: string[] = []
  const phases: MissionPhase[] = []
  const loadOf = (ref: string | null, nodeId: string | null) => { const p = world.profiles.find((x) => x.modelRef === ref && x.nodeId === nodeId && typeof x.loadMs === 'number'); return (p ? p.loadMs : 'UNKNOWN') as number | 'UNKNOWN' }
  for (const role of PRE_ORDER) {
    const rs = routes.filter((r) => r.role === role && r.via === 'SPECIALIST')
    if (rs.length) phases.push({ name: role === 'CODE_RETRIEVAL' ? 'RETRIEVAL' : 'RESEARCH', role, modelRef: rs[0].modelRef, intents: rs.map((r) => r.intent), loadMs: loadOf(rs[0].modelRef, rs[0].nodeId) })
    for (const r of routes.filter((x) => x.role === role && x.via !== 'SPECIALIST')) notes.push(`${r.intent}: ${r.via.toLowerCase().replace(/_/g, ' ')} (${r.reason.slice(0, 90)})`)
  }
  const builder = routeTask('feature_build', world)
  const buildRoutes = routes.filter((r) => r.role === 'PRIMARY_BUILDER' || r.via === 'FALLBACK_BUILDER')
  phases.push({ name: 'BUILD', role: 'PRIMARY_BUILDER', modelRef: builder.modelRef, intents: buildRoutes.map((r) => r.intent), loadMs: loadOf(builder.modelRef, builder.nodeId) })
  for (const r of routes.filter((x) => !PRE_ORDER.includes(x.role) && x.role !== 'PRIMARY_BUILDER' && x.via === 'SPECIALIST')) phases.push({ name: 'POST', role: r.role, modelRef: r.modelRef, intents: [r.intent], loadMs: loadOf(r.modelRef, r.nodeId) })
  for (const r of routes.filter((x) => x.via === 'UNAVAILABLE')) notes.push(`${r.intent}: UNAVAILABLE (${r.role})`)
  // each phase whose model differs from the previous one is a switch; a model that appears in two phases is loaded twice
  let switches = 0, total: number | 'UNKNOWN' = 0, prev: string | null = null
  for (const ph of phases) { if (ph.modelRef !== prev) { switches += 1; total = total === 'UNKNOWN' || ph.loadMs === 'UNKNOWN' ? 'UNKNOWN' : total + ph.loadMs } prev = ph.modelRef }
  return { phases, switches, estimatedSwitchMs: total, notes }
}
