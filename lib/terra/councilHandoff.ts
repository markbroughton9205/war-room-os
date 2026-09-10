/**
 * Roadmap #13 — Terra ↔ Council intelligence bridge.
 *
 * Does not create a second Terra, a second Council, or a second evidence model.
 * A Commander-selected live geo object becomes structured TERRA-origin evidence on the
 * existing Live Research / Council pipeline, the same way War Room Search handoff does.
 *
 * LIVE is never inferred from registered-but-not-implemented AIS providers.
 */
import { buildTerraEvidenceItem } from '@/lib/intelligence/evidenceOrigin'
import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'
import { hydrateLiveIntelligencePacket } from '@/lib/intelligence/sources/livePacketHydrator'
import { buildRetrievalOrchestration } from '@/lib/intelligence/sources/retrievalOrchestrator'
import {
  emptyLiveResearchEvidencePacket,
  type LiveResearchEvidencePacket,
} from '@/lib/runtime/liveResearchEvidencePacket'
import type { EvidenceFreshness } from '@/lib/intelligence/intelligencePacket'
import {
  isValidLiveCoordinate,
  type TerraLiveFreshness,
  type TerraLiveGeoObject,
  type TerraLiveLayerId,
} from './liveGeoIntelligence'
import type { TerraGeoFeature } from './types'

export const TERRA_HANDOFF_STORAGE_KEY = 'war-room-terra-handoff'
export const TERRA_HANDOFF_ACTION = 'send_selected_object' as const

export type TerraCouncilLineage = {
  objectId: string
  layer: TerraLiveLayerId
  type: string
  title: string
  provider: string
  evidenceId: string | null
  sourceUrl: string | null
  latitude: number
  longitude: number
  coordinateOrigin: string | null
  freshness: TerraLiveFreshness
  observedAt: string | null
  receivedAt: string
  handedOffAt: string
  sourceFamily: string | null
  country: string | null
  region: string | null
  jurisdiction: string | null
  commanderAction: typeof TERRA_HANDOFF_ACTION
}

export type TerraCouncilHandoffPayload = {
  action: typeof TERRA_HANDOFF_ACTION
  commanderPrompt: string
  lineage: TerraCouncilLineage
  observedFacts: string
}

const UNCONFIGURED_AIS_PROVIDERS = new Set([
  'barentswatch_ais',
  'aisstream',
  'aishub_marine',
  'noaa_access_ais',
])

function freshnessToEvidence(freshness: TerraLiveFreshness): EvidenceFreshness {
  if (freshness === 'LIVE') return 'live'
  if (freshness === 'CACHED') return 'recent'
  if (freshness === 'DELAYED') return 'aging'
  if (freshness === 'STALE') return 'stale'
  return 'unknown'
}

export function canSendTerraObjectToCouncil(object: TerraLiveGeoObject | null | undefined): boolean {
  if (!object) return false
  if (!isValidLiveCoordinate(object.latitude, object.longitude)) return false
  if (UNCONFIGURED_AIS_PROVIDERS.has(object.provider)) return false
  if (object.freshness === 'NOT_CONFIGURED') return false
  return true
}

export function resolveTerraCouncilLineage(object: TerraLiveGeoObject): TerraCouncilLineage | null {
  if (!canSendTerraObjectToCouncil(object)) return null
  return {
    objectId: object.id,
    layer: object.layer,
    type: object.type,
    title: object.title,
    provider: object.provider,
    evidenceId: object.evidenceId,
    sourceUrl: object.sourceUrl,
    latitude: object.latitude,
    longitude: object.longitude,
    coordinateOrigin: object.coordinateOrigin,
    freshness: object.freshness,
    observedAt: object.observedAt,
    receivedAt: object.receivedAt,
    handedOffAt: new Date().toISOString(),
    sourceFamily: object.sourceFamily,
    country: object.country,
    region: object.region,
    jurisdiction: object.jurisdiction,
    commanderAction: TERRA_HANDOFF_ACTION,
  }
}

