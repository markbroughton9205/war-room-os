import { kimiChunkToEvidence, retrieveKimiWaveIntelligence } from '@/lib/intelligence/kimiWaves'
import { compareOldVsNew, type OldVsNewComparison } from '@/lib/intelligence/comparison/oldVsNew'
import { planLiveRetrieval, type LiveRetrievalPlan } from '@/lib/intelligence/comparison/gapDetection'
import { scoreEvidenceItems } from '@/lib/intelligence/evidenceScoring'
import type { IntelligenceEvidenceItem, IntelligencePacket } from '@/lib/intelligence/intelligencePacket'
import { classifyConfidenceSummary } from '@/lib/intelligence/confidenceClassifier'
import { emptyLiveResearchEvidencePacket, type LiveResearchEvidencePacket } from '@/lib/runtime/liveResearchEvidencePacket'
import { persistStoredResearchPacket } from '@/lib/intelligence/storedResearch/store'
import { retrieveStoredResearch, storedPacketToEvidence } from '@/lib/intelligence/storedResearch/retrieve'
import type { StoredResearchPacket, StoredResearchWriteResult } from '@/lib/intelligence/storedResearch/types'
import { crossCheckKimiSourcesAgainstRegistry, type CatalogCrossCheckResult } from '@/lib/intelligence/sourceCatalog/crossCheck'
import { classifyResearchDomain } from '@/lib/research/researchDomainRouter'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'

export type PriorIntelligenceResult = {
  kimiOk: boolean
  storedOk: boolean
  kimiCount: number
  storedCount: number
  evidence: IntelligenceEvidenceItem[]
  honestyNotes: string[]
  catalog?: CatalogCrossCheckResult
}

export type PriorAwareResearchTurn = {
  packet: LiveResearchEvidencePacket
  prior: PriorIntelligenceResult
  comparison: OldVsNewComparison
  retrievalPlan: LiveRetrievalPlan
  persistence: StoredResearchWriteResult
}

function makePacketId(timestamp: string, decree: string): string {
  let hash = 0
  for (let i = 0; i < decree.length; i++) hash = (Math.imul(31, hash) + decree.charCodeAt(i)) | 0
  return `stored-research-${timestamp.replace(/[-:.TZ]/g, '').slice(0, 14)}-${Math.abs(hash).toString(36)}`
}

export async function retrievePriorIntelligence(args: {
  decree: string
  supabase?: WarRoomSupabase | null
  nowIso?: string
}): Promise<PriorIntelligenceResult> {
  const nowIso = args.nowIso ?? new Date().toISOString()
  const honestyNotes: string[] = []
  const evidence: IntelligenceEvidenceItem[] = []

  const kimi = retrieveKimiWaveIntelligence(args.decree)
  if (!kimi.ok) {
    honestyNotes.push(kimi.note ?? 'Prior Kimi Wave retrieval unavailable this round.')
  } else if (kimi.note) {
    honestyNotes.push(kimi.note)
  }
  if (kimi.ok) {
    evidence.push(...kimi.records.map(chunk => kimiChunkToEvidence(chunk, nowIso)))
  }

  const stored = await retrieveStoredResearch(args.decree, { supabase: args.supabase, nowIso })
  if (!stored.ok) {
    honestyNotes.push(stored.note ?? 'Prior stored research retrieval unavailable this round.')
  } else if (stored.note && !stored.hits.length) {
    honestyNotes.push(stored.note)
  }
  if (stored.ok) {
    for (const hit of stored.hits) {
      evidence.push(...storedPacketToEvidence(hit.packet, nowIso))
    }
  }

  const catalog = kimi.ok ? crossCheckKimiSourcesAgainstRegistry(kimi.records) : undefined

  return {
    kimiOk: kimi.ok,
    storedOk: stored.ok,
    kimiCount: kimi.ok ? kimi.records.length : 0,
    storedCount: stored.ok ? stored.hits.length : 0,
    evidence,
    honestyNotes,
    catalog,
  }
}

function mergeEvidenceIntoPacket(
  packet: LiveResearchEvidencePacket,
  extra: IntelligenceEvidenceItem[],
  comparison: OldVsNewComparison,
  honestyNotes: string[],
): LiveResearchEvidencePacket {
  const intel = packet.intelligencePacket
  if (!intel) {
    return {
      ...packet,
      unresolvedQuestions: [...packet.unresolvedQuestions, ...honestyNotes],
    }
  }
  const mergedEvidence = scoreEvidenceItems([...extra, ...intel.evidence])
  const next: IntelligencePacket = {
    ...intel,
    evidence: mergedEvidence,
    sources_used: [...new Set(mergedEvidence.map(item => item.source_id))],
    confidence_summary: classifyConfidenceSummary(mergedEvidence),
    gaps: [...intel.gaps, ...honestyNotes, ...comparison.priorClaims.filter(claim => claim.status === 'UNVERIFIED' || claim.status === 'STALE').map(claim => claim.notes)],
  }
  return {
    ...packet,
    intelligencePacket: next,
    unresolvedQuestions: [...packet.unresolvedQuestions, ...honestyNotes.filter(Boolean)],
  }
}

