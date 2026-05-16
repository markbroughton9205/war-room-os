import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { classifyConfidenceSummary } from '@/lib/intelligence/confidenceClassifier'
import { scanContradictions } from '@/lib/intelligence/contradictionScanner'
import { scoreEvidenceItems } from '@/lib/intelligence/evidenceScoring'
import type { IntelligenceQueryPlan } from '@/lib/intelligence/queryPlanner'
import { planIntelligenceQuery } from '@/lib/intelligence/queryPlanner'
import { runRedTeamVerification, type RedTeamVerificationReport } from '@/lib/intelligence/redTeamVerification'
import { normalizeSourceEvidence, type RawIntelligenceSourceRecord } from '@/lib/intelligence/sourceNormalizer'
import type { IntelligenceSourceType, SourceVerifiedLevel } from '@/lib/intelligence/sourceRegistry'

export type EvidenceConfidenceTier =
  | 'verified'
  | 'corroborated'
  | 'emerging'
  | 'weak_signal'
  | 'contradictory'
  | 'unsupported'

export type EvidenceFreshness = 'live' | 'recent' | 'aging' | 'stale' | 'unknown'

export type IntelligenceEvidenceItem = {
  id: string
  source_id: string
  source_type: IntelligenceSourceType
  source_label: string
  verified_level: SourceVerifiedLevel
  title: string
  url?: string
  claim: string
  content: string
  observed_at: string
  confidence: number
  confidence_tier: EvidenceConfidenceTier
  corroboration_count: number
  freshness: EvidenceFreshness
  source_reputation: number
  contradiction_flags: string[]
  evidence_density: number
  related_evidence_links: string[]
  weak_signal: boolean
}

export type IntelligenceFinding = {
  id: string
  summary: string
  confidence_tier: EvidenceConfidenceTier
  evidence_ids: string[]
}

export type IntelligenceConfidenceSummary = {
  overall: EvidenceConfidenceTier
  score: number
  verified_count: number
  corroborated_count: number
  emerging_count: number
  weak_signal_count: number
  contradictory_count: number
  unsupported_count: number
}

export type IntelligenceSourceFailure = {
  source_id: string
  reason: string
  failure_behavior: 'skip' | 'degrade' | 'block_operational_truth'
}

export type IntelligencePacket = {
  id: string
  decree: string
  timestamp: string
  query_plan: IntelligenceQueryPlan
  sources_used: string[]
  findings: IntelligenceFinding[]
  evidence: IntelligenceEvidenceItem[]
  confidence_summary: IntelligenceConfidenceSummary
  contradictions: string[]
  weak_signals: IntelligenceEvidenceItem[]
  unsupported_claims: string[]
  source_failures: IntelligenceSourceFailure[]
  freshness: EvidenceFreshness
  gaps: string[]
  red_team_verification: RedTeamVerificationReport
}

export type IntelligenceClientMetadata = {
  packetId: string
  sourcesUsed: number
  sourceLabels: string[]
  confidenceLevel: EvidenceConfidenceTier
  confidenceScore: number
  freshness: EvidenceFreshness
  contradictionWarnings: number
  weakSignalDetected: boolean
  unsupportedClaims: number
  redTeamWarnings: number
}

function makePacketId(timestamp: string, decree: string): string {
  let hash = 0
  for (let i = 0; i < decree.length; i++) hash = (Math.imul(31, hash) + decree.charCodeAt(i)) | 0
  return `intel-${timestamp.replace(/[-:.TZ]/g, '').slice(0, 14)}-${Math.abs(hash).toString(36)}`
}

function freshnessFromEvidence(evidence: IntelligenceEvidenceItem[]): EvidenceFreshness {
  if (evidence.some(item => item.freshness === 'live')) return 'live'
  if (evidence.some(item => item.freshness === 'recent')) return 'recent'
  if (evidence.some(item => item.freshness === 'aging')) return 'aging'
  if (evidence.some(item => item.freshness === 'stale')) return 'stale'
  return 'unknown'
}

function buildFindings(evidence: IntelligenceEvidenceItem[]): IntelligenceFinding[] {
  return evidence.slice(0, 8).map((item, index) => ({
    id: `finding-${index + 1}`,
    summary: item.claim,
    confidence_tier: item.confidence_tier,
    evidence_ids: [item.id, ...item.related_evidence_links].slice(0, 5),
  }))
}

function sourceFailureRecords(queryPlan: IntelligenceQueryPlan, rawRecords: RawIntelligenceSourceRecord[]): IntelligenceSourceFailure[] {
  const rawBySource = new Map(rawRecords.map(record => [record.source_id, record]))
  return queryPlan.source_plans
    .filter(plan => plan.configured || plan.required)
    .flatMap(plan => {
      const raw = rawBySource.get(plan.source_id)
      if (raw?.ok) return []
      const behavior = raw?.failure_behavior ?? 'degrade'
      return [{
        source_id: plan.source_id,
        reason: raw?.error ?? (plan.configured ? 'source did not return usable evidence' : 'source not configured'),
        failure_behavior: behavior,
      }]
    })
}

