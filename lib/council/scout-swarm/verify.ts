import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'
import type { NebulaAgentId } from '@/lib/council/nebula/identity'
import {
  annotateEvidenceIndependence,
  clusterIndependentEvidence,
  independentSupportCount,
  type EvidenceCluster,
  type IndependentEvidenceItem,
} from '@/lib/intelligence/sourceIndependence'
import type {
  AtomicClaim,
  AuthorityMatch,
  ClaimVerificationStatus,
  ConvergenceClaim,
  ConvergenceMap,
  FrozenSeatReport,
  PhoenixChallengeResult,
} from './types'

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map(item => item.trim())
    .filter(item => item.length > 18)
}

function atomicize(text: string): string[] {
  const out: string[] = []
  for (const sentence of sentences(text)) {
    const parts = sentence.split(/\s+(?:which proves that|that proves that|which proves|that proves|therefore|which means that|that means that)\s+/i)
    if (parts.length > 1) {
      out.push(...parts.map(part => part.trim()).filter(part => part.length > 18))
    } else {
      out.push(sentence)
    }
  }
  return out.slice(0, 8)
}

export function extractAtomicClaims(report: FrozenSeatReport): AtomicClaim[] {
  return atomicize(report.conclusion).map((claim_text, index) => ({
    claim_id: `${report.agentId}-claim-${index + 1}`,
    claim_text,
    seat: report.agentId,
    report_id: report.report_id,
    supporting_evidence_ids: report.evidence_ids.slice(0, 6),
    supporting_independence_keys: [],
    contradicting_evidence_ids: [],
    contradicting_independence_keys: [],
    verification_status: 'UNSUPPORTED',
    authority_match: 'UNKNOWN',
    freshness_status: 'unknown',
    notes: '',
  }))
}

function looksRegulatoryClaim(text: string): boolean {
  return /\b(regulat(?:ion|ory)|federal register|fmcsa|rule(?:making)?|statute|law changed|federal (?:rule|law))\b/i.test(text)
}

function looksCorporateFilingClaim(text: string): boolean {
  return /\b(8-k|10-[kq]|s-1|sec filing|filed an? 8-k|corporate (?:filing|disclosure))\b/i.test(text) && !looksRegulatoryClaim(text)
}

function looksCorporateFiling(item: IntelligenceEvidenceItem): boolean {
  const blob = `${item.source_label} ${item.title} ${item.url ?? ''} ${item.claim} ${item.source_authority_class ?? ''}`
  return item.source_authority_class === 'PRIMARY_CORPORATE' || /\b(sec|edgar|10-[kq]|8-k|s-1|corporate filing)\b/i.test(blob)
}

function authoritySupportsRegulatoryClaim(item: IntelligenceEvidenceItem): boolean {
  if (item.source_authority_class === 'PRIMARY_REGULATOR' || item.source_authority_class === 'PRIMARY_GOVERNMENT') {
    const blob = `${item.source_label} ${item.title} ${item.url ?? ''} ${item.claim}`
    return /\b(federal register|fmcsa|usdot|ecfr|congress\.gov|govinfo|eur-lex|legislation\.gov)\b/i.test(blob)
      || item.source_id === 'federal_register'
      || item.source_family === 'federal_register'
      || item.source_family === 'fmcsa'
  }
  const blob = `${item.source_label} ${item.title} ${item.url ?? ''} ${item.claim}`
  return /\b(federal register|fmcsa|usdot|ecfr|congress\.gov|govinfo)\b/i.test(blob)
}

function tokensOf(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter(word => word.length > 4).slice(0, 8)
}

function relevantToClaim(item: IntelligenceEvidenceItem, claimText: string): boolean {
  const hay = `${item.title} ${item.claim} ${item.content}`.toLowerCase()
  return tokensOf(claimText).some(token => hay.includes(token))
}

function prepareEvidence(evidence: IntelligenceEvidenceItem[]): {
  items: IndependentEvidenceItem[]
  clusters: EvidenceCluster[]
} {
  const already = evidence.some(item => item.independence_key)
  const annotated = already
    ? evidence as IndependentEvidenceItem[]
    : annotateEvidenceIndependence(evidence)
  return clusterIndependentEvidence(annotated)
}

