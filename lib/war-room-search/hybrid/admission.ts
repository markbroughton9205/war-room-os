import type { RetrievalProfile } from './retrievalProfile'

export type SemanticCandidate = {
  documentId: number
  score: number
}

export type SemanticAdmissionDecision<T extends SemanticCandidate> = {
  admitted: T[]
  abstained: boolean
  candidateScore: number | null
  secondScore: number | null
  margin: number | null
  threshold: number
  marginThreshold: number | null
  strategy: RetrievalProfile['semanticAdmissionStrategy']
  profileVersion: string
}

export function semanticMargin(top1: number | null, top2: number | null): number | null {
  if (top1 == null) return null
  if (top2 == null) return top1
  return top1 - top2
}

export function admitSemanticCandidates<T extends SemanticCandidate>(
  ranked: T[],
  profile: RetrievalProfile,
): SemanticAdmissionDecision<T> {
  const candidateScore = ranked[0]?.score ?? null
  const secondScore = ranked[1]?.score ?? null
  const margin = semanticMargin(candidateScore, secondScore)
  const threshold = profile.semanticThreshold
  const marginThreshold = profile.semanticMarginThreshold
  const passesMargin = marginThreshold == null || (margin != null && margin >= marginThreshold)
  const queryGateOk = profile.semanticAdmissionStrategy === 'none'
    || profile.semanticAdmissionStrategy === 'min_cosine'
    || profile.semanticAdmissionStrategy === 'min_cosine_or_lexical'
    || passesMargin

  const admitted = queryGateOk
    ? ranked.filter(item => profile.semanticAdmissionStrategy === 'none' || item.score >= threshold)
    : []

  return {
    admitted,
    abstained: ranked.length > 0 && admitted.length === 0,
    candidateScore,
    secondScore,
    margin,
    threshold,
    marginThreshold,
    strategy: profile.semanticAdmissionStrategy,
    profileVersion: profile.profileVersion,
  }
}
