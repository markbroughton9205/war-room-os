import type { TerraGeoFeature } from '@/lib/terra/types'
import type { TerraLiveIntelItem } from '@/lib/terra/liveIntelPanelModel'
import { bboxFromRings, resolveGeometryBasis } from './geometry'
import { resolveWeatherLifecycle } from './lifecycle'
import { NWS_WEATHER_PROVIDER, type WeatherAlert } from './types'

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(item => asString(item)).filter((item): item is string => Boolean(item))
  }
  const raw = asString(value)
  if (!raw) return []
  return raw.split(/\s*\|\s*/).map(item => item.trim()).filter(Boolean)
}

function propertyMap(feature: TerraGeoFeature | null): Record<string, unknown> {
  if (!feature) return {}
  const properties = feature.properties ?? {}
  const nested = properties.geoFeatureProperties
  return nested && typeof nested === 'object' ? { ...nested as Record<string, unknown>, ...properties } : properties
}

export function weatherAlertFromFeature(feature: TerraGeoFeature, nowIso: string): WeatherAlert | null {
  if (feature.kind !== 'severe_weather_alert') return null
  const props = propertyMap(feature)
  const rings = feature.geometryKind === 'region' && feature.regionRings?.length ? feature.regionRings : null
  const bbox = bboxFromRings(rings)
  const areaDesc = asString(props.areaDesc) ?? asString(feature.summary)
  const affectedZones = asStringList(props.affectedZones)
  const representativePoint = Number.isFinite(feature.latitude) && Number.isFinite(feature.longitude)
    ? { latitude: feature.latitude, longitude: feature.longitude }
    : null
  const geometryBasis = resolveGeometryBasis({
    rings,
    bbox,
    areaDesc,
    affectedZones,
    representativePoint,
    pointIsVertexAverage: Boolean(rings),
  })
  const status = asString(props.status)
  const messageType = asString(props.messageType)
  const effective = asString(props.effective)
  const onset = asString(props.onset)
  const ends = asString(props.ends)
  const expires = asString(props.expires)
  return {
    id: feature.id,
    event: asString(props.event),
    headline: asString(props.headline) ?? feature.summary,
    severity: asString(props.severity),
    urgency: asString(props.urgency),
    certainty: asString(props.certainty),
    status,
    messageType,
    sent: asString(props.sent) ?? asString(feature.timestamp),
    effective,
    onset,
    ends,
    expires,
    updated: asString(props.updated) ?? asString(props.sent),
    areaDesc,
    instruction: asString(props.instruction),
    description: asString(props.description) ?? feature.summary,
    sourceUrl: feature.provenance.sourceUrl ?? feature.rawReference.canonicalUrl,
    provider: NWS_WEATHER_PROVIDER,
    affectedZones,
    rings,
    bbox,
    representativePoint,
    geometryBasis,
    lifecycle: resolveWeatherLifecycle({ status, messageType, effective, onset, ends, expires, nowIso }),
    retrievedAt: feature.provenance.retrievedAt,
    liveIntelId: feature.id,
  }
}

export function mergeWeatherAlerts(input: {
  features: TerraGeoFeature[]
  intelItems?: TerraLiveIntelItem[]
  nowIso: string
}): WeatherAlert[] {
  const byId = new Map<string, WeatherAlert>()
  for (const feature of input.features) {
    const alert = weatherAlertFromFeature(feature, input.nowIso)
    if (alert) byId.set(alert.id, alert)
  }
  for (const item of input.intelItems ?? []) {
    if (item.eventType !== 'severe_weather_alert') continue
    if (byId.has(item.id)) continue
    // Live Intel item without a matching Terra feature has no polygon to project.
    // Keep it as ZONE/UNKNOWN truth for drawer consistency; do not invent coordinates.
    const areaDesc = item.location
    byId.set(item.id, {
      id: item.id,
      event: item.eventType,
      headline: item.headline,
      severity: typeof item.severity === 'string' ? item.severity : item.severity != null ? String(item.severity) : null,
      urgency: null,
      certainty: null,
      status: null,
      messageType: null,
      sent: item.timestamp,
      effective: item.timestamp,
      onset: null,
      ends: null,
      expires: null,
      updated: item.timestamp,
      areaDesc,
      instruction: null,
      description: item.summary,
      sourceUrl: item.sourceUrl,
      provider: NWS_WEATHER_PROVIDER,
      affectedZones: [],
      rings: null,
      bbox: null,
      representativePoint: item.lat != null && item.lon != null ? { latitude: item.lat, longitude: item.lon } : null,
      geometryBasis: areaDesc ? 'ZONE' : item.lat != null ? 'UNKNOWN' : 'UNKNOWN',
      lifecycle: resolveWeatherLifecycle({
        status: null,
        messageType: null,
        effective: item.timestamp,
        onset: null,
        ends: null,
        expires: null,
        nowIso: input.nowIso,
      }),
      retrievedAt: item.retrievedAt,
      liveIntelId: item.id,
    })
  }
  return [...byId.values()]
}