export function verifyClaimAgainstEvidence(
  claim: AtomicClaim,
  evidence: IntelligenceEvidenceItem[],
): AtomicClaim {
  const { items, clusters } = prepareEvidence(evidence)
  const text = claim.claim_text
  const relevant = items.filter(item => relevantToClaim(item, text))
  const contradicting = relevant.filter(item => item.contradiction_flags.length > 0)
  const stale = relevant.filter(item => item.freshness === 'stale')
  const supportingKeys = [...new Set(relevant.map(item => item.independence_key).filter((key): key is string => Boolean(key)))]
  const contradictingKeys = [...new Set(contradicting.map(item => item.independence_key).filter((key): key is string => Boolean(key)))]
  const independentCount = supportingKeys.length
  const freshness_status = relevant.some(item => item.freshness === 'live' || item.freshness === 'recent')
    ? (relevant.find(item => item.freshness === 'live' || item.freshness === 'recent')?.freshness ?? 'unknown')
    : stale.length
      ? 'stale'
      : 'unknown'

  let verification_status: ClaimVerificationStatus = 'UNSUPPORTED'
  let notes = 'No independent evidence currently supports this claim.'
  let authority_match: AuthorityMatch = 'UNKNOWN'

  if (looksRegulatoryClaim(text)) {
    const filings = items.filter(looksCorporateFiling)
    const authority = items.filter(authoritySupportsRegulatoryClaim)
    if (filings.length && !authority.length) {
      return {
        ...claim,
        supporting_evidence_ids: [],
        supporting_independence_keys: [],
        contradicting_evidence_ids: filings.map(item => item.id),
        contradicting_independence_keys: [...new Set(filings.map(item => item.independence_key).filter((key): key is string => Boolean(key)))],
        verification_status: 'SOURCE_MISMATCH',
        authority_match: 'MISMATCH',
        freshness_status,
        notes: 'Corporate SEC filings do not establish a federal regulation change. Authority is claim-relative: PRIMARY_CORPORATE confirms what a company filed, not what federal freight law changed.',
      }
    }
    if (!authority.length) {
      return {
        ...claim,
        supporting_evidence_ids: relevant.map(item => item.id).slice(0, 8),
        supporting_independence_keys: supportingKeys,
        verification_status: 'UNSUPPORTED',
        authority_match: 'MISMATCH',
        freshness_status,
        notes: 'No authoritative regulator source proves a regulation change.',
      }
    }
    authority_match = 'MATCH'
  } else if (looksCorporateFilingClaim(text)) {
    const filings = relevant.filter(looksCorporateFiling)
    authority_match = filings.length ? 'MATCH' : relevant.length ? 'PARTIAL' : 'UNKNOWN'
  } else if (relevant.some(item => item.primary_source)) {
    authority_match = 'MATCH'
  } else if (relevant.length) {
    authority_match = 'PARTIAL'
  }

  if (contradicting.length) {
    verification_status = 'CONTRADICTED'
    notes = 'Contradicting evidence is present.'
  } else if (stale.length && !relevant.some(item => item.freshness === 'live' || item.freshness === 'recent')) {
    verification_status = 'STALE'
    notes = 'Matching evidence is stale.'
  } else if (independentCount >= 2) {
    verification_status = 'SUPPORTED'
    notes = `Supported by ${independentCount} independent evidence clusters (not raw URL count).`
  } else if (independentCount === 1 && authority_match === 'MATCH' && relevant.some(item => item.primary_source)) {
    verification_status = 'SUPPORTED'
    notes = 'Supported by one independent primary source. Syndicated copies of the same origin were not counted separately.'
  } else if (independentCount === 1 || relevant.length === 1) {
    verification_status = 'PARTIALLY_SUPPORTED'
    notes = clusters.length && independentCount <= 1
      ? 'Only a single independent evidence cluster overlaps the claim. Duplicate/syndicated copies do not add support.'
      : 'Only a single evidence item overlaps the claim.'
  }

  return {
    ...claim,
    supporting_evidence_ids: relevant.map(item => item.id).slice(0, 8),
    supporting_independence_keys: supportingKeys,
    contradicting_evidence_ids: contradicting.map(item => item.id),
    contradicting_independence_keys: contradictingKeys,
    verification_status,
    authority_match,
    freshness_status,
    notes,
  }
}

export function verifyReports(reports: FrozenSeatReport[], evidence: IntelligenceEvidenceItem[]): AtomicClaim[] {
  return reports.flatMap(report => extractAtomicClaims(report).map(claim => verifyClaimAgainstEvidence(claim, evidence)))
}