function observedFactsFromFeature(feature: TerraGeoFeature | null | undefined, object: TerraLiveGeoObject): string {
  const lines = [
    `SELECTED: ${object.title}`,
    `TYPE: ${object.type}`,
    `LAYER: ${object.layer}`,
    `PROVIDER: ${object.provider}`,
    `COORDINATES: ${object.latitude.toFixed(5)}, ${object.longitude.toFixed(5)}`,
    `COORDINATE ORIGIN: ${object.coordinateOrigin ?? 'not reported'}`,
    `FRESHNESS: ${object.freshness}`,
    `OBSERVED AT: ${object.observedAt ?? 'not reported'}`,
    `RECEIVED AT: ${object.receivedAt}`,
    `EVIDENCE ID: ${object.evidenceId ?? 'none'}`,
    `SOURCE URL: ${object.sourceUrl ?? 'none'}`,
  ]
  if (object.sourceFamily) lines.push(`SOURCE FAMILY: ${object.sourceFamily}`)
  if (object.country) lines.push(`COUNTRY: ${object.country}`)
  if (object.region) lines.push(`REGION: ${object.region}`)
  if (feature?.kind === 'vessel_position') {
    const properties = feature.properties
    if (typeof properties.mmsi === 'string') lines.push(`MMSI: ${properties.mmsi}`)
    if (typeof properties.imo === 'string') lines.push(`IMO: ${properties.imo}`)
    if (typeof properties.shipTypeLabel === 'string') lines.push(`TYPE LABEL: ${properties.shipTypeLabel}`)
    if (typeof properties.speedKnots === 'number') lines.push(`SPEED: ${properties.speedKnots.toFixed(1)} kn`)
    if (typeof properties.courseDeg === 'number') lines.push(`COURSE: ${Math.round(properties.courseDeg)}°`)
    if (typeof properties.headingDeg === 'number') lines.push(`HEADING: ${Math.round(properties.headingDeg)}°`)
    if (typeof properties.navStatLabel === 'string') lines.push(`NAV STATUS: ${properties.navStatLabel}`)
    if (typeof properties.destination === 'string') lines.push(`DESTINATION: ${properties.destination}`)
  }
  return lines.join('\n')
}

export function buildTerraCouncilHandoffPayload(args: {
  object: TerraLiveGeoObject
  feature?: TerraGeoFeature | null
  commanderPrompt?: string
}): TerraCouncilHandoffPayload | null {
  const lineage = resolveTerraCouncilLineage(args.object)
  if (!lineage) return null
  const observedFacts = observedFactsFromFeature(args.feature, args.object)
  const commanderPrompt = args.commanderPrompt?.trim()
    || `Analyze this Terra-selected ${args.object.type}: ${args.object.title}. Preserve Terra lineage and provenance. Do not invent coordinates, identity, or unobserved facts.`
  return {
    action: TERRA_HANDOFF_ACTION,
    commanderPrompt,
    lineage,
    observedFacts,
  }
}

export function evidenceFromTerraHandoff(payload: TerraCouncilHandoffPayload): IntelligenceEvidenceItem | null {
  const lineage = payload.lineage
  if (!lineage || payload.action !== TERRA_HANDOFF_ACTION) return null
  if (!isValidLiveCoordinate(lineage.latitude, lineage.longitude)) return null
  if (UNCONFIGURED_AIS_PROVIDERS.has(lineage.provider)) return null
  const content = [
    payload.observedFacts,
    'TERRA LINEAGE',
    `objectId=${lineage.objectId}`,
    `layer=${lineage.layer}`,
    `provider=${lineage.provider}`,
    `evidenceId=${lineage.evidenceId ?? 'none'}`,
    `freshness=${lineage.freshness}`,
    `handedOffAt=${lineage.handedOffAt}`,
    `commanderAction=${lineage.commanderAction}`,
    `COMMANDER QUESTION: ${payload.commanderPrompt}`,
  ].join('\n')
  return buildTerraEvidenceItem({
    id: lineage.evidenceId ?? `terra-${lineage.objectId}`,
    source_id: lineage.provider,
    source_label: `Terra · ${lineage.provider}`,
    title: lineage.title,
    url: lineage.sourceUrl ?? undefined,
    terraContextText: content,
    observedAt: lineage.observedAt ?? lineage.receivedAt,
    source_family: lineage.sourceFamily,
    region: lineage.region,
    country: lineage.country,
    jurisdiction: lineage.jurisdiction,
    canonical_url: lineage.sourceUrl,
    freshness: freshnessToEvidence(lineage.freshness),
  })
}

