/**
 * Shared OHGO Public API helpers. Auth is server-side OHGO_API_KEY only — never logged.
 * Official docs: Authorization: APIKEY {key}. Commander live-check also accepted ApiKey.
 */
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import type { ResearchProviderId } from '@/lib/research-engine/core/types'

export const OHGO_API_BASE = 'https://publicapi.ohgo.com/api/v1'

export function ohgoApiKey(env: NodeJS.Dict<string> = process.env): string {
  return env.OHGO_API_KEY?.trim() ?? ''
}

export function ohgoAuthHeaders(key: string, etag?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `ApiKey ${key}`,
    Accept: 'application/json',
  }
  if (etag) headers['If-None-Match'] = etag
  return headers
}

export function ohgoMapBoundsParams(bbox: { lamin: number; lomin: number; lamax: number; lomax: number }): string {
  const params = new URLSearchParams()
  params.set('map-bounds-sw', `${bbox.lamin},${bbox.lomin}`)
  params.set('map-bounds-ne', `${bbox.lamax},${bbox.lomax}`)
  params.set('page-all', 'true')
  return params.toString()
}

export function parseOhgoList<T>(payload: unknown): T[] | null {
  if (Array.isArray(payload)) return payload as T[]
  if (!payload || typeof payload !== 'object') return null
  const envelope = payload as { results?: T[]; Results?: T[]; data?: T[] }
  const results = envelope.results ?? envelope.Results ?? envelope.data
  return Array.isArray(results) ? results : null
}

export function ohgoLatLon(row: { Latitude?: number; latitude?: number; Longitude?: number; longitude?: number }): { lat: number; lon: number } | null {
  const lat = row.Latitude ?? row.latitude
  const lon = row.Longitude ?? row.longitude
  if (typeof lat !== 'number' || typeof lon !== 'number') return null
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null
  return { lat, lon }
}

export async function ohgoGetJson(provider: ResearchProviderId, path: string, key: string, bbox: { lamin: number; lomin: number; lamax: number; lomax: number }) {
  const url = `${OHGO_API_BASE}/${path}?${ohgoMapBoundsParams(bbox)}`
  return safeProviderFetch(provider, url, { timeoutMs: 20_000, headers: ohgoAuthHeaders(key) })
}

export function ohgoParseId(row: { Id?: string | number; id?: string | number }): string | null {
  const raw = row.Id ?? row.id
  if (raw === undefined || raw === null) return null
  const id = String(raw).trim()
  return id.length > 0 ? id : null
}
