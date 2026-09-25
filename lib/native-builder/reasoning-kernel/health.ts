/**
 * Reasoning-kernel health checks.
 * Derived state may be repaired. Core source is never rewritten.
 */
import { graphInvariant } from './graph'
import { explainSession, nextSessionId } from './session'
import type { FoundryReasoningSession } from './types'

export function diagnoseReasoningHealth(session: FoundryReasoningSession): FoundryReasoningHealthFinding[] {
  const findings: FoundryReasoningHealthFinding[] = []
  const graph = graphInvariant(session.reasoningGraph)
  if (!graph.ok) findings.push(finding(session, 'GRAPH_INCONSISTENCY', graph.violations[0] ?? 'graph invariant failed'))
  if (hasCycle(session)) findings.push(finding(session, 'GRAPH_INCONSISTENCY', 'circular graph dependency'))
  if (session.evidence.some(item => item.statement.includes('STALE_EVIDENCE'))) findings.push(finding(session, 'EVIDENCE_STALE', 'stale evidence is still attached'))
  const provenConflict = session.verificationState.claims.filter(item => item.status === 'PROVEN')
  if (provenConflict.length > 1 && session.contradictions.some(item => item.type === 'VERIFIER_VS_CLAIM' && !item.resolved)) {
    findings.push(finding(session, 'VERIFICATION_CONFLICT', 'verified claims contradict each other'))
  }
  if (session.resourceState.workerCalls < 0 || session.efficiency.workerCalls < 0) findings.push(finding(session, 'RESOURCE_ACCOUNTING_ERROR', 'resource accounting drifted'))
  if (session.stagnation.detected && !session.stagnation.response) findings.push(finding(session, 'STRATEGY_STAGNATION', 'strategy deadlock without a response'))
  if (session.search.branches.length > session.search.budget.maxBranches) findings.push(finding(session, 'BRANCH_EXPLOSION', 'branch count exceeded the budget'))
  if (!session.sessionId || !session.problemModel?.goal) findings.push(finding(session, 'SESSION_CORRUPTION', 'session identity or problem is missing'))
  if (session.strategyLessons.some(item => item.status === 'ACTIVE' && /GRAD_HIDDEN|hidden verifier/i.test(JSON.stringify(item)))) {
    findings.push(finding(session, 'MEMORY_CONTAMINATION', 'active memory contains a hidden answer'))
  }
  if (session.workerStatus === 'REJECTED') findings.push(finding(session, 'WORKER_OUTPUT_INVALID', 'worker output was rejected'))
  session.healthFindings.push(...findings)
  return findings
}

function finding(session: FoundryReasoningSession, category: FoundryReasoningHealthFinding['category'], summary: string): FoundryReasoningHealthFinding {
  return { findingId: nextSessionId(session, 'health'), category, summary, repaired: false }
}

function hasCycle(session: FoundryReasoningSession): boolean {
  const edges = session.reasoningGraph.edges
  const seen = new Set<string>()
  for (const edge of edges) {
    if (edge.from === edge.to) return true
    const key = `${edge.from}->${edge.to}`
    if (seen.has(`${edge.to}->${edge.from}`)) return true
    seen.add(key)
  }
  return false
}

export function repairDerivedState(session: FoundryReasoningSession): { repaired: string[]; sourceRewritten: false } {
  const repaired: string[] = []
  session.reasoningGraph.edges = session.reasoningGraph.edges.filter(edge => edge.from !== edge.to)
  repaired.push('orphan-self-edge')
  explainSession(session)
  repaired.push('brief')
  for (const item of session.healthFindings) {
    if (item.category === 'GRAPH_INCONSISTENCY' || item.category === 'EVIDENCE_STALE') item.repaired = true
  }
  session.derivedCache.entries = session.derivedCache.entries.filter(entry => entry.revision === session.derivedCache.revision)
  repaired.push('stale-cache')
  return { repaired, sourceRewritten: false }
}

export function failClosed(session: FoundryReasoningSession, summary: string): void {
  session.status = 'REASONING_STATE_UNTRUSTED'
  session.verificationState.projectReady = false
  session.verificationState.refusal = summary
  session.healthFindings.push(finding(session, 'SESSION_CORRUPTION', summary))
}

export function requestCoreRepairMission(summary: string): { rewriteSource: false; missionRequested: true; summary: string } {
  return { rewriteSource: false, missionRequested: true, summary }
}
