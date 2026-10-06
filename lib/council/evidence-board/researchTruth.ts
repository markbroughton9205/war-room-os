/**
 * Research-truth helpers for EBC / LUMEN.
 * Usable sources require extracted content + URL. Failed rows never corroborate.
 */
import type { EbcClaim, EbcEvidence, EbcMissionClass, LumenVerification } from './types'
import { canonicalizeSourceKey } from '@/lib/council/gi/lumenQuality'
import { isPrimaryCandidate, paperIdentity } from '@/lib/browser-broker/researchDiscovery'

const FAILED_FETCH = /opened no usable sources|fetch failed|timed out|could not (?:open|retrieve|fetch)|status\s*[45]\d\d/i
const NO_USABLE = "I couldn't verify this from usable live sources. The topic could not be verified."

export function isExternalResearchMission(missionClass: EbcMissionClass): boolean {
  return missionClass === 'DEEP_RESEARCH' || missionClass === 'CURRENT_INTEL'
}

export function isUsableExternalEvidence(row: Pick<EbcEvidence, 'ok' | 'url' | 'final_url' | 'summary' | 'title' | 'observed_at' | 'retrieved_at'>): boolean {
  if (row.ok !== true) return false
  const url = String(row.final_url || row.url || '').trim()
  if (!/^https?:\/\//i.test(url)) return false
  const content = String(row.summary || '').trim()
  if (content.length < 24) return false
  if (FAILED_FETCH.test(content) || FAILED_FETCH.test(row.title || '')) return false
  const observed = String(row.observed_at || row.retrieved_at || '').trim()
  if (!observed) return false
  return true
}

export type ResearchSourceCounts = {
  discovered_source_count: number
  selected_source_count: number
  opened_source_count: number
  usable_source_count: number
  unique_source_count: number
  primary_source_count: number
  failed_source_count: number
}

export function researchSourceCounts(
  evidence: readonly EbcEvidence[],
  extras?: Partial<ResearchSourceCounts>,
): ResearchSourceCounts {
  const usable = evidence.filter(isUsableExternalEvidence)
  const unique = new Set(usable.map(row => paperIdentity(String(row.final_url || row.url || ''))).filter(Boolean))
  const primary = usable.filter(row => isPrimaryCandidate(String(row.final_url || row.url || ''), true)).length
  const failed = evidence.filter(row => row.ok === false || FAILED_FETCH.test(row.summary || '')).length
  return {
    discovered_source_count: extras?.discovered_source_count ?? unique.size,
    selected_source_count: extras?.selected_source_count ?? unique.size,
    opened_source_count: extras?.opened_source_count ?? evidence.filter(row => Boolean(row.url || row.final_url)).length,
    usable_source_count: usable.length,
    unique_source_count: unique.size,
    primary_source_count: primary,
    failed_source_count: Math.max(failed, extras?.failed_source_count ?? 0),
  }
}

export function usableEvidenceForClaim(claim: EbcClaim, evidence: readonly EbcEvidence[]): EbcEvidence[] {
  return evidence.filter(row => claim.evidence_ids.includes(row.evidence_id) && isUsableExternalEvidence(row))
}

export function lumenMaySupportExternalClaim(claim: EbcClaim, evidence: readonly EbcEvidence[]): boolean {
  return usableEvidenceForClaim(claim, evidence).length >= 1
}

export function demoteSourcelessExternalClaims<Claim extends EbcClaim>(
  claims: readonly Claim[],
  evidence: readonly EbcEvidence[],
  lumen: readonly LumenVerification[],
): { claims: Claim[]; lumen: LumenVerification[] } {
  const nextClaims = claims.map((claim): Claim => {
    if (claim.status !== 'SUPPORTED' && claim.status !== 'VERIFIED') return { ...claim }
    if (lumenMaySupportExternalClaim(claim, evidence)) return { ...claim }
    return { ...claim, status: 'UNVERIFIED' as const }
  })
  const nextLumen = lumen.map(row => {
    if (row.verdict !== 'SUPPORTED') return row
    const claim = nextClaims.find(item => item.claim_id === row.claim_id)
    if (!claim) return { ...row, verdict: 'UNKNOWN' as const, reason: 'no_usable_sources', evidence_refs: [], source_count: 0 }
    const refs = usableEvidenceForClaim(claim, evidence)
    if (refs.length) {
      return { ...row, evidence_refs: refs.map(item => item.evidence_id), source_count: new Set(refs.map(item => canonicalizeSourceKey(item.final_url || item.url))).size }
    }
    return { ...row, verdict: 'UNKNOWN' as const, reason: 'no_usable_sources', evidence_refs: [], source_count: 0 }
  })
  return { claims: nextClaims, lumen: nextLumen }
}

export function noUsableSourcesBrief(): string {
  return NO_USABLE
}
