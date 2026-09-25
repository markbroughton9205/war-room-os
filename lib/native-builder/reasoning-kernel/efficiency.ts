/**
 * Reasoning efficiency. Cheap tasks stay on the fast path.
 * Fresh evidence is reused. Stale cache entries drop when the revision changes.
 */
import type { FoundryReasoningSession } from './types'

export function noteEfficiency(session: FoundryReasoningSession, patch: Partial<FoundryReasoningSession['efficiency']>): void {
  session.efficiency = { ...session.efficiency, ...patch, branches: session.search.branches.length, contradictions: session.contradictions.length }
}

export function fastPathAllowed(session: FoundryReasoningSession): { depthOk: boolean; specialists: number; counterexamples: number } {
  const trivial = session.signals.ambiguity === 'low' && session.signals.componentCount <= 1 && session.signals.previousFailures === 0 && !session.signals.securitySensitive
  if (!trivial) return { depthOk: true, specialists: session.selectedDepth === 'R4' ? 4 : 1, counterexamples: session.search.branches.filter(item => item.kind === 'counterexample').length }
  return {
    depthOk: session.selectedDepth === 'R0' || session.selectedDepth === 'R1',
    specialists: 1,
    counterexamples: 0,
  }
}

export function cacheFact(session: FoundryReasoningSession, key: string, value: string): void {
  session.derivedCache.entries = session.derivedCache.entries.filter(entry => entry.key !== key)
  session.derivedCache.entries.push({ key, value, revision: session.derivedCache.revision })
}

export function readCache(session: FoundryReasoningSession, key: string): string | null {
  const hit = session.derivedCache.entries.find(entry => entry.key === key && entry.revision === session.derivedCache.revision)
  return hit?.value ?? null
}

export function invalidateCache(session: FoundryReasoningSession, revision: string): void {
  session.derivedCache.revision = revision
  session.derivedCache.entries = session.derivedCache.entries.filter(entry => entry.revision === revision)
}

export function reuseEvidence(session: FoundryReasoningSession, evidenceId: string): { reused: boolean; tests: number } {
  const known = session.evidence.some(item => item.evidenceId === evidenceId)
  if (!known) return { reused: false, tests: session.efficiency.tests }
  session.efficiency.evidenceReuses += 1
  return { reused: true, tests: session.efficiency.tests }
}

export function compressWorkerContext(session: FoundryReasoningSession): { goal: string; constraints: string[]; strategy: string | null; evidence: string[]; openQuestions: string[]; historyIncluded: false } {
  return {
    goal: session.problemModel.goal,
    constraints: session.constraints.slice(0, 8),
    strategy: session.selectedStrategy,
    evidence: session.evidence.slice(-4).map(item => item.statement),
    openQuestions: session.problemModel.unknowns.map(item => item.statement).slice(0, 8),
    historyIncluded: false,
  }
}

export function comparePaths(baseline: { calls: number; wallTimeMs: number; branches: number; tests: number; ready: boolean }, optimized: { calls: number; wallTimeMs: number; branches: number; tests: number; ready: boolean }): { cheaper: boolean; sameAcceptance: boolean } {
  const cheaper = optimized.calls <= baseline.calls && optimized.tests <= baseline.tests
  return { cheaper, sameAcceptance: baseline.ready === optimized.ready }
}
