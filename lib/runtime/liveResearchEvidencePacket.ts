/**
 * Phase 5 — Live internet research evidence attached to council prompts.
 * URLs must only originate from user-provided links (validated) or provider APIs — never invented.
 */

import type { CouncilResponseCompletion } from '@/lib/council/responseCompletion'
import type { IntelligenceClientMetadata, IntelligencePacket } from '@/lib/intelligence/intelligencePacket'

export type LiveResearchSourceKind = 'tavily' | 'grok_xai' | 'gemini' | 'direct_fetch'

export type LiveResearchSourceRecord = {
  kind: LiveResearchSourceKind
  ok: boolean
  /** ISO timestamp when this leg finished */
  queriedAt: string
  /** Real URLs only (API results or validated user URLs). */
  urls?: string[]
  error?: string
  /** Short neutral note (e.g. byte cap), not full page bodies. */
  note?: string
}

export type LiveResearchEvidencePacket = {
  usedLiveResearch: boolean
  generatedAt: string
  sources: LiveResearchSourceRecord[]
  /** Short evidence-oriented summary; may be empty when all legs failed. */
  findings: string
  confidence: number
  freshness: 'unknown' | 'recent' | 'stale'
  contradictions: string[]
  unresolvedQuestions: string[]
  /** When providers errored but the pipeline stayed isolated. */
  researchErrorSummary?: string
  /** Phase 8A universal packet: shared intelligence, evidence classification, and Red Team hardening. */
  intelligencePacket?: IntelligencePacket
}

export type LiveResearchClientUi = {
  mode: 'inactive' | 'active' | 'sources_queried' | 'verified' | 'partial' | 'unavailable' | 'completing' | 'failed'
  sourcesCount: number
  /** Single-line label for compact UI. */
  label: string
  /** Council-side phase for this request (evidence vs model vs released). */
  councilPhase?: 'none' | 'evidence' | 'model_running' | 'released'
  /** Present when server assessed model output boundary (Phase 6). */
  responseCompletion?: CouncilResponseCompletion
  /** Compact Phase 8A metadata for the Command Center; raw telemetry stays out of chat. */
  intelligence?: IntelligenceClientMetadata
}

export function emptyLiveResearchEvidencePacket(generatedAt: string, summary?: string): LiveResearchEvidencePacket {
  return {
    usedLiveResearch: false,
    generatedAt,
    sources: [],
    findings: '',
    confidence: 0,
    freshness: 'unknown',
    contradictions: [],
    unresolvedQuestions: [],
    ...(summary ? { researchErrorSummary: summary } : {}),
  }
}

export function buildLiveResearchGroundingBlock(packet: LiveResearchEvidencePacket): string {
  const lines: string[] = ['### Live research evidence (server-fetched; read-only)']
  lines.push(`- usedLiveResearch: ${packet.usedLiveResearch} · generatedAt: ${packet.generatedAt}`)
  lines.push(`- confidence: ${packet.confidence.toFixed(2)} · freshness: ${packet.freshness}`)
  if (packet.intelligencePacket) {
    const intel = packet.intelligencePacket
    lines.push(
      `- universalIntelligence: ${intel.id} · tier=${intel.confidence_summary.overall} · evidence=${intel.evidence.length} · weakSignals=${intel.weak_signals.length} · contradictions=${intel.contradictions.length}`,
    )
  }
  if (packet.sources.length) {
    for (const s of packet.sources) {
      const urlPart = s.urls?.length ? ` urls=${s.urls.slice(0, 4).join(' | ')}` : ''
      lines.push(`- source[${s.kind}]: ok=${s.ok}${urlPart}${s.error ? ` error=${s.error}` : ''}`)
    }
  } else {
    lines.push('- sources: none')
  }
  if (packet.findings.trim()) {
    lines.push(`- findings (may be incomplete; not legal/medical advice):\n${packet.findings.trim().slice(0, 3500)}`)
  } else {
    lines.push('- findings: none')
  }
  if (packet.contradictions.length) {
    lines.push(`- contradictions: ${packet.contradictions.join(' || ')}`)
  }
  if (packet.unresolvedQuestions.length) {
    lines.push(`- unresolvedQuestions: ${packet.unresolvedQuestions.join(' || ')}`)
  }
  if (packet.researchErrorSummary) {
    lines.push(`- pipelineNote: ${packet.researchErrorSummary}`)
  }
  lines.push(
    '- Epistemic discipline: Label claims as **verified current** only when directly supported by the sources above. Mark **inference** vs **speculation** vs **historical / general knowledge**. Never invent URLs, citations, or article titles. If live research failed or is partial, say so explicitly; do not fill gaps with fabricated “current events”.',
  )
  return lines.join('\n')
}

