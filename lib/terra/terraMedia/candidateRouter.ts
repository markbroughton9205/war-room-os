import { isPlaybackEligible } from '@/lib/media/provenance'
import { getOhioMediaStations } from '@/lib/media/stationRegistry'
import {
  mediaPreviewIsRenderable,
  resolveMediaPreview,
  TERRA_LIVE_INTEL_MEDIA_NONE,
  type TerraLiveIntelMediaPreview,
} from '@/lib/terra/liveIntelMedia'
import type { TerraLiveIntelItem } from '@/lib/terra/liveIntelPanelModel'
import type { AreaLiveCameraMedia } from '@/lib/terra/godsEye/areaLiveMedia'
import type { WeatherAlert } from '@/lib/terra/weather'
import type { TerraGeoFeature } from '@/lib/terra/types'
import { resolveTerraMediaAssetState, type TerraMediaLiveEvidence } from './broadcastState'
import type { TerraMediaCandidate, TerraMediaEventFamily } from './types'

const NWS_PRIORITY = new Set(['extreme', 'severe'])

export type TerraMediaRouterInput = {
  weatherAlert?: WeatherAlert | null
  intelItem?: TerraLiveIntelItem | null
  feature?: TerraGeoFeature | null
  areaLive?: AreaLiveCameraMedia | null
  intelFeed?: TerraLiveIntelItem[] | null
  nowIso?: string
}

function text(value: string | number | null | undefined): string | null {
  if (value == null) return null
  const next = String(value).trim()
  return next || null
}

function lower(value: string | null | undefined): string {
  return (value ?? '').toLowerCase()
}

export function isTerraMediaNwsPriority(severity: string | null | undefined): boolean {
  return NWS_PRIORITY.has(lower(severity))
}

function familyFromProvider(provider: string | null | undefined, eventType: string | null | undefined): TerraMediaEventFamily | null {
  const p = lower(provider)
  const t = lower(eventType)
  if (p.includes('nws') || t === 'severe_weather_alert' || t === 'tsunami_alert') return 'NWS'
  if (p.includes('gdacs')) return 'GDACS'
  if (p.includes('firms')) return 'FIRMS'
  if (p.includes('usgs') || t === 'earthquake') return 'USGS'
  if (p.includes('eonet') || t === 'wildfire_incident' || t === 'volcano_event' || t === 'flood_event') return 'EONET'
  if (t === 'traffic_camera' || t === 'traffic_event') return 'CAMERA'
  return null
}

function matchListenStation(location: string | null): string | null {
  if (!location) return null
  const hay = location.toLowerCase()
  const stations = getOhioMediaStations().filter(isPlaybackEligible)
  const hit = stations.find(station =>
    hay.includes(station.city.split(',')[0]!.trim().toLowerCase())
    || hay.includes('northeast ohio')
    || hay.includes('cleveland') && station.region.toLowerCase().includes('cleveland')
    || hay.includes('akron') && station.region.toLowerCase().includes('akron'),
  )
  return hit?.id ?? null
}

function previewWatchUrl(preview: TerraLiveIntelMediaPreview | null): string | null {
  if (!preview) return null
  return preview.provenance.mediaSourceUrl
    ?? (preview.youtubeVideoId ? `https://www.youtube.com/watch?v=${preview.youtubeVideoId}` : null)
    ?? preview.previewUrl
    ?? preview.provenance.sourceUrl
    ?? null
}

function intelVerified(item: TerraLiveIntelItem): boolean {
  return item.verificationState === 'CONFIRMED' || item.verificationState === 'REPORTED'
}

