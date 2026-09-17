import { TERRA_PUBLIC_USER_AGENT } from '@/lib/terra/terraPublicIdentity'
import { haversineMeters } from './geometry'
import {
  type StreetViewItem,
  type StreetViewLookupQuery,
  type StreetViewProviderAttempt,
  type StreetViewState,
} from './types'

export const MAPILLARY_STREET_LICENSE = 'CC-BY-SA-4.0 (Mapillary contributor terms apply)'
export const MAPILLARY_ATTRIBUTION = 'Mapillary contributors (CC BY-SA)'

type MapillaryImage = {
  id?: unknown
  captured_at?: unknown
  compass_angle?: unknown
  thumb_1024_url?: unknown
  computed_geometry?: { type?: string; coordinates?: unknown }
  sequence?: unknown
}

function mapillaryToken(): string | null {
  return process.env.MAPILLARY_ACCESS_TOKEN?.trim()
    || process.env.NEXT_PUBLIC_MAPILLARY_ACCESS_TOKEN?.trim()
    || null
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function capturedAtIso(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000
    return new Date(ms).toISOString()
  }
  return asString(value)
}

export function mapillaryTokenConfigured(): boolean {
  return Boolean(mapillaryToken())
}

export async function lookupMapillaryCoverage(
  query: StreetViewLookupQuery,
  limit: number,
): Promise<{ attempt: StreetViewProviderAttempt; items: StreetViewItem[] }> {
  const token = mapillaryToken()
  if (!token) {
    return {
      attempt: {
        provider: 'MAPILLARY',
        state: 'PROVIDER_AUTH_REQUIRED',
        authModel: 'MAPILLARY_OAUTH_CLIENT_TOKEN',
        itemCount: 0,
        honesty: 'Mapillary hosted imagery is PROVIDER_AUTH_REQUIRED until MAPILLARY_ACCESS_TOKEN or NEXT_PUBLIC_MAPILLARY_ACCESS_TOKEN is set. Token is never shown. No Google Street View.',
      },
      items: [],
    }
  }
  const url = new URL('https://graph.mapillary.com/images')
  url.searchParams.set('fields', 'id,computed_geometry,captured_at,compass_angle,thumb_1024_url,sequence')
  url.searchParams.set('closeto', `${query.longitude},${query.latitude}`)
  url.searchParams.set('radius', String(Math.round(query.radiusMeters)))
  url.searchParams.set('limit', String(limit))
  let response: Response
  try {
    response = await fetch(url, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        Authorization: `OAuth ${token}`,
        'User-Agent': TERRA_PUBLIC_USER_AGENT,
      },
      signal: AbortSignal.timeout(8_000),
    })
  } catch {
    return {
      attempt: {
        provider: 'MAPILLARY',
        state: 'ERROR_UPSTREAM',
        authModel: 'MAPILLARY_OAUTH_CLIENT_TOKEN',
        itemCount: 0,
        honesty: 'Mapillary Graph request failed. No panorama was fabricated.',
      },
      items: [],
    }
  }
  if (response.status === 401 || response.status === 403) {
    return {
      attempt: {
        provider: 'MAPILLARY',
        state: 'PROVIDER_AUTH_REQUIRED',
        authModel: 'MAPILLARY_OAUTH_CLIENT_TOKEN',
        itemCount: 0,
        honesty: 'Mapillary rejected the configured client token. PROVIDER_AUTH_REQUIRED — not NO_COVERAGE and not Google.',
      },
      items: [],
    }
  }
  if (!response.ok) {
    return {
      attempt: {
        provider: 'MAPILLARY',
        state: 'ERROR_UPSTREAM',
        authModel: 'MAPILLARY_OAUTH_CLIENT_TOKEN',
        itemCount: 0,
        honesty: `Mapillary Graph returned HTTP ${response.status}. No panorama was fabricated.`,
      },
      items: [],
    }
  }
  const body = await response.json().catch(() => null) as { data?: unknown } | null
  const rows = Array.isArray(body?.data) ? body.data : []
  const items: StreetViewItem[] = []
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue
    const image = raw as MapillaryImage
    const id = asString(image.id)
    if (!id) continue
    const coords = image.computed_geometry?.coordinates
    if (!Array.isArray(coords) || coords.length < 2) continue
    const longitude = asFiniteNumber(coords[0])
    const latitude = asFiniteNumber(coords[1])
    if (latitude == null || longitude == null) continue
    const point = { latitude, longitude }
    const distanceMeters = haversineMeters(query, point)
    if (distanceMeters > query.radiusMeters + 5) continue
    const thumbUrl = asString(image.thumb_1024_url)
    const viewerUrl = `https://www.mapillary.com/app/?pKey=${encodeURIComponent(id)}`
    items.push({
      id: `mapillary:${id}`,
      provider: 'MAPILLARY',
      latitude,
      longitude,
      headingDeg: asFiniteNumber(image.compass_angle),
      capturedAt: capturedAtIso(image.captured_at),
      distanceMeters,
      imageUrl: thumbUrl,
      thumbUrl,
      viewerUrl,
      sourceUrl: viewerUrl,
      license: MAPILLARY_STREET_LICENSE,
      attribution: MAPILLARY_ATTRIBUTION,
      sequenceId: asString(image.sequence),
      hasPrevious: false,
      hasNext: false,
      canTurn: asFiniteNumber(image.compass_angle) != null,
      authModel: 'MAPILLARY_OAUTH_CLIENT_TOKEN',
    })
  }
  const state: StreetViewState = items.length > 0 ? 'AVAILABLE' : 'NO_COVERAGE'
  return {
    attempt: {
      provider: 'MAPILLARY',
      state,
      authModel: 'MAPILLARY_OAUTH_CLIENT_TOKEN',
      itemCount: items.length,
      honesty: items.length > 0
        ? 'Mapillary Graph returned lawful hosted street imagery near the selected coordinates. STREAM/API terms apply.'
        : 'Mapillary has no coverage at this coordinate. This is NO_COVERAGE, not a fake panorama.',
    },
    items,
  }
}
