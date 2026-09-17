import { TERRA_PUBLIC_USER_AGENT } from '@/lib/terra/terraPublicIdentity'
import { haversineMeters } from './geometry'
import { hostnameOf, isAllowedStreetViewHost, isGoogleStreetViewHost } from './hosts'
import {
  STREET_VIEW_PUBLIC_PANORAMAX_BASE,
  type StreetViewItem,
  type StreetViewLookupQuery,
  type StreetViewProviderAttempt,
  type StreetViewState,
} from './types'

export const PANORAMAX_STREET_LICENSE = 'Contributor license (often CC BY-SA) · Panoramax instance terms'
export const PANORAMAX_ATTRIBUTION = 'Panoramax contributors'

type GeoJsonPoint = { type?: string; coordinates?: unknown }
type PanoramaxFeature = {
  id?: unknown
  collection?: unknown
  geometry?: GeoJsonPoint
  properties?: Record<string, unknown>
  assets?: Record<string, { href?: unknown } | undefined>
}

function panoramaxBaseUrl(): string {
  const configured = process.env.PANORAMAX_INSTANCE_URL?.trim() || process.env.NEXT_PUBLIC_PANORAMAX_INSTANCE_URL?.trim()
  return (configured || STREET_VIEW_PUBLIC_PANORAMAX_BASE).replace(/\/+$/, '')
}

function bboxFromQuery(query: StreetViewLookupQuery): string {
  const latDelta = query.radiusMeters / 111_320
  const lonDelta = query.radiusMeters / (111_320 * Math.max(0.2, Math.cos((query.latitude * Math.PI) / 180)))
  const west = query.longitude - lonDelta
  const south = query.latitude - latDelta
  const east = query.longitude + lonDelta
  const north = query.latitude + latDelta
  return `${west.toFixed(6)},${south.toFixed(6)},${east.toFixed(6)},${north.toFixed(6)}`
}

function panoramaxSearchUrl(base: string, query: StreetViewLookupQuery, limit: number): string {
  const path = base.endsWith('/api') ? `${base}/search` : `${base}/api/search`
  const url = new URL(path)
  url.searchParams.set('bbox', bboxFromQuery(query))
  url.searchParams.set('limit', String(limit))
  return url.toString()
}