function buildCandidate(input: {
  eventId: string
  family: TerraMediaEventFamily
  eventType: string
  eventTitle: string
  severity: string | null
  location: string | null
  source: string
  publisher: string
  timestamp: string | null
  sourceUrl: string | null
  preview: TerraLiveIntelMediaPreview | null
  liveEvidence?: TerraMediaLiveEvidence | null
  cameraKind?: string | null
  captureFreshness?: string | null
  catalogStatus?: string | null
  locationRelevance?: string | null
  provenance: string
  nowIso: string
  forceUnavailableOk?: boolean
}): TerraMediaCandidate | null {
  const preview = input.preview && input.preview.type !== 'NONE' ? input.preview : null
  const renderable = mediaPreviewIsRenderable(preview)
  const asset = resolveTerraMediaAssetState({
    hasMedia: renderable,
    previewType: preview?.type ?? (input.forceUnavailableOk ? 'NONE' : null),
    youtubeVideoId: preview?.youtubeVideoId ?? null,
    publishedAt: input.timestamp,
    retrievedAt: preview?.provenance?.retrievedAt ?? null,
    nowIso: input.nowIso,
    liveEvidence: input.liveEvidence ?? null,
    cameraKind: input.cameraKind ?? null,
    captureFreshness: input.captureFreshness ?? null,
    catalogStatus: input.catalogStatus ?? null,
  })
  if (asset.state === 'LIVE' && !input.liveEvidence && input.cameraKind !== 'CAMERA_STREAM') {
    return null
  }
  const availability = preview?.accessClass === 'PROVIDER_AUTH' || preview?.accessClass === 'COMMANDER_PRIVATE'
    ? 'AUTH_REQUIRED'
    : renderable || Boolean(input.sourceUrl)
      ? (renderable ? 'AVAILABLE' : 'UNAVAILABLE')
      : 'UNAVAILABLE'
  if (!input.forceUnavailableOk && availability === 'UNAVAILABLE' && !renderable && !input.sourceUrl) {
    return null
  }
  return {
    id: `terra-media:${input.family}:${input.eventId}`,
    eventId: input.eventId,
    family: input.family,
    eventType: input.eventType,
    eventTitle: input.eventTitle,
    severity: input.severity,
    location: input.location,
    source: input.source,
    publisher: input.publisher,
    timestamp: input.timestamp,
    mediaState: asset.state,
    mediaStateReason: asset.reason,
    liveEvidence: input.liveEvidence ?? null,
    provenance: input.provenance,
    locationRelevance: input.locationRelevance ?? null,
    availability,
    authRequirement: preview?.accessClass ?? 'PUBLIC',
    sourceUrl: input.sourceUrl,
    watchUrl: previewWatchUrl(preview) ?? input.sourceUrl,
    listenStationId: matchListenStation(input.location),
    mediaPreview: preview,
    queuedAt: input.nowIso,
    autoplay: false,
  }
}

function fromWeatherAlert(alert: WeatherAlert, intelItem: TerraLiveIntelItem | null, nowIso: string): TerraMediaCandidate | null {
  const priority = isTerraMediaNwsPriority(alert.severity)
  const preview = intelItem ? resolveMediaPreview(intelItem.mediaPreview) : TERRA_LIVE_INTEL_MEDIA_NONE
  const renderable = mediaPreviewIsRenderable(preview)
  if (!isTerraMediaNwsPriority(alert.severity) && !renderable) return null
  return buildCandidate({
    eventId: alert.id,
    family: 'NWS',
    eventType: alert.event ?? 'severe_weather_alert',
    eventTitle: alert.headline ?? alert.event ?? 'NWS weather alert',
    severity: alert.severity,
    location: alert.areaDesc,
    source: alert.provider,
    publisher: 'National Weather Service',
    timestamp: alert.sent ?? alert.effective ?? alert.onset,
    sourceUrl: alert.sourceUrl ?? intelItem?.sourceUrl ?? null,
    preview: renderable ? preview : null,
    locationRelevance: alert.areaDesc,
    provenance: `NWS CAP ${alert.id}. Stream invented: no. Live broadcast inferred from feed recency: no.`,
    nowIso,
    forceUnavailableOk: priority,
  })
}

function fromIntelItem(item: TerraLiveIntelItem, nowIso: string): TerraMediaCandidate | null {
  const family = familyFromProvider(item.provider, item.eventType) ?? 'LIVE_INTEL'
  const preview = resolveMediaPreview(item.mediaPreview)
  const renderable = mediaPreviewIsRenderable(preview)
  const official = intelVerified(item) || Boolean(item.sourceUrl)
  if (!official && !renderable) return null
  if (family === 'LIVE_INTEL' && !renderable) return null
  const nwsForce = family === 'NWS' && isTerraMediaNwsPriority(typeof item.severity === 'string' ? item.severity : null)
  return buildCandidate({
    eventId: item.id,
    family,
    eventType: item.eventType ?? item.category,
    eventTitle: item.headline,
    severity: item.severity != null ? String(item.severity) : null,
    location: item.location ?? item.localServiceArea ?? null,
    source: item.provider,
    publisher: item.source,
    timestamp: item.timestamp,
    sourceUrl: item.sourceUrl ?? preview.provenance.mediaSourceUrl ?? null,
    preview: renderable ? preview : null,
    locationRelevance: item.localRelevance ?? item.location,
    provenance: [
      `Live Intel ${item.id}`,
      `provider ${item.provider}`,
      item.verificationState ? `verification ${item.verificationState}` : 'verification not confirmed',
      `retrieved ${item.retrievedAt}`,
    ].join('. '),
    nowIso,
    forceUnavailableOk: nwsForce,
  })
}

function fromFeature(feature: TerraGeoFeature, intelItem: TerraLiveIntelItem | null, nowIso: string): TerraMediaCandidate | null {
  const family = familyFromProvider(feature.providerId, feature.kind)
  if (!family) return null
  if (intelItem) return fromIntelItem(intelItem, nowIso)
  const preview = resolveMediaPreview(null)
  const nwsForce = family === 'NWS' && isTerraMediaNwsPriority(text(feature.properties.severity as string | undefined))
  if (family === 'CAMERA') return null
  return buildCandidate({
    eventId: feature.id,
    family,
    eventType: feature.kind,
    eventTitle: feature.title,
    severity: text(feature.properties.severity as string | number | undefined),
    location: text(feature.properties.areaDesc as string | undefined) ?? feature.summary,
    source: feature.providerId,
    publisher: feature.provenance.provider ?? feature.providerId,
    timestamp: feature.timestamp,
    sourceUrl: feature.provenance.sourceUrl ?? feature.rawReference.canonicalUrl ?? null,
    preview: mediaPreviewIsRenderable(preview) ? preview : null,
    locationRelevance: feature.summary,
    provenance: `Terra feature ${feature.kind} / ${feature.providerId}. No invented stream.`,
    nowIso,
    forceUnavailableOk: nwsForce,
  })
}