/**
 * Convert a Commander-selected Terra object into the existing live-research evidence packet
 * so Council consumes structured TERRA-origin evidence rather than a concatenated globe dump.
 */
export function buildTerraHandoffEvidencePacket(payload: TerraCouncilHandoffPayload): LiveResearchEvidencePacket {
  const generatedAt = new Date().toISOString()
  if (payload.action !== TERRA_HANDOFF_ACTION) {
    return emptyLiveResearchEvidencePacket(generatedAt, 'Terra handoff missing explicit Commander action.')
  }
  const evidence = evidenceFromTerraHandoff(payload)
  if (!evidence) {
    return emptyLiveResearchEvidencePacket(generatedAt, 'Terra handoff had no projectable selected object.')
  }
  const retrieval = buildRetrievalOrchestration({
    decree: payload.commanderPrompt,
    generatedAt,
    tavilyOk: false,
    grokOk: false,
    directOk: true,
  })
  const intelligencePacket = hydrateLiveIntelligencePacket({
    decree: payload.commanderPrompt,
    timestamp: generatedAt,
    rawSources: [],
    extraEvidence: [evidence],
    unsupportedClaims: [],
    retrieval,
  })
  intelligencePacket.evidence = [evidence]
  intelligencePacket.sources_used = [evidence.source_id]
  const lineage = payload.lineage
  return {
    usedLiveResearch: true,
    generatedAt,
    sources: [{
      kind: 'direct_fetch',
      ok: true,
      queriedAt: generatedAt,
      urls: lineage.sourceUrl ? [lineage.sourceUrl] : [],
      note: 'terra_selected_object_handoff',
    }],
    findings: [
      `Terra lineage retained for Council session.`,
      `objectId=${lineage.objectId}`,
      `provider=${lineage.provider}`,
      `evidenceId=${lineage.evidenceId ?? 'none'}`,
      `freshness=${lineage.freshness}`,
      `coordinates=${lineage.latitude.toFixed(5)},${lineage.longitude.toFixed(5)}`,
      `handedOffAt=${lineage.handedOffAt}`,
      `commanderQuestion=${payload.commanderPrompt}`,
    ].join('\n'),
    confidence: lineage.freshness === 'LIVE' || lineage.freshness === 'CACHED' ? 0.82 : 0.55,
    freshness: lineage.freshness === 'STALE' ? 'stale' : lineage.freshness === 'LIVE' || lineage.freshness === 'CACHED' ? 'recent' : 'unknown',
    contradictions: [],
    unresolvedQuestions: [],
    intelligencePacket,
    honestyNotes: [
      'Evidence originated from a Commander-selected Terra object, not a new parallel Council or globe.',
      'origin_type is TERRA. Registered-but-not-implemented AIS providers are never reported live.',
      'Preserve objectId, provider, evidenceId, coordinates, freshness, and source URL as session lineage.',
      'Do not invent vessel identity, coordinates, or unobserved facts.',
    ],
  }
}

export function isTerraHandoffBody(value: unknown): value is TerraCouncilHandoffPayload {
  if (!value || typeof value !== 'object') return false
  const rec = value as Record<string, unknown>
  if (rec.action !== TERRA_HANDOFF_ACTION) return false
  if (typeof rec.commanderPrompt !== 'string' || typeof rec.observedFacts !== 'string') return false
  const lineage = rec.lineage
  if (!lineage || typeof lineage !== 'object') return false
  const row = lineage as Record<string, unknown>
  return typeof row.objectId === 'string'
    && typeof row.provider === 'string'
    && typeof row.latitude === 'number'
    && typeof row.longitude === 'number'
}