function panoramaxWebBase(apiBase: string): string {
  if (apiBase.includes('api.panoramax.xyz')) return 'https://panoramax.xyz'
  if (apiBase.includes('api.panoramax.fr')) return 'https://panoramax.fr'
  return apiBase.replace(/\/api$/, '')
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function pointFromFeature(feature: PanoramaxFeature): { latitude: number; longitude: number } | null {
  const coords = feature.geometry?.coordinates
  if (!Array.isArray(coords) || coords.length < 2) return null
  const longitude = asFiniteNumber(coords[0])
  const latitude = asFiniteNumber(coords[1])
  if (latitude == null || longitude == null) return null
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null
  return { latitude, longitude }
}

function assetHref(feature: PanoramaxFeature, key: string): string | null {
  const fromAssets = asString(feature.assets?.[key]?.href)
  if (fromAssets) return fromAssets
  const nested = feature.properties?.assets
  if (nested && typeof nested === 'object') {
    const record = nested as Record<string, { href?: unknown } | undefined>
    return asString(record[key]?.href)
  }
  return null
}

function headingFrom(properties: Record<string, unknown> | undefined): number | null {
  if (!properties) return null
  return asFiniteNumber(properties.heading)
    ?? asFiniteNumber(properties['view:azimuth'])
    ?? asFiniteNumber(properties.compass_angle)
}

export async function lookupPanoramaxCoverage(
  query: StreetViewLookupQuery,
  limit: number,
): Promise<{ attempt: StreetViewProviderAttempt; items: StreetViewItem[] }> {
  const base = panoramaxBaseUrl()
  const extraHost = hostnameOf(base)
  if (!extraHost || isGoogleStreetViewHost(extraHost) || !isAllowedStreetViewHost(extraHost, extraHost ? [extraHost] : [])) {
    return {
      attempt: {
        provider: 'PANORAMAX',
        state: 'UNAVAILABLE',
        authModel: 'PANORAMAX_INSTANCE',
        itemCount: 0,
        honesty: 'Panoramax instance host is not an allowed public street-imagery origin.',
      },
      items: [],
    }
  }
  let response: Response
  try {
    response = await fetch(panoramaxSearchUrl(base, query, limit), {
      cache: 'no-store',
      headers: { Accept: 'application/json', 'User-Agent': TERRA_PUBLIC_USER_AGENT },
      signal: AbortSignal.timeout(8_000),
    })
  } catch {
    return {
      attempt: {
        provider: 'PANORAMAX',
        state: 'ERROR_UPSTREAM',
        authModel: extraHost === 'api.panoramax.xyz' ? 'PANORAMAX_PUBLIC' : 'PANORAMAX_INSTANCE',
        itemCount: 0,
        honesty: 'Panoramax search failed to reach the instance. No panorama was fabricated.',
      },
      items: [],
    }
  }
  if (response.status === 401 || response.status === 403) {
    return {
      attempt: {
        provider: 'PANORAMAX',
        state: 'PROVIDER_AUTH_REQUIRED',
        authModel: 'PANORAMAX_INSTANCE',
        itemCount: 0,
        honesty: 'Panoramax instance requires provider authentication. Terra will not scrape an alternative.',
      },
      items: [],
    }
  }
  if (!response.ok) {
    return {
      attempt: {
        provider: 'PANORAMAX',
        state: 'ERROR_UPSTREAM',
        authModel: extraHost === 'api.panoramax.xyz' ? 'PANORAMAX_PUBLIC' : 'PANORAMAX_INSTANCE',
        itemCount: 0,
        honesty: `Panoramax search returned HTTP ${response.status}. No panorama was fabricated.`,
      },
      items: [],
    }
  }
  const body = await response.json().catch(() => null) as { features?: unknown } | null
  const features = Array.isArray(body?.features) ? body.features : []
  const items: StreetViewItem[] = []
  for (const raw of features) {
    if (!raw || typeof raw !== 'object') continue
    const feature = raw as PanoramaxFeature
    const point = pointFromFeature(feature)
    if (!point) continue
    const properties = feature.properties ?? {}
    const id = asString(feature.id) ?? asString(properties.id)
    if (!id) continue
    const distanceMeters = haversineMeters(query, point)
    if (distanceMeters > query.radiusMeters) continue
    const thumbUrl = assetHref(feature, 'thumb') ?? assetHref(feature, 'sd')
    const imageUrl = assetHref(feature, 'sd') ?? assetHref(feature, 'hd') ?? thumbUrl
    const web = panoramaxWebBase(base)
    const viewerUrl = `${web.replace(/\/+$/, '')}/#pic=${encodeURIComponent(id)}`
    items.push({
      id: `panoramax:${id}`,
      provider: 'PANORAMAX',
      latitude: point.latitude,
      longitude: point.longitude,
      headingDeg: headingFrom(properties),
      capturedAt: asString(properties.datetime) ?? asString(properties.created),
      distanceMeters,
      imageUrl,
      thumbUrl,
      viewerUrl,
      sourceUrl: viewerUrl,
      license: asString(properties.license) ?? PANORAMAX_STREET_LICENSE,
      attribution: PANORAMAX_ATTRIBUTION,
      sequenceId: asString(properties.sequence) ?? asString(feature.collection),
      hasPrevious: false,
      hasNext: false,
      canTurn: headingFrom(properties) != null,
      authModel: extraHost === 'api.panoramax.xyz' ? 'PANORAMAX_PUBLIC' : 'PANORAMAX_INSTANCE',
    })
  }
  const state: StreetViewState = items.length > 0 ? 'AVAILABLE' : 'NO_COVERAGE'
  return {
    attempt: {
      provider: 'PANORAMAX',
      state,
      authModel: extraHost === 'api.panoramax.xyz' ? 'PANORAMAX_PUBLIC' : 'PANORAMAX_INSTANCE',
      itemCount: items.length,
      honesty: items.length > 0
        ? 'Panoramax returned lawful public street-level imagery near the selected coordinates.'
        : 'Panoramax has no public coverage at this coordinate. This is NO_COVERAGE, not a fake panorama.',
    },
    items,
  }
}
