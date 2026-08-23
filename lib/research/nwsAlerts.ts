/**
 * NWS active weather alerts — a separate fetch+parse path from publicRssFeeds.ts because the
 * response is `application/geo+json`, not XML. Live-fetch-tested (HTTP 200, real active alert
 * returned for area=FL) before this was added.
 *
 * `alerts.weather.gov/cap/us.php` is confirmed dead (connection failure) — do not use it.
 */

import type { PublicNewsItem } from './publicRssFeeds'

export const NWS_ALERTS_ENDPOINT = 'https://api.weather.gov/alerts/active'

const FETCH_TIMEOUT_MS = 10_000
const MAX_ALERTS = 20

const US_STATE_ABBREVIATIONS: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID',
  illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD',
  tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
  'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
}

const VALID_ABBREVIATIONS = new Set(Object.values(US_STATE_ABBREVIATIONS))

/** Best-effort extraction of a 2-letter state area code from free text, for `?area=` filtering. */
export function extractUsStateArea(text: string): string | undefined {
  const abbrMatch = /\b([A-Z]{2})\b/.exec(text)
  if (abbrMatch && VALID_ABBREVIATIONS.has(abbrMatch[1]!)) return abbrMatch[1]
  const lower = text.toLowerCase()
  for (const [name, abbr] of Object.entries(US_STATE_ABBREVIATIONS)) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(lower)) return abbr
  }
  return undefined
}

type NwsAlertFeature = {
  id?: string
  properties?: {
    event?: string
    headline?: string
    description?: string
    severity?: string
    areaDesc?: string
    senderName?: string
    sent?: string
  }
}

type NwsAlertsResponse = {
  features?: NwsAlertFeature[]
}

export type NwsAlertsLeg = {
  ok: boolean
  /** false when weather alerts were not applicable to this query and were never fetched. */
  queried: boolean
  results: PublicNewsItem[]
  error?: string
  durationMs: number
}

export async function fetchActiveWeatherAlerts(input: {
  areaState?: string
  timeoutMs?: number
} = {}): Promise<NwsAlertsLeg> {
  const started = Date.now()
  const url = input.areaState
    ? `${NWS_ALERTS_ENDPOINT}?area=${encodeURIComponent(input.areaState)}`
    : NWS_ALERTS_ENDPOINT
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(input.timeoutMs ?? FETCH_TIMEOUT_MS),
      headers: { 'user-agent': 'WarRoomLiveResearch/1.0', accept: 'application/geo+json' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as NwsAlertsResponse
    const retrievedAt = new Date().toISOString()
    const features = Array.isArray(data.features) ? data.features : []
    const results: PublicNewsItem[] = features.slice(0, MAX_ALERTS).flatMap(feature => {
      const p = feature.properties
      const title = p?.headline || p?.event
      if (!p || !title) return []
      const sentTimestamp = p.sent ? Date.parse(p.sent) : NaN
      return [{
        title,
        url: typeof feature.id === 'string' ? feature.id : NWS_ALERTS_ENDPOINT,
        snippet: (p.description ?? '').slice(0, 900),
        ...(Number.isFinite(sentTimestamp) ? { publishedAt: new Date(sentTimestamp).toISOString() } : {}),
        source: p.senderName ? `NWS (${p.senderName})` : 'NWS Alerts',
        retrievedAt,
        sourceType: 'GOVERNMENT_API',
        reliability: 'HIGH',
        isFallback: true,
        categories: ['weather'],
      }]
    })
    return { ok: true, queried: true, results, durationMs: Date.now() - started }
  } catch (error) {
    return {
      ok: false,
      queried: true,
      results: [],
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started,
    }
  }
}

export function skippedWeatherAlertsLeg(): NwsAlertsLeg {
  return { ok: true, queried: false, results: [], durationMs: 0 }
}
