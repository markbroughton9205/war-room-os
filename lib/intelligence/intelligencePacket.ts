import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { classifyConfidenceSummary } from '@/lib/intelligence/confidenceClassifier'
import { scanContradictions } from '@/lib/intelligence/contradictionScanner'
import { scoreEvidenceItems } from '@/lib/intelligence/evidenceScoring'
import {
  buildLocalIntelligenceLayer,
  toLocalIntelligenceClientMetadata,
  type LocalIntelligenceClientMetadata,
  type LocalIntelligenceLayer,
} from '@/lib/intelligence/local/localSignalIngestion'
import type { IntelligenceQueryPlan } from '@/lib/intelligence/queryPlanner'
import { planIntelligenceQuery } from '@/lib/intelligence/queryPlanner'
import { runRedTeamVerification, type RedTeamVerificationReport } from '@/lib/intelligence/redTeamVerification'
import { normalizeSourceEvidence, type RawIntelligenceSourceRecord } from '@/lib/intelligence/sourceNormalizer'
import type { IntelligenceSourceType, SourceVerifiedLevel } from '@/lib/intelligence/sourceRegistry'
import type { RetrievalOrchestration, RetrievalSourceMix } from '@/lib/intelligence/sources/retrievalOrchestrator'

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
  local_intelligence?: LocalIntelligenceLayer
  retrieval?: RetrievalOrchestration
}

