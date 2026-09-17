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
import type { TerraLiveIntelItem } from './liveIntelPanelModel'
import { observedMediaFacts } from './liveIntelMedia'

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
  latitude: number | null
  longitude: number | null
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

const BLOCKED_HANDOFF_FRESHNESS = new Set<TerraLiveFreshness>([
  'NEEDS_CREDENTIALS',
  'NEEDS_LOCAL_SENSOR',
  'NEEDS_COMMERCIAL_ACCOUNT',
  'NOT_IMPLEMENTED',
  'NOT_CONFIGURED',
  'DISABLED',
  'UNAVAILABLE',
  'AUTH_FAILED',
  'AUTH_REQUIRED',
])

function freshnessToEvidence(freshness: TerraLiveFreshness): EvidenceFreshness {
  if (freshness === 'LIVE') return 'live'
  if (freshness === 'CACHED') return 'recent'
  if (freshness === 'DELAYED') return 'aging'
  if (freshness === 'STALE' || freshness === 'STALE_LAST_GOOD' || freshness === 'HISTORICAL') return 'stale'
  return 'unknown'
}

export function canSendTerraIntelItemToCouncil(item: TerraLiveIntelItem | null | undefined): boolean {
  if (!item) return false
  if (!item.sourceUrl && item.relatedEvidenceIds.length === 0) return false
  if (BLOCKED_HANDOFF_FRESHNESS.has(item.freshnessState)) return false
  return true
}

export function canSendTerraObjectToCouncil(object: TerraLiveGeoObject | null | undefined): boolean {
  if (!object) return false
  if (!isValidLiveCoordinate(object.latitude, object.longitude)) return false
  if (BLOCKED_HANDOFF_FRESHNESS.has(object.freshness)) return false
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
  const hasCoords = lineage.latitude !== null && lineage.longitude !== null && isValidLiveCoordinate(lineage.latitude, lineage.longitude)
  if (!hasCoords && !lineage.sourceUrl && !lineage.evidenceId) return null
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
      `coordinates=${lineage.latitude !== null && lineage.longitude !== null ? `${lineage.latitude.toFixed(5)},${lineage.longitude.toFixed(5)}` : 'not reported'}`,
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
      'Keep Observed Data, Council Analysis, and Commander Annotation as separate layers. Council must not silently rewrite Terra truth.',
      'Do not invent vessel identity, coordinates, conflict boundaries, or unobserved facts.',
    ],
  }
}

export function buildTerraCouncilHandoffFromIntelItem(args: {
  item: TerraLiveIntelItem
  commanderPrompt?: string
  terraScope?: string | null
}): TerraCouncilHandoffPayload | null {
  if (!canSendTerraIntelItemToCouncil(args.item)) return null
  const item = args.item
  const observedFacts = [
    'LAYER: Observed Data',
    `SELECTED: ${item.headline}`,
    `CATEGORY: ${item.category}`,
    `EVENT TYPE: ${item.eventType ?? 'not reported'}`,
    `PROVIDER: ${item.provider}`,
    `SOURCE: ${item.source}`,
    `SOURCE URL: ${item.sourceUrl ?? 'none'}`,
    `PUBLISHED: ${item.timestamp ?? 'not reported'}`,
    `EVENT LOCAL TIME: ${item.localTime ?? 'not reported'}`,
    `TIMEZONE: ${item.timezone ?? 'not reported'}`,
    `UTC: ${item.utcTimestamp ?? 'not reported'}`,
    `UTC OFFSET: ${item.utcOffset ?? 'not reported'}`,
    `DAY/NIGHT: ${item.dayNightState ?? 'not reported'}`,
    `ORIGINAL LANGUAGE: ${item.originalLanguage ?? 'unknown'}`,
    `ORIGINAL HEADLINE: ${item.originalHeadline}`,
    item.originalSummary ? `ORIGINAL SUMMARY: ${item.originalSummary}` : null,
    item.englishHeadline && item.englishHeadline !== item.originalHeadline ? `ENGLISH HEADLINE (translation, not verified Terra truth): ${item.englishHeadline}` : null,
    item.englishSummary && item.englishSummary !== item.originalSummary ? `ENGLISH SUMMARY (translation, not verified Terra truth): ${item.englishSummary}` : null,
    `TRANSLATION STATE: ${item.translationState}`,
    item.translation ? `TRANSLATION MODEL: ${item.translation.translationModel} AT ${item.translation.translatedAt}` : null,
    `RETRIEVED: ${item.retrievedAt}`,
    `FRESHNESS: ${item.freshnessState}`,
    `COVERAGE: ${item.coverageState}`,
    `VERIFICATION: ${item.verificationState ?? 'not classified'}`,
    `COORDINATES: ${item.lat !== null && item.lon !== null ? `${item.lat.toFixed(5)}, ${item.lon.toFixed(5)}` : 'not reported'}`,
    `COORDINATE ORIGIN: ${item.coordinateOrigin ?? 'not reported'}`,
    `LOCATION: ${item.location ?? 'not reported'}`,
    item.nativeLocationName ? `NATIVE PLACE NAME: ${item.nativeLocationName}` : null,
    item.englishLocationName ? `ENGLISH PLACE NAME: ${item.englishLocationName}` : null,
    `TERRA SCOPE: ${args.terraScope ?? 'not reported'}`,
    `SOURCE COUNT: ${item.sourceCount}`,
    `SOURCES: ${item.sources.map(source => `${source.name}${source.url ? ` <${source.url}>` : ''}`).join(' | ')}`,
    `EVIDENCE IDS: ${item.relatedEvidenceIds.join(', ') || 'none'}`,
    item.breakingReason ? `BREAKING REASON: ${item.breakingReason}` : null,
    item.summary ? `SUMMARY: ${item.summary}` : null,
    ...observedMediaFacts(item.mediaPreview),
    'Council Analysis is a separate layer. Do not rewrite these observed facts.',
    'Commander Annotation is a separate layer.',
  ].filter(Boolean).join('\n')
  const commanderPrompt = args.commanderPrompt?.trim()
    || `Analyze this Terra Live Intel item using only the supplied observed facts and sources: ${item.headline}. Separate Observed Data from Council Analysis. Do not invent coordinates, conflict boundaries, or unobserved facts.`
  return {
    action: TERRA_HANDOFF_ACTION,
    commanderPrompt,
    lineage: {
      objectId: item.id,
      layer: item.category === 'EARTH' || item.category === 'LOCAL' ? 'intelligence_events' : 'other',
      type: item.eventType ?? item.category.toLowerCase(),
      title: item.headline,
      provider: item.provider,
      evidenceId: item.relatedEvidenceIds[0] ?? item.id,
      sourceUrl: item.sourceUrl,
      latitude: item.lat,
      longitude: item.lon,
      coordinateOrigin: item.coordinateOrigin,
      freshness: item.freshnessState,
      observedAt: item.timestamp,
      receivedAt: item.retrievedAt,
      handedOffAt: new Date().toISOString(),
      sourceFamily: item.source,
      country: null,
      region: item.location,
      jurisdiction: null,
      commanderAction: TERRA_HANDOFF_ACTION,
    },
    observedFacts,
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
    && (typeof row.latitude === 'number' || row.latitude === null)
    && (typeof row.longitude === 'number' || row.longitude === null)
}