export function challengeClaim(claim: AtomicClaim, evidence: IntelligenceEvidenceItem[]): PhoenixChallengeResult {
  const { items, clusters } = prepareEvidence(evidence)
  const relevant = items.filter(item => claim.supporting_evidence_ids.includes(item.id) || relevantToClaim(item, claim.claim_text))
  const filingMismatch = claim.verification_status === 'SOURCE_MISMATCH' || claim.authority_match === 'MISMATCH'
  const weak = claim.verification_status === 'UNSUPPORTED' || claim.verification_status === 'STALE' || claim.verification_status === 'PARTIALLY_SUPPORTED'
  const duplicateSourceFamilies = clusters.some(cluster => cluster.member_ids.length > 1)
    || (claim.supporting_evidence_ids.length > 1 && independentSupportCount(claim.supporting_evidence_ids, items) < claim.supporting_evidence_ids.length)
  const circularReporting = duplicateSourceFamilies && relevant.filter(item => item.derivative_of).length > 0
  const missingPrimaryAuthority = !relevant.some(item => item.primary_source) && looksRegulatoryClaim(claim.claim_text)
  const wrongJurisdiction = looksRegulatoryClaim(claim.claim_text) && relevant.some(item => item.jurisdiction && item.jurisdiction !== 'US' && /\b(u\.s\.|united states|federal)\b/i.test(claim.claim_text))
  const staleEvidence = claim.verification_status === 'STALE' || relevant.every(item => item.freshness === 'stale' || item.freshness === 'aging')
  const derivativeEvidence = relevant.length > 0 && relevant.every(item => Boolean(item.derivative_of) || item.source_authority_class === 'SECONDARY_MAJOR_MEDIA' || item.source_authority_class === 'SECONDARY_LOCAL_MEDIA')
  const published = relevant
    .map(item => item.published_at)
    .filter((value): value is string => Boolean(value))
    .sort()
  const survived = !filingMismatch && !weak && claim.verification_status === 'SUPPORTED' && !wrongJurisdiction
  return {
    claim_id: claim.claim_id,
    alternateExplanation: filingMismatch
      ? 'The same facts may be a corporate disclosure or industry rumor rather than a binding federal rule change.'
      : duplicateSourceFamilies
        ? 'Apparent consensus may be one syndicated wire story copied across outlets rather than independent confirmation.'
        : 'The same facts may support a narrower operational or reporting change rather than the claimed conclusion.',
    missingSourceSearch: looksRegulatoryClaim(claim.claim_text)
      ? 'Search Federal Register / FMCSA / eCFR for an actual rule, not SEC EDGAR.'
      : 'Search for a primary source that would have to exist if the claim were true.',
    timelineCheck: published.length
      ? `Publication chronology: ${published.join(' → ')}. Confirm the claimed window matches published_at, not observed_at.`
      : 'Confirm published_at / effective date is inside the claimed window; otherwise treat as historical.',
    sourceAuthorityCheck: filingMismatch
      ? 'SEC EDGAR is not a federal transportation regulator. PRIMARY_CORPORATE ≠ PRIMARY_REGULATOR for this claim.'
      : relevant.some(item => authoritySupportsRegulatoryClaim(item))
        ? 'At least one government/public-authority source is present.'
        : 'No high-authority source currently backs the claim.',
    causalLeap: /\b(because|therefore|will cause|means that|proves)\b/i.test(claim.claim_text),
    injectionRisk: /ignore previous|system prompt|jailbreak/i.test(claim.claim_text),
    survived,
    notes: [
      claim.notes,
      duplicateSourceFamilies ? 'PHOENIX: duplicate source families / syndication detected.' : '',
      missingPrimaryAuthority ? 'PHOENIX: missing primary authority.' : '',
      wrongJurisdiction ? 'PHOENIX: jurisdiction mismatch.' : '',
    ].filter(Boolean).join(' '),
    duplicateSourceFamilies,
    circularReporting,
    missingPrimaryAuthority,
    wrongJurisdiction,
    staleEvidence,
    derivativeEvidence,
    sourceMismatch: filingMismatch,
    publicationChronology: published.length ? published.join(' → ') : 'unknown',
  }
}

function similar(a: string, b: string): boolean {
  const left = new Set(a.toLowerCase().split(/\s+/).filter(word => word.length > 4))
  const right = new Set(b.toLowerCase().split(/\s+/).filter(word => word.length > 4))
  if (!left.size || !right.size) return false
  let inter = 0
  for (const token of left) if (right.has(token)) inter += 1
  return inter / new Set([...left, ...right]).size >= 0.34
}