function fromAreaLive(media: AreaLiveCameraMedia, nowIso: string): TerraMediaCandidate | null {
  const verified = Boolean(media.verificationState === 'CONFIRMED' || media.verificationState === 'REPORTED' || media.sourceUrl || media.officialViewerUrl || media.youtubeVideoId || media.hlsUrl || media.embedUrl || media.streamHref)
  if (!verified) return null
  if (media.kind === 'UNAVAILABLE' || media.kind === 'POSTER_ONLY') {
    if (!media.sourceUrl && !media.officialViewerUrl) return null
  }
  const liveEvidence: TerraMediaLiveEvidence | null = media.kind === 'CAMERA_STREAM'
    && (lower(media.captureFreshness) === 'live_video' || lower(media.captureFreshness) === 'live')
    ? 'CAMERA_LIVE_VIDEO_STREAM'
    : null
  const preview: TerraLiveIntelMediaPreview | null = media.youtubeVideoId
    ? {
      type: 'YT_MUTE_EMBED',
      youtubeVideoId: media.youtubeVideoId,
      previewUrl: media.embedUrl ?? undefined,
      accessClass: 'PUBLIC',
      provenance: {
        provider: media.provider,
        sourceUrl: media.sourceUrl ?? undefined,
        mediaSourceUrl: `https://www.youtube.com/watch?v=${media.youtubeVideoId}`,
        retrievedAt: media.retrievedAt ?? undefined,
      },
    }
    : media.hlsUrl
      ? {
        type: 'HLS_MUTE',
        previewUrl: media.hlsUrl,
        accessClass: 'PUBLIC',
        provenance: {
          provider: media.provider,
          sourceUrl: media.sourceUrl ?? undefined,
          mediaSourceUrl: media.hlsUrl,
          retrievedAt: media.retrievedAt ?? undefined,
        },
      }
      : media.embedUrl
        ? {
          type: 'OFFICIAL_EMBED',
          previewUrl: media.embedUrl,
          accessClass: 'PUBLIC',
          provenance: {
            provider: media.provider,
            sourceUrl: media.sourceUrl ?? undefined,
            mediaSourceUrl: media.embedUrl,
            retrievedAt: media.retrievedAt ?? undefined,
          },
        }
        : null
  return buildCandidate({
    eventId: media.intelItemId ?? media.cameraId ?? media.name,
    family: 'CAMERA',
    eventType: media.kind,
    eventTitle: media.headline ?? media.name,
    severity: null,
    location: media.location ?? media.road,
    source: media.provider,
    publisher: media.agency,
    timestamp: media.captureTimestamp ?? media.publishedAt ?? media.retrievedAt,
    sourceUrl: media.sourceUrl ?? media.officialViewerUrl,
    preview,
    liveEvidence,
    cameraKind: media.kind,
    captureFreshness: media.captureFreshness,
    catalogStatus: media.catalogStatus,
    locationRelevance: media.location ?? media.road,
    provenance: [
      `Area Live ${media.kind}`,
      `provider ${media.provider}`,
      `catalog ${media.catalogStatus}`,
      `capture ${media.captureFreshness}`,
      'Catalog LIVE is not broadcast LIVE.',
    ].join('. '),
    nowIso,
    forceUnavailableOk: Boolean(media.sourceUrl || media.officialViewerUrl),
  })
}

/**
 * Build a Terra Media emergency-report candidate from a verified Terra event.
 * Returns null when the event is unverified and has no official source/media.
 * Never invents a stream. Never autoplays.
 */
export function resolveTerraMediaCandidate(input: TerraMediaRouterInput): TerraMediaCandidate | null {
  const nowIso = input.nowIso ?? new Date().toISOString()
  if (input.weatherAlert) return fromWeatherAlert(input.weatherAlert, input.intelItem ?? null, nowIso)
  if (input.areaLive) return fromAreaLive(input.areaLive, nowIso)
  if (input.intelItem) return fromIntelItem(input.intelItem, nowIso)
  if (input.feature) return fromFeature(input.feature, input.intelItem ?? null, nowIso)
  if (input.intelFeed?.length) {
    let fallback: ReturnType<typeof fromIntelItem> = null
    for (const item of input.intelFeed) {
      const hit = fromIntelItem(item, nowIso)
      if (!hit) continue
      if (hit.mediaPreview) return hit
      if (!fallback) fallback = hit
    }
    return fallback
  }
  return null
}
