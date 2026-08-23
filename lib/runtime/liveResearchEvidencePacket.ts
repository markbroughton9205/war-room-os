/**
 * Phase 5 — Live internet research evidence attached to council prompts.
 * URLs must only originate from user-provided links (validated) or provider APIs — never invented.
 */

import type { CouncilResponseCompletion } from '@/lib/council/responseCompletion'
import {
  toIntelligenceClientMetadata,
  type IntelligenceClientMetadata,
  type IntelligencePacket,
} from '@/lib/intelligence/intelligencePacket'

export type LiveResearchSourceKind = 'tavily' | 'public_rss' | 'grok_xai' | 'gemini' | 'direct_fetch'

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
  retrievalStatus?: {
    retrieval_required: boolean
    retrieval_started: boolean
    retrieval_complete: boolean
    retrieval_failed: boolean
    synthesis_allowed: boolean
  }
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
      `- universalIntelligence: ${intel.id} · sources=${intel.sources_used.length} · preview=${toIntelligenceClientMetadata(intel).sourcesPreview || 'none'} · tier=${intel.confidence_summary.overall} · freshness=${intel.freshness} · weakSignals=${intel.weak_signals.length} · contradictions=${intel.contradictions.length}`,
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
    '- Epistemic discipline: Answer the decree directly. Label claims as **verified current** only when directly supported by the sources above. Mark **inference**, **weak signal**, **speculation**, and **unknown** clearly. Never invent URLs, local facts, citations, article titles, or current conditions. Do not add Commander mission/business/strategy relevance unless asked.',
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
  const retrievalStatus = packet?.intelligencePacket?.retrieval
    ? {
        retrieval_required: packet.intelligencePacket.retrieval.retrieval_required,
        retrieval_started: packet.intelligencePacket.retrieval.retrieval_started,
        retrieval_complete: packet.intelligencePacket.retrieval.retrieval_complete,
        retrieval_failed: packet.intelligencePacket.retrieval.retrieval_failed,
        synthesis_allowed: packet.intelligencePacket.retrieval.synthesis_allowed,
      }
    : researchAttempted
      ? {
          retrieval_required: true,
          retrieval_started: true,
          retrieval_complete: false,
          retrieval_failed: false,
          synthesis_allowed: false,
        }
      : undefined
  if (!researchAttempted) {
    return { mode: 'inactive', sourcesCount: 0, label: 'Live research idle', councilPhase: 'none' }
  }
  if (councilPhase === 'evidence') {
    return {
      mode: 'active',
      sourcesCount: packet?.sources.length ?? 0,
      label: 'Retrieving live intelligence...',
      councilPhase: 'evidence',
      ...(intelligence ? { intelligence } : {}),
      ...(retrievalStatus ? { retrievalStatus } : {}),
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
      ...(retrievalStatus ? { retrievalStatus } : {}),
    }
  }

  if (!packet || packet.sources.every(s => !s.ok)) {
    return {
      mode: packet?.researchErrorSummary ? 'failed' : 'unavailable',
      sourcesCount: 0,
      label: packet?.researchErrorSummary ? 'Research pipeline failed' : 'Research unavailable',
      councilPhase: 'released',
      ...(intelligence ? { intelligence } : {}),
      ...(retrievalStatus ? { retrievalStatus } : {}),
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
      ...(retrievalStatus ? { retrievalStatus } : {}),
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
        ...(retrievalStatus ? { retrievalStatus } : {}),
      }
    }
    return {
      mode: 'sources_queried',
      sourcesCount: queried,
      label: 'Sources queried',
      councilPhase: 'released',
      ...(intelligence ? { intelligence } : {}),
      ...(retrievalStatus ? { retrievalStatus } : {}),
    }
  }
  if (packet.usedLiveResearch) {
    return { mode: 'active', sourcesCount: queried, label: 'Live research active', councilPhase: 'released', ...(intelligence ? { intelligence } : {}), ...(retrievalStatus ? { retrievalStatus } : {}) }
  }
  return {
    mode: 'partial',
    sourcesCount: queried,
    label: 'Research partially available',
    councilPhase: 'released',
    ...(intelligence ? { intelligence } : {}),
    ...(retrievalStatus ? { retrievalStatus } : {}),
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
  return toIntelligenceClientMetadata(packet)
}
