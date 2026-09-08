import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'
import type { NebulaAgentId } from '@/lib/council/nebula/identity'
import type {
  AtomicClaim,
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
    .filter(item => item.length > 24)
    .slice(0, 6)
}

export function extractAtomicClaims(report: FrozenSeatReport): AtomicClaim[] {
  return sentences(report.conclusion).map((claim_text, index) => ({
    claim_id: `${report.agentId}-claim-${index + 1}`,
    claim_text,
    seat: report.agentId,
    report_id: report.report_id,
    supporting_evidence_ids: report.evidence_ids.slice(0, 6),
    contradicting_evidence_ids: [],
    verification_status: 'UNSUPPORTED',
    notes: '',
  }))
}

function looksRegulatoryClaim(text: string): boolean {
  return /\b(regulat(?:ion|ory)|federal register|fmcsa|rule(?:making)?|statute|law changed)\b/i.test(text)
}

function looksCorporateFiling(item: IntelligenceEvidenceItem): boolean {
  const blob = `${item.source_label} ${item.title} ${item.url ?? ''} ${item.claim}`
  return /\b(sec|edgar|10-[kq]|8-k|s-1|corporate filing)\b/i.test(blob)
}

function authoritySupportsRegulatoryClaim(item: IntelligenceEvidenceItem): boolean {
  const blob = `${item.source_label} ${item.title} ${item.url ?? ''} ${item.claim}`
  return /\b(federal register|fmcsa|usdot|ecfr|congress\.gov|govinfo)\b/i.test(blob)
}

export function verifyClaimAgainstEvidence(
  claim: AtomicClaim,
  evidence: IntelligenceEvidenceItem[],
): AtomicClaim {
  const text = claim.claim_text
  const relevant = evidence.filter(item => {
    const hay = `${item.title} ${item.claim} ${item.content}`.toLowerCase()
    const tokens = text.toLowerCase().split(/\s+/).filter(word => word.length > 4).slice(0, 6)
    return tokens.some(token => hay.includes(token))
  })
  const contradicting = relevant.filter(item => item.contradiction_flags.length > 0)
  const stale = relevant.filter(item => item.freshness === 'stale')

  let verification_status: ClaimVerificationStatus = 'UNSUPPORTED'
  let notes = 'No independent evidence currently supports this claim.'

  if (looksRegulatoryClaim(text)) {
    const filings = evidence.filter(looksCorporateFiling)
    const authority = evidence.filter(authoritySupportsRegulatoryClaim)
    if (filings.length && !authority.length) {
      return {
        ...claim,
        supporting_evidence_ids: [],
        contradicting_evidence_ids: filings.map(item => item.id),
        verification_status: 'SOURCE_MISMATCH',
        notes: 'Corporate SEC filings do not establish a federal regulation change.',
      }
    }
    if (!authority.length) {
      return {
        ...claim,
        verification_status: 'UNSUPPORTED',
        notes: 'No authoritative regulator source proves a regulation change.',
      }
    }
  }

  if (contradicting.length) {
    verification_status = 'CONTRADICTED'
    notes = 'Contradicting evidence is present.'
  } else if (stale.length && !relevant.some(item => item.freshness === 'live' || item.freshness === 'recent')) {
    verification_status = 'STALE'
    notes = 'Matching evidence is stale.'
  } else if (relevant.length >= 2) {
    verification_status = 'SUPPORTED'
    notes = 'Multiple independent evidence items support the claim.'
  } else if (relevant.length === 1) {
    verification_status = 'PARTIALLY_SUPPORTED'
    notes = 'Only a single evidence item overlaps the claim.'
  }

  return {
    ...claim,
    supporting_evidence_ids: relevant.map(item => item.id).slice(0, 8),
    contradicting_evidence_ids: contradicting.map(item => item.id),
    verification_status,
    notes,
  }
}

export function verifyReports(reports: FrozenSeatReport[], evidence: IntelligenceEvidenceItem[]): AtomicClaim[] {
  return reports.flatMap(report => extractAtomicClaims(report).map(claim => verifyClaimAgainstEvidence(claim, evidence)))
}