export function buildIntelligencePacket(args: {
  decree: string
  timestamp?: string
  queryPlan?: IntelligenceQueryPlan
  rawSources: RawIntelligenceSourceRecord[]
  unsupportedClaims?: string[]
}): IntelligencePacket {
  const timestamp = args.timestamp ?? new Date().toISOString()
  const queryPlan = args.queryPlan ?? planIntelligenceQuery(args.decree)
  const normalized = normalizeSourceEvidence(args.rawSources, timestamp)
  const withContradictions = scanContradictions(normalized)
  const scored = scoreEvidenceItems(withContradictions)
  const confidenceSummary = classifyConfidenceSummary(scored)
  const redTeam = runRedTeamVerification({
    evidence: scored,
    confidenceSummary,
    unsupportedClaims: args.unsupportedClaims ?? [],
    sourceFailures: sourceFailureRecords(queryPlan, args.rawSources),
  })

  const contradictions = [
    ...new Set(scored.flatMap(item => item.contradiction_flags)),
    ...redTeam.contradiction_chains,
  ]

  const gaps = [
    ...queryPlan.source_plans
      .filter(plan => plan.required && !scored.some(item => item.source_id === plan.source_id))
      .map(plan => `Required source unavailable or empty: ${plan.source_id}`),
    ...redTeam.operational_truth_blocks,
  ]

  return {
    id: makePacketId(timestamp, args.decree),
    decree: args.decree,
    timestamp,
    query_plan: queryPlan,
    sources_used: [...new Set(scored.map(item => item.source_id))],
    findings: buildFindings(scored),
    evidence: scored,
    confidence_summary: confidenceSummary,
    contradictions,
    weak_signals: scored.filter(item => item.weak_signal || item.confidence_tier === 'weak_signal'),
    unsupported_claims: [...(args.unsupportedClaims ?? []), ...redTeam.unsupported_claims],
    source_failures: sourceFailureRecords(queryPlan, args.rawSources),
    freshness: freshnessFromEvidence(scored),
    gaps: [...new Set(gaps)],
    red_team_verification: redTeam,
  }
}

export function toIntelligenceClientMetadata(packet: IntelligencePacket): IntelligenceClientMetadata {
  return {
    packetId: packet.id,
    sourcesUsed: packet.sources_used.length,
    sourceLabels: [...new Set(packet.evidence.map(item => item.source_label))].slice(0, 6),
    confidenceLevel: packet.confidence_summary.overall,
    confidenceScore: packet.confidence_summary.score,
    freshness: packet.freshness,
    contradictionWarnings: packet.contradictions.length,
    weakSignalDetected: packet.weak_signals.length > 0,
    unsupportedClaims: packet.unsupported_claims.length,
    redTeamWarnings: packet.red_team_verification.warnings.length,
  }
}

export function buildIntelligenceGroundingBlock(packet: IntelligencePacket, family?: CouncilOrchestrationFamily): string {
  const roleLine = family
    ? `- familyLens: ${family} receives the SAME packet as the other families; only the analysis framing changes.`
    : '- familyLens: all families receive this same packet.'
  const lines = [
    '### Universal intelligence packet (server-built; read-only)',
    `- packetId: ${packet.id} · generatedAt: ${packet.timestamp}`,
    `- confidence: ${packet.confidence_summary.overall} (${packet.confidence_summary.score.toFixed(2)}) · freshness: ${packet.freshness}`,
    `- sourcesUsed: ${packet.sources_used.length ? packet.sources_used.join(', ') : 'none'}`,
    `- weakSignals: ${packet.weak_signals.length} · contradictions: ${packet.contradictions.length} · unsupportedClaims: ${packet.unsupported_claims.length}`,
    roleLine,
  ]
  if (packet.findings.length) {
    lines.push('- findings:')
    for (const finding of packet.findings.slice(0, 6)) {
      lines.push(`  - [${finding.confidence_tier}] ${finding.summary.slice(0, 420)}`)
    }
  }
  if (packet.contradictions.length) {
    lines.push(`- contradictionWarnings: ${packet.contradictions.slice(0, 5).join(' || ')}`)
  }
  if (packet.weak_signals.length) {
    lines.push(`- weakSignalNote: ${packet.weak_signals.length} item(s) may inform radar/trend analysis but are not operational truth.`)
  }
  if (packet.gaps.length) {
    lines.push(`- gaps: ${packet.gaps.slice(0, 5).join(' || ')}`)
  }
  lines.push(
    '- Operational truth doctrine: unverified information may be discussed only with uncertainty labels. Do not convert weak signals, rumors, stale evidence, or unsupported claims into facts.',
  )
  return lines.join('\n')
}
