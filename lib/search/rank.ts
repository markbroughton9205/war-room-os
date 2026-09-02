import type { ScorableCandidate } from './types'

const INACTIVE_STATUSES = new Set(['superseded', 'retracted', 'dropped', 'done'])

/**
 * Deterministic, structured-only scoring (Phase 7/44) — text-match strength + importance +
 * recency + project-match, no semantic/vector component (none exists in this repo). Callers
 * should already have excluded inactive rows from the candidate query by default (Phase 43); this
 * function still applies a heavy penalty defensively so an accidentally-included inactive row
 * never outranks an active one.
 */
export function scoreSearchResult(
  candidate: ScorableCandidate,
  context: { queryProjectId: string | null; now?: number },
): number {
  const now = context.now ?? Date.now()
  const ageMs = Math.max(0, now - new Date(candidate.createdAt).getTime())
  const ageDays = ageMs / (1000 * 60 * 60 * 24)
  const recencyScore = 3 * Math.exp(-ageDays / 14) // half-life-ish decay over ~2 weeks

  const textScore = 10 * Math.max(0, Math.min(1, candidate.textMatchStrength))
  const importanceScore = 3 * Math.max(0, Math.min(1, candidate.importanceWeight))
  const projectMatchScore =
    context.queryProjectId && candidate.projectId && candidate.projectId === context.queryProjectId ? 2 : 0

  const inactivePenalty = INACTIVE_STATUSES.has(candidate.status) ? -100 : 0

  return textScore + importanceScore + recencyScore + projectMatchScore + inactivePenalty
}

export function rankSearchCandidates<T extends ScorableCandidate>(
  candidates: T[],
  context: { queryProjectId: string | null; now?: number },
): Array<T & { score: number }> {
  return candidates
    .map(c => ({ ...c, score: scoreSearchResult(c, context) }))
    .sort((a, b) => b.score - a.score)
}

export function isActiveStatus(status: string): boolean {
  return !INACTIVE_STATUSES.has(status)
}