export function challengeClaim(claim: AtomicClaim, evidence: IntelligenceEvidenceItem[]): PhoenixChallengeResult {
  const filingMismatch = claim.verification_status === 'SOURCE_MISMATCH'
  const weak = claim.verification_status === 'UNSUPPORTED' || claim.verification_status === 'STALE' || claim.verification_status === 'PARTIALLY_SUPPORTED'
  return {
    claim_id: claim.claim_id,
    alternateExplanation: filingMismatch
      ? 'The same facts may be a corporate disclosure or industry rumor rather than a binding federal rule change.'
      : 'The same facts may support a narrower operational or reporting change rather than the claimed conclusion.',
    missingSourceSearch: looksRegulatoryClaim(claim.claim_text)
      ? 'Search Federal Register / FMCSA / eCFR for an actual rule, not SEC EDGAR.'
      : 'Search for a primary source that would have to exist if the claim were true.',
    timelineCheck: 'Confirm published_at / effective date is inside the claimed window; otherwise treat as historical.',
    sourceAuthorityCheck: filingMismatch
      ? 'SEC EDGAR is not a federal transportation regulator.'
      : evidence.some(item => authoritySupportsRegulatoryClaim(item))
        ? 'At least one government/public-authority source is present.'
        : 'No high-authority source currently backs the claim.',
    causalLeap: /\b(because|therefore|will cause|means that)\b/i.test(claim.claim_text),
    injectionRisk: /ignore previous|system prompt|jailbreak/i.test(claim.claim_text),
    survived: !filingMismatch && !weak && claim.verification_status === 'SUPPORTED',
    notes: claim.notes,
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

export function buildConvergenceMap(input: {
  missionId: string
  roundRequestId: string
  logicalRequestId: string
  reports: FrozenSeatReport[]
  claims: AtomicClaim[]
  challenges: PhoenixChallengeResult[]
  evidence: IntelligenceEvidenceItem[]
}): ConvergenceMap {
  const discoveryReports = input.reports.filter(report => report.agentId !== 'aurora' && report.agentId !== 'astra')
  const clusters: ConvergenceClaim[] = []

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
    for (const item of input.evidence) {
      const origin = item.origin_type ?? 'unknown'
      origin_distribution[origin] = (origin_distribution[origin] ?? 0) + 1
    }

    let state: ConvergenceClaim['state'] = 'UNRESOLVED'
    if (claim.verification_status === 'SOURCE_MISMATCH' || claim.verification_status === 'CONTRADICTED') state = 'REJECTED'
    else if (claim.verification_status === 'UNSUPPORTED' || claim.verification_status === 'STALE') state = 'UNRESOLVED'
    else if (uniqueSeats.length >= 2 && claim.verification_status === 'SUPPORTED' && challenge?.survived !== false) {
      state = 'INDEPENDENT_CONVERGENCE'
    } else if (contradictedBy.length) state = 'CONTESTED'
    else if (claim.verification_status === 'PARTIALLY_SUPPORTED') state = 'WEAKLY_SUPPORTED'
    else if (claim.verification_status === 'SUPPORTED') state = 'WEAKLY_SUPPORTED'

    clusters.push({
      claim_id: claim.claim_id,
      claim_text: claim.claim_text,
      state,
      independently_supported_by: uniqueSeats,
      independently_contradicted_by: [...new Set(contradictedBy)],
      independent_support_count: uniqueSeats.length,
      independent_report_ids: [claim.report_id, ...supporters.map(item => item.report_id)],
      lumen_status: claim.verification_status,
      phoenix_survived: challenge ? challenge.survived : null,
      freshness: input.evidence[0]?.freshness ?? 'unknown',
      origin_distribution,
      confidence: claim.verification_status === 'SUPPORTED' ? 0.72 : claim.verification_status === 'PARTIALLY_SUPPORTED' ? 0.4 : 0.15,
      unresolved_gaps: claim.verification_status === 'UNSUPPORTED' || claim.verification_status === 'SOURCE_MISMATCH' ? [claim.notes] : [],
    })
  }

  return {
    missionId: input.missionId,
    roundRequestId: input.roundRequestId,
    logicalRequestId: input.logicalRequestId,
    claims: clusters,
    notes: [
      'Independent support counts distinct frozen reports, not paraphrases of a shared draft.',
      'Evidence quality outranks seat count.',
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
}): string {
  const independent = input.reports.filter(item => item.agentId !== 'aurora' && item.agentId !== 'astra')
  return [
    'You are AURORA. Synthesize frozen independent reports only. Do not introduce new evidence.',
    '',
    input.astra ? `ASTRA mission report:\n${input.astra.conclusion}` : '',
    '',
    'FROZEN INDEPENDENT REPORTS:',
    ...independent.map(report => `- ${report.report_kind} (${report.agentId}): ${report.conclusion}`),
    '',
    input.revisions.length ? `CROSS-REVIEW:\n${input.revisions.join('\n')}` : 'CROSS-REVIEW: none recorded',
    '',
    'LUMEN VERIFICATION:',
    ...input.claims.slice(0, 10).map(claim => `- ${claim.claim_id}: ${claim.verification_status} — ${claim.claim_text}`),
    '',
    'PHOENIX CHALLENGE:',
    ...input.challenges.slice(0, 8).map(item => `- ${item.claim_id}: survived=${item.survived} alt=${item.alternateExplanation}`),
    '',
    'CONVERGENCE:',
    ...input.convergence.claims.slice(0, 10).map(item => `- ${item.state} support=${item.independent_support_count} ${item.claim_text}`),
    '',
    'Cover in natural prose, not necessarily as headings: current answer; what independent seats found; where they converged; where they disagreed; what evidence won; what changed from prior research; what remains unknown; practical implications.',
  ].filter(Boolean).join('\n')
}