function authorityQuality(claim: AtomicClaim, items: IndependentEvidenceItem[]): ConvergenceClaim['authority_quality'] {
  if (claim.authority_match === 'MISMATCH' || claim.verification_status === 'SOURCE_MISMATCH') return 'MISMATCH'
  const relevant = items.filter(item => claim.supporting_evidence_ids.includes(item.id))
  if (relevant.some(item => item.source_authority_class?.startsWith('PRIMARY_'))) return 'PRIMARY'
  if (relevant.some(item => item.source_authority_class?.startsWith('SECONDARY_'))) return 'SECONDARY'
  if (relevant.some(item => item.source_authority_class === 'TERTIARY_SOCIAL' || item.source_authority_class === 'MODEL_INFERENCE')) return 'TERTIARY'
  return 'UNKNOWN'
}

export function buildConvergenceMap(input: {
  missionId: string
  roundRequestId: string
  logicalRequestId: string
  reports: FrozenSeatReport[]
  claims: AtomicClaim[]
  challenges: PhoenixChallengeResult[]
  evidence: IntelligenceEvidenceItem[]
}): ConvergenceMap {
  const { items, clusters } = prepareEvidence(input.evidence)
  const discoveryReports = input.reports.filter(report => report.agentId !== 'aurora' && report.agentId !== 'astra')
  const mapped: ConvergenceClaim[] = []

  for (const claim of input.claims) {
    const supporters = discoveryReports.filter(report =>
      report.agentId !== claim.seat && similar(report.conclusion, claim.claim_text),
    )
    const independentSeats: NebulaAgentId[] = [claim.seat, ...supporters.map(item => item.agentId)]
    const uniqueSeats = [...new Set(independentSeats)]
    const contradictedBy = input.claims
      .filter(other => other.claim_id !== claim.claim_id && other.verification_status === 'CONTRADICTED' && similar(other.claim_text, claim.claim_text))
      .map(other => other.seat)
    const challenge = input.challenges.find(item => item.claim_id === claim.claim_id)
    const origin_distribution: Record<string, number> = {}
    for (const item of items.filter(entry => claim.supporting_evidence_ids.includes(entry.id))) {
      const origin = item.origin_type ?? 'unknown'
      origin_distribution[origin] = (origin_distribution[origin] ?? 0) + 1
    }
    const independent_support_count = claim.supporting_independence_keys.length || independentSupportCount(claim.supporting_evidence_ids, items)
    const independent_contradiction_count = claim.contradicting_independence_keys.length
    const supportingItems = items.filter(item => claim.supporting_evidence_ids.includes(item.id))
    const source_family_diversity = new Set(supportingItems.map(item => item.source_family).filter(Boolean)).size
    const regional_diversity = new Set(supportingItems.map(item => item.region).filter(Boolean)).size
    const quality = authorityQuality(claim, items)
    const primary_source_presence = supportingItems.some(item => item.primary_source)
    const phoenix_status: ConvergenceClaim['phoenix_status'] = challenge ? (challenge.survived ? 'SURVIVED' : 'FAILED') : 'NOT_RUN'

    let state: ConvergenceClaim['state'] = 'UNRESOLVED'
    if (claim.verification_status === 'SOURCE_MISMATCH' || claim.verification_status === 'CONTRADICTED') state = 'REJECTED'
    else if (claim.verification_status === 'UNSUPPORTED' || claim.verification_status === 'STALE') state = 'UNRESOLVED'
    else if (independent_support_count >= 2 && claim.verification_status === 'SUPPORTED' && challenge?.survived !== false) {
      state = 'INDEPENDENT_CONVERGENCE'
    } else if (contradictedBy.length) state = 'CONTESTED'
    else if (claim.verification_status === 'PARTIALLY_SUPPORTED') state = 'WEAKLY_SUPPORTED'
    else if (claim.verification_status === 'SUPPORTED' && independent_support_count === 1 && primary_source_presence && quality === 'PRIMARY') {
      state = 'WEAKLY_SUPPORTED'
    } else if (claim.verification_status === 'SUPPORTED') state = 'WEAKLY_SUPPORTED'

    mapped.push({
      claim_id: claim.claim_id,
      claim_text: claim.claim_text,
      state,
      independently_supported_by: uniqueSeats,
      independently_contradicted_by: [...new Set(contradictedBy)],
      independent_support_count,
      independent_contradiction_count,
      independent_report_ids: [claim.report_id, ...supporters.map(item => item.report_id)],
      lumen_status: claim.verification_status,
      phoenix_survived: challenge ? challenge.survived : null,
      phoenix_status,
      freshness: supportingItems[0]?.freshness ?? items[0]?.freshness ?? 'unknown',
      freshness_quality: claim.freshness_status,
      origin_distribution,
      source_family_diversity,
      regional_diversity,
      authority_quality: quality,
      primary_source_presence,
      confidence: claim.verification_status === 'SUPPORTED' ? 0.72 : claim.verification_status === 'PARTIALLY_SUPPORTED' ? 0.4 : 0.15,
      unresolved_gaps: claim.verification_status === 'UNSUPPORTED' || claim.verification_status === 'SOURCE_MISMATCH' ? [claim.notes] : [],
    })
  }

  return {
    missionId: input.missionId,
    roundRequestId: input.roundRequestId,
    logicalRequestId: input.logicalRequestId,
    claims: mapped,
    notes: [
      'independent_support_count counts distinct independence keys / evidence clusters, not raw URLs, seats, or syndicated copies.',
      'A strong primary/regulatory source can outweigh many derivative news copies when it matches the claim. It does not invent extra independent confirmations.',
      `Round clusters: ${clusters.length}.`,
    ],
  }
}

