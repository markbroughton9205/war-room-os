/**
 * Federate existing public news infrastructure for the active Terra place.
 * Not a second news engine. Never sends raw GPS coordinates as the search query.
 */
import type { GeographicRegion } from '@/lib/council/scout-swarm/types'
import { parsePublicNewsRss, type PublicNewsItem } from '@/lib/research/publicRssFeeds'
import { googleNewsLocaleForRegion } from '@/lib/research/sourceTerritories'
import { geographicCellKey, type TerraGeographicContext } from './geographicContext'
import { localNewsSearchQuery } from './localIntelRelevance'
import type { GodsEyeZoomRung } from './godsEye/zoomLadder'

const RSS_TIMEOUT_MS = 8_000

export function regionFromCountryCode(code: string | null | undefined): GeographicRegion | undefined {
  const c = code?.trim().toUpperCase()
  if (!c) return undefined
  if (c === 'US' || c === 'CA') return 'NORTH_AMERICA'
  if (c === 'MX' || c === 'BR' || c === 'AR' || c === 'CL' || c === 'CO' || c === 'PE') return 'LATIN_AMERICA'
  if (c === 'GB' || c === 'UK' || c === 'DE' || c === 'FR' || c === 'IT' || c === 'ES' || c === 'NL' || c === 'IE' || c === 'SE' || c === 'NO' || c === 'PL') return 'EUROPE'
  if (c === 'ZA' || c === 'NG' || c === 'KE' || c === 'EG' || c === 'GH') return 'AFRICA'
  if (c === 'AE' || c === 'SA' || c === 'IL' || c === 'QA' || c === 'TR') return 'MIDDLE_EAST'
  if (c === 'JP' || c === 'CN' || c === 'KR' || c === 'TW' || c === 'HK') return 'EAST_ASIA'
  if (c === 'IN' || c === 'PK' || c === 'BD' || c === 'LK') return 'SOUTH_ASIA'
  if (c === 'AU' || c === 'NZ') return 'OCEANIA'
  return undefined
}

export function localNewsCacheKey(input: {
  query: string
  countryCode?: string | null
  lat?: number | null
  lon?: number | null
  zoom?: string | null
}): string {
  const zoom = (input.zoom as GodsEyeZoomRung | undefined) ?? 'CITY'
  const cell = typeof input.lat === 'number' && typeof input.lon === 'number'
    ? geographicCellKey(input.lat, input.lon, zoom)
    : 'no-cell'
  return `terra-live-intel:local-news:${cell}:${input.countryCode ?? 'xx'}:${input.query.toLowerCase()}`
}

export function localNewsQueryFromContext(context: Pick<TerraGeographicContext, 'city' | 'county' | 'state' | 'country' | 'placeName' | 'zoomLevel'>): string | null {
  return localNewsSearchQuery(context)
}

export async function fetchLocalGoogleNews(input: {
  query: string
  countryCode?: string | null
}): Promise<{ ok: boolean; items: PublicNewsItem[]; error?: string; durationMs: number }> {
  const started = Date.now()
  const region = regionFromCountryCode(input.countryCode)
  const locale = googleNewsLocaleForRegion(region)
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(input.query)}&hl=${locale.hl}&gl=${locale.gl}&ceid=${locale.ceid}`
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(RSS_TIMEOUT_MS),
      headers: { 'user-agent': 'WarRoomLiveResearch/1.0', accept: 'application/rss+xml,application/xml,text/xml' },
    })
    if (!res.ok) {
      return { ok: false, items: [], error: `Google News HTTP ${res.status}`, durationMs: Date.now() - started }
    }
    const items = parsePublicNewsRss(await res.text(), `Google News (${locale.gl})`).slice(0, 12)
    return { ok: items.length > 0, items, durationMs: Date.now() - started }
  } catch (error) {
    return {
      ok: false,
      items: [],
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started,
    }
  }
}