export type IntelligenceClientMetadata = {
  packetId: string
  sourcesUsed: number
  sourceLabels: string[]
  sourcesPreview: string
  confidenceLevel: EvidenceConfidenceTier
  confidenceScore: number
  freshness: EvidenceFreshness
  contradictionWarnings: number
  weakSignalDetected: boolean
  unsupportedClaims: number
  redTeamWarnings: number
  local?: LocalIntelligenceClientMetadata
  retrieval?: {
    required: boolean
    success: boolean
    sourceMix: RetrievalSourceMix
    gaps: number
    health: RetrievalOrchestration['health_summary']
  }
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

function hostnameFromUrl(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

export function buildSourcesPreview(packet: IntelligencePacket, max = 4): string {
  const names = new Set<string>()
  for (const item of packet.evidence) {
    const host = hostnameFromUrl(item.url)
    names.add(host ?? item.source_label)
    if (names.size >= max) break
  }
  if (!names.size && packet.sources_used.length) {
    for (const source of packet.sources_used.slice(0, max)) names.add(source)
  }
  return Array.from(names).join(', ')
}

export function buildIntelligencePacket(args: {
  decree: string
  timestamp?: string
  queryPlan?: IntelligenceQueryPlan
  rawSources: RawIntelligenceSourceRecord[]
  unsupportedClaims?: string[]
  retrieval?: RetrievalOrchestration
}): IntelligencePacket {
  const timestamp = args.timestamp ?? new Date().toISOString()
  const queryPlan = args.queryPlan ?? planIntelligenceQuery(args.decree)
  const normalized = normalizeSourceEvidence(args.rawSources, timestamp)
  const withContradictions = scanContradictions(normalized)
  const scored = scoreEvidenceItems(withContradictions)
  const confidenceSummary = classifyConfidenceSummary(scored)
  const sourceFailures = sourceFailureRecords(queryPlan, args.rawSources)
  const redTeam = runRedTeamVerification({
    evidence: scored,
    confidenceSummary,
    unsupportedClaims: args.unsupportedClaims ?? [],
    sourceFailures,
  })
  const localIntelligence = buildLocalIntelligenceLayer({
    decree: args.decree,
    evidence: scored,
    sourceFailures,
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
    source_failures: sourceFailures,
    freshness: freshnessFromEvidence(scored),
    gaps: [...new Set(gaps)],
    red_team_verification: redTeam,
    ...(localIntelligence.active ? { local_intelligence: localIntelligence } : {}),
    ...(args.retrieval ? { retrieval: args.retrieval } : {}),
  }
}

export function toIntelligenceClientMetadata(packet: IntelligencePacket): IntelligenceClientMetadata {
  const sourceLabels = [...new Set(packet.evidence.map(item => item.source_label))].slice(0, 6)
  return {
    packetId: packet.id,
    sourcesUsed: packet.sources_used.length,
    sourceLabels,
    sourcesPreview: buildSourcesPreview(packet),
    confidenceLevel: packet.confidence_summary.overall,
    confidenceScore: packet.confidence_summary.score,
    freshness: packet.freshness,
    contradictionWarnings: packet.contradictions.length,
    weakSignalDetected: packet.weak_signals.length > 0,
    unsupportedClaims: packet.unsupported_claims.length,
    redTeamWarnings: packet.red_team_verification.warnings.length,
    ...(packet.local_intelligence ? { local: toLocalIntelligenceClientMetadata(packet.local_intelligence) } : {}),
    ...(packet.retrieval
      ? {
          retrieval: {
            required: packet.retrieval.required,
            success: packet.retrieval.retrieval_success,
            sourceMix: packet.retrieval.source_mix,
            gaps: packet.retrieval.retrieval_gaps.length,
            health: packet.retrieval.health_summary,
          },
        }
      : {}),
  }
}

export function buildIntelligenceGroundingBlock(packet: IntelligencePacket, family?: CouncilOrchestrationFamily): string {
  const roleLine = family
    ? `- familyLens: ${family} receives the SAME packet as the other families; only the analysis framing changes.`
    : '- familyLens: all families receive this same packet.'
  const lines = [
    '### Universal intelligence packet (server-built; read-only)',
    `- packetId: ${packet.id} · generatedAt: ${packet.timestamp}`,
    `- provenance: ${packet.sources_used.length} source(s) · ${buildSourcesPreview(packet) || 'none'} · freshness=${packet.freshness} · confidence=${packet.confidence_summary.overall} (${packet.confidence_summary.score.toFixed(2)})`,
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
  if (packet.retrieval) {
    const retrieval = packet.retrieval
    const mix = Object.entries(retrieval.source_mix).map(([tier, count]) => `${tier}=${count}`).join(', ') || 'none'
    lines.push(
      `- retrieval: required=${retrieval.required} · success=${retrieval.retrieval_success} · reasons=${retrieval.reasons.join(', ') || 'none'} · mix=${mix}`,
    )
    if (retrieval.retrieval_gaps.length) {
      lines.push(`- retrievalGaps: ${retrieval.retrieval_gaps.slice(0, 5).join(' || ')}`)
    }
  }
  if (packet.local_intelligence) {
    const local = packet.local_intelligence
    lines.push(
      `- localIntelligence: sourceDepth=${local.source_depth} · localityDepth=${local.locality_depth} · corroboration=${local.corroboration_level} · weakSignals=${local.weak_signal_count} · contradictions=${local.contradiction_warnings}`,
    )
    if (local.local_signals.length) {
      lines.push('- localSignals:')
      for (const signal of local.local_signals.slice(0, 5)) {
        lines.push(`  - [${signal.layer}/${signal.confidence}] ${signal.summary.slice(0, 360)}`)
      }
    }
    if (local.narratives.length) {
      lines.push(`- localNarratives: ${local.narratives.slice(0, 4).map(n => `${n.label}(${n.narrative_momentum})`).join(' | ')}`)
    }
    if (local.gaps.length) {
      lines.push(`- localGaps: ${local.gaps.slice(0, 4).join(' || ')}`)
    }
  }
  if (packet.gaps.length) {
    lines.push(`- gaps: ${packet.gaps.slice(0, 5).join(' || ')}`)
  }
  lines.push(
    '- Response shape: answer the decree directly. Use only the headings that have content: Verified, Emerging, Contradictions, Unknowns, Optional recommended next step.',
  )
  lines.push(
    '- Local response shape: for local questions, use only non-empty headings from Verified, Emerging, Local chatter, Contradictions, Unknowns, Optional next step.',
  )
  lines.push(
    '- Inference labels: say "Unconfirmed local discussion suggests...", "Weak signal only...", "No verified evidence currently...", or "Inference based on limited reporting..." when support is incomplete.',
  )
  lines.push(
    '- Context restraint: do not relate this to Commander mission, business goals, philosophy, or strategy unless the decree explicitly asks for that relevance.',
  )
  lines.push(
    '- Operational truth doctrine: unverified information may be discussed only with uncertainty labels. Do not convert weak signals, rumors, stale evidence, inferred locality, or unsupported claims into facts. Do not imply live/current awareness beyond the packet freshness and connected sources.',
  )
  lines.push(
    '- Mandatory retrieval doctrine: if retrieval.required=true and retrieval.success=false, state retrieval failure clearly and do not answer current/live facts from model priors.',
  )
  return lines.join('\n')
}
