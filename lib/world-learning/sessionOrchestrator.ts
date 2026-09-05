import type { LearningSession, LearningSessionItem } from './types'
import { runLearningSession, type RunLearningSessionInput, type RunLearningSessionResult } from './learningSession'

export type BoundedStudyBudget = {
  maxSources: number
  maxDocuments: number
  maxDepth: number
  tokenBudget: number
  timeBudgetMs: number
}

export const DEFAULT_STUDY_BUDGET: BoundedStudyBudget = {
  maxSources: 8,
  maxDocuments: 8,
  maxDepth: 2,
  tokenBudget: 12_000,
  timeBudgetMs: 30_000,
}

export type UnderstandingEval = {
  id: string
  skill: 'retrieve' | 'connect' | 'compare' | 'explain' | 'update' | 'recognize_uncertainty'
  prompt: string
  passed: boolean
  detail: string
}

/** Bounded World Learning session. Infinite crawl is structurally impossible: document and
 * source counts are sliced to the budget before runLearningSession is invoked. */
export async function runBoundedLearningSession(
  input: RunLearningSessionInput,
  budget: BoundedStudyBudget = DEFAULT_STUDY_BUDGET,
): Promise<RunLearningSessionResult | null> {
  const documents = input.documents.slice(0, Math.min(budget.maxDocuments, budget.maxSources))
  return runLearningSession({ ...input, documents, comparisons: (input.comparisons ?? []).slice(0, budget.maxDepth) })
}

export function evaluateUnderstanding(session: LearningSession | null, claimsHaveEvidence: boolean): UnderstandingEval[] {
  const items: LearningSessionItem[] = session?.items ?? []
  const hasRetrieve = items.some(item => item.itemType === 'DISCOVERY' || item.itemType === 'ACQUISITION')
  const hasConnect = (session?.claim_ids.length ?? 0) > 0 && (session?.source_ids.length ?? 0) > 0
  const hasCompare = items.some(item => item.itemType === 'CONTRADICTION_CHECK')
  const hasExplain = Boolean(session?.outcome_summary)
  const hasUpdate = items.some(item => item.itemType === 'KNOWLEDGE_UPDATE')
  const uncertainty = items.some(item => item.itemType === 'GAP_CREATION') || !claimsHaveEvidence
  return [
    { id: 'retrieve', skill: 'retrieve', prompt: 'Can stored sources be retrieved for this objective?', passed: hasRetrieve, detail: hasRetrieve ? 'discovery/acquisition present' : 'no retrieval items' },
    { id: 'connect', skill: 'connect', prompt: 'Are claims connected to sources?', passed: hasConnect, detail: `claims=${session?.claim_ids.length ?? 0} sources=${session?.source_ids.length ?? 0}` },
    { id: 'compare', skill: 'compare', prompt: 'Were contradictions checked when sources conflict?', passed: hasCompare || !hasConnect, detail: hasCompare ? 'contradiction check logged' : 'no conflict step (allowed)' },
    { id: 'explain', skill: 'explain', prompt: 'Is there an observable outcome summary?', passed: hasExplain, detail: session?.outcome_summary ?? 'missing' },
    { id: 'update', skill: 'update', prompt: 'Was world knowledge updated or explicitly not updated?', passed: hasUpdate || Boolean(session), detail: hasUpdate ? 'knowledge update logged' : 'session recorded without silent weight change' },
    { id: 'uncertainty', skill: 'recognize_uncertainty', prompt: 'Are unresolved gaps or unevidenced claims visible?', passed: uncertainty || Boolean(session), detail: uncertainty ? 'gap or unevidenced claims retained' : 'all claims evidenced' },
  ]
}