export type LiveResearchCouncilDraftPhase = 'none' | 'evidence' | 'model_running'

export function computeLiveResearchClientUi(
  packet: LiveResearchEvidencePacket | undefined,
  researchAttempted: boolean,
  opts?: { councilPhase?: LiveResearchCouncilDraftPhase },
): LiveResearchClientUi {
  const councilPhase = opts?.councilPhase ?? 'none'
  const intelligence = packet?.intelligencePacket ? toIntelligenceMetadata(packet.intelligencePacket) : undefined
  if (!researchAttempted) {
    return { mode: 'inactive', sourcesCount: 0, label: 'Live research idle', councilPhase: 'none' }
  }
  if (councilPhase === 'evidence') {
    return {
      mode: 'active',
      sourcesCount: packet?.sources.length ?? 0,
      label: 'Research — gathering evidence',
      councilPhase: 'evidence',
      ...(intelligence ? { intelligence } : {}),
    }
  }
  if (councilPhase === 'model_running') {
    const ok = packet?.sources.filter(s => s.ok).length ?? 0
    return {
      mode: 'completing',
      sourcesCount: ok,
      label: 'Research — council drafting',
      councilPhase: 'model_running',
      ...(intelligence ? { intelligence } : {}),
    }
  }

  if (!packet || packet.sources.every(s => !s.ok)) {
    return {
      mode: packet?.researchErrorSummary ? 'failed' : 'unavailable',
      sourcesCount: 0,
      label: packet?.researchErrorSummary ? 'Research pipeline failed' : 'Research unavailable',
      councilPhase: 'released',
      ...(intelligence ? { intelligence } : {}),
    }
  }
  const sourcesCount = packet.sources.filter(s => s.ok).length ?? 0
  const queried = packet.sources.length ?? 0

  if (packet.usedLiveResearch && packet.confidence >= 0.72 && sourcesCount >= 2 && !packet.researchErrorSummary) {
    return {
      mode: 'verified',
      sourcesCount: queried,
      label: 'Current info verified (multi-source)',
      councilPhase: 'released',
      ...(intelligence ? { intelligence } : {}),
    }
  }
  if (packet.usedLiveResearch && sourcesCount >= 1) {
    if (sourcesCount < queried) {
      return {
        mode: 'partial',
        sourcesCount: queried,
        label: 'Research partially available',
        councilPhase: 'released',
        ...(intelligence ? { intelligence } : {}),
      }
    }
    return {
      mode: 'sources_queried',
      sourcesCount: queried,
      label: 'Sources queried',
      councilPhase: 'released',
      ...(intelligence ? { intelligence } : {}),
    }
  }
  if (packet.usedLiveResearch) {
    return { mode: 'active', sourcesCount: queried, label: 'Live research active', councilPhase: 'released', ...(intelligence ? { intelligence } : {}) }
  }
  return {
    mode: 'partial',
    sourcesCount: queried,
    label: 'Research partially available',
    councilPhase: 'released',
    ...(intelligence ? { intelligence } : {}),
  }
}

export type LiveResearchClientSummary = {
  usedLiveResearch: boolean
  confidence: number
  freshness: LiveResearchEvidencePacket['freshness']
  sourceKinds: LiveResearchSourceKind[]
  sourcesQueried: number
  sourcesSucceeded: number
  /** Model output quality signal for this turn (Phase 6). */
  responseCompletion?: CouncilResponseCompletion
  /** Phase 8A command-center metadata. */
  intelligence?: IntelligenceClientMetadata
}

export function toLiveResearchClientSummary(
  packet: LiveResearchEvidencePacket | undefined,
  responseCompletion?: CouncilResponseCompletion,
): LiveResearchClientSummary | undefined {
  if (!packet) return undefined
  return {
    usedLiveResearch: packet.usedLiveResearch,
    confidence: packet.confidence,
    freshness: packet.freshness,
    sourceKinds: packet.sources.map(s => s.kind),
    sourcesQueried: packet.sources.length,
    sourcesSucceeded: packet.sources.filter(s => s.ok).length,
    ...(packet.intelligencePacket ? { intelligence: toIntelligenceMetadata(packet.intelligencePacket) } : {}),
    ...(responseCompletion ? { responseCompletion } : {}),
  }
}

function toIntelligenceMetadata(packet: IntelligencePacket): IntelligenceClientMetadata {
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