export function auroraMustNotAddEvidence(synthesis: string, knownEvidenceIds: string[]): boolean {
  const invented = synthesis.match(/\bevidence-[a-z0-9-]+/gi) ?? []
  return invented.every(id => knownEvidenceIds.includes(id.replace(/^evidence-/i, '') ) || knownEvidenceIds.includes(id))
}

export function formatAuroraSynthesisInput(input: {
  astra: FrozenSeatReport | null
  reports: FrozenSeatReport[]
  revisions: string[]
  claims: AtomicClaim[]
  challenges: PhoenixChallengeResult[]
  convergence: ConvergenceMap
  evidence?: IntelligenceEvidenceItem[]
}): string {
  const independent = input.reports.filter(item => item.agentId !== 'aurora' && item.agentId !== 'astra')
  const { items, clusters } = prepareEvidence(input.evidence ?? [])
  const clusterLines = clusters.slice(0, 12).map(cluster => {
    const head = items.find(item => item.id === cluster.cluster_head_id)
    return `- ${cluster.cluster_id}: family=${cluster.source_family} key=${cluster.independence_key} members=${cluster.member_ids.length} region=${cluster.region ?? 'UNKNOWN'} head=${head?.title ?? cluster.cluster_head_id}`
  })
  return [
    'You are AURORA. Synthesize frozen independent reports only. Do not introduce new evidence.',
    'Do not say "multiple independent sources confirm" unless independence keys/clusters actually prove distinct origins.',
    'If several URLs belong to one cluster, treat them as one underlying evidence origin.',
    'Preserve real regional disagreement. Do not flatten regional scouts into a single global consensus.',
    '',
    input.astra ? `ASTRA mission report:\n${input.astra.conclusion}` : '',
    '',
    'FROZEN INDEPENDENT REPORTS:',
    ...independent.map(report => `- ${report.report_kind} (${report.agentId}): ${report.conclusion}`),
    '',
    input.revisions.length ? `CROSS-REVIEW:\n${input.revisions.join('\n')}` : 'CROSS-REVIEW: none recorded',
    '',
    'INDEPENDENT EVIDENCE CLUSTERS:',
    ...(clusterLines.length ? clusterLines : ['- none clustered this round']),
    '',
    'LUMEN VERIFICATION:',
    ...input.claims.slice(0, 10).map(claim => `- ${claim.claim_id}: ${claim.verification_status} authority=${claim.authority_match} keys=${claim.supporting_independence_keys.length} — ${claim.claim_text}`),
    '',
    'PHOENIX CHALLENGE:',
    ...input.challenges.slice(0, 8).map(item => `- ${item.claim_id}: survived=${item.survived} dupFamily=${item.duplicateSourceFamilies} mismatch=${item.sourceMismatch} alt=${item.alternateExplanation}`),
    '',
    'CONVERGENCE (independent clusters, not raw hits):',
    ...input.convergence.claims.slice(0, 10).map(item => `- ${item.state} independent_support=${item.independent_support_count} families=${item.source_family_diversity} regions=${item.regional_diversity} authority=${item.authority_quality} ${item.claim_text}`),
    '',
    'Cover in natural prose, not necessarily as headings: current answer; what independent seats found; where they converged; where they disagreed; what evidence won; what changed from prior research; what remains unknown; practical implications.',
  ].filter(Boolean).join('\n')
}