function toStoredPacket(args: {
  decree: string
  packet: LiveResearchEvidencePacket
  comparison: OldVsNewComparison
  conversationId?: string | null
  logicalRequestId?: string | null
  roundRequestId?: string | null
}): StoredResearchPacket {
  const createdAt = args.packet.generatedAt
  const intel = args.packet.intelligencePacket
  const persistable = (intel?.evidence ?? []).filter(item => {
    if (item.origin_type === 'MODEL_INFERENCE') return false
    if (item.origin_type === 'TERRA' || item.origin_type === 'RUNTIME_TELEMETRY') return false
    return item.origin_type === 'LIVE_WEB' || item.origin_type === 'KIMI_WAVE' || item.origin_type === 'STORED_RESEARCH' || !item.origin_type
  })
  return {
    id: intel?.id ? `stored-${intel.id}` : makePacketId(createdAt, args.decree),
    decree: args.decree,
    createdAt,
    conversationId: args.conversationId ?? null,
    roundRequestId: args.roundRequestId ?? null,
    logicalRequestId: args.logicalRequestId ?? null,
    domain: classifyResearchDomain(args.decree),
    evidence: persistable,
    sourceFailures: intel?.source_failures ?? [],
    comparison: args.comparison,
    verifiedSummary: args.packet.findings.slice(0, 4000),
    summarySource: 'research_packet_findings',
    queryClassification: classifyResearchDomain(args.decree),
    freshness: intel?.freshness ?? 'unknown',
    confidence: args.packet.confidence,
    confidenceTier: intel?.confidence_summary.overall ?? 'unsupported',
    contradictions: args.packet.contradictions,
    unsupportedClaims: intel?.unsupported_claims ?? args.packet.unresolvedQuestions,
    gaps: intel?.gaps ?? [],
    origin_type: 'STORED_RESEARCH',
  }
}

export async function runPriorAwareResearchTurn(args: {
  decreeText: string
  liveQueryText?: string
  conversationId?: string | null
  logicalRequestId?: string | null
  roundRequestId?: string | null
  intentConfidence: number
  supabase?: WarRoomSupabase | null
  researchIntentSaysGo: boolean
  runLiveResearch: (queryText: string) => Promise<LiveResearchEvidencePacket>
}): Promise<PriorAwareResearchTurn> {
  const prior = await retrievePriorIntelligence({
    decree: args.decreeText,
    supabase: args.supabase,
  })
  const retrievalPlan = planLiveRetrieval({
    decree: args.decreeText,
    prior: prior.evidence,
    researchIntentSaysGo: args.researchIntentSaysGo,
  })

  let packet: LiveResearchEvidencePacket
  if (retrievalPlan.shouldRunLiveResearch) {
    packet = await args.runLiveResearch(args.liveQueryText ?? args.decreeText)
  } else {
    packet = {
      ...emptyLiveResearchEvidencePacket(new Date().toISOString()),
      findings: retrievalPlan.catalogOnly
        ? 'Live web search skipped: this is a source-catalog / implementation-state question. Kimi catalog + completionRegistry are the evidence.'
        : `Live research not required this round (${retrievalPlan.skipReasons.join(', ') || 'gap plan'}).`,
      honestyNotes: prior.honestyNotes,
    }
  }

  const liveItems = (packet.intelligencePacket?.evidence ?? []).filter(item => item.origin_type === 'LIVE_WEB')
  const comparison = compareOldVsNew({ prior: prior.evidence, live: liveItems })
  packet = mergeEvidenceIntoPacket(packet, prior.evidence, comparison, prior.honestyNotes)
  packet = {
    ...packet,
    comparison,
    honestyNotes: prior.honestyNotes,
  }

  if (prior.catalog && retrievalPlan.catalogOnly) {
    const usable = prior.catalog.usable.map(item => `${item.catalogName} [${item.implementationState}]`).join('; ') || 'none'
    const blocked = prior.catalog.blockedOrStubOrMissing.map(item => `${item.catalogName} [${item.implementationState}]`).join('; ') || 'none'
    packet = {
      ...packet,
      findings: [
        packet.findings,
        'SOURCE CATALOG (Kimi Wave, not live proof):',
        `usable implemented now: ${usable}`,
        `blocked/stub/missing: ${blocked}`,
        'A catalogued Kimi source is not usable merely because Kimi listed it.',
      ].filter(Boolean).join('\n'),
      usedLiveResearch: packet.usedLiveResearch,
    }
  }

  let persistence: StoredResearchWriteResult = { ok: false, backend: 'none', error: 'not attempted' }
  const hasStructuredEvidence = Boolean(packet.intelligencePacket?.evidence.some(item =>
    item.origin_type === 'LIVE_WEB' || item.origin_type === 'KIMI_WAVE' || item.origin_type === 'STORED_RESEARCH',
  ))
  if (hasStructuredEvidence) {
    persistence = await persistStoredResearchPacket(
      toStoredPacket({
        decree: args.decreeText,
        packet,
        comparison,
        conversationId: args.conversationId,
        logicalRequestId: args.logicalRequestId,
        roundRequestId: args.roundRequestId,
      }),
      args.supabase,
    )
    if (!persistence.ok) {
      packet = {
        ...packet,
        unresolvedQuestions: [
          ...packet.unresolvedQuestions,
          `Research persistence failed this round (${persistence.error ?? 'unknown error'}). Live/prior evidence was still used.`,
        ],
      }
    }
  }

  return { packet, prior, comparison, retrievalPlan, persistence }
}

export function priorAwareClientCounts(turn: PriorAwareResearchTurn): {
  priorResearchCount: number
  liveSourceCount: number
  changedClaimsCount: number
  staleClaimsCount: number
  contradictionCount: number
} {
  const evidence = turn.packet.intelligencePacket?.evidence ?? []
  return {
    priorResearchCount: evidence.filter(item => item.origin_type === 'KIMI_WAVE' || item.origin_type === 'STORED_RESEARCH').length,
    liveSourceCount: evidence.filter(item => item.origin_type === 'LIVE_WEB').length,
    changedClaimsCount: turn.comparison.updatedCount + turn.comparison.contradictedCount + turn.comparison.newInformation.length,
    staleClaimsCount: turn.comparison.staleCount,
    contradictionCount: turn.comparison.contradictedCount,
  }
}
