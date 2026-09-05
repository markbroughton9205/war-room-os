import 'server-only'

/**
 * WebTRIS (National Highways, UK) — God's Eye Phase 2's first Traffic Flow source. Real endpoint
 * confirmed live this build against the current production API
 * (webtris.nationalhighways.co.uk/api/v1.0): zero-auth, keyless, no registration — confirmed both
 * by the service's own Swagger docs and by a real HTTP 200 with real MIDAS-loop site/report data
 * fetched live during this phase's reconciliation.
 *
 * IMPORTANT discrepancy vs. Phase 1's reconciliation note (which called WebTRIS "the strongest
 * keyless TrafficFlow candidate" purely on keyless-access grounds, never checked for recency):
 * `reports/daily` is a BATCH-PROCESSED HISTORICAL reporting endpoint, not a live/near-real-time
 * feed. Live probing this build found NO site anywhere in the network (tested across sites spread
 * across the whole ID range) has a report for "today," "yesterday," or even the prior ~8 weeks —
 * the most recent available report date lags real time by roughly two months and drifts over time.
 * This is a genuine, source-confirmed fact, not an integration bug — WebTRIS's own docs describe
 * `reports/daily` as a processed statistical report, never claiming real-time delivery. Per mission
 * doctrine ("never render STALE as LIVE"), every observation this adapter returns is therefore
 * unconditionally treated as historical/STALE data (see `temporalStatus`/`properties.isHistorical`
 * below and lib/terra/coverageTruth.ts's consumption of it) — never presented as a live traffic
 * condition, however fresh the rest of Terra's other layers look.
 *
 * GET /sites               -> every MIDAS/TAME loop site nationwide (20,000+), no bbox param —
 *   filtered client-side, same "always whole-country" shape as every Digitraffic feed integrated so
 *   far. Real Id/Name/Description/Longitude/Latitude/Status.
 * GET /reports/daily?sites={id}&start_date=DDMMYYYY&end_date=DDMMYYYY&page=1&page_size=100 -> up to
 *   96 real 15-minute interval rows for one site/day (Report Date, Time Period Ending, per-vehicle-
 *   length-band counts, Avg mph, Total Volume). No free-flow baseline is ever supplied by this
 *   endpoint — this adapter never invents one; only the raw observed Avg mph / Total Volume are
 *   reported.
 *
 * Because there is no way to ask WebTRIS "what is your most recent available date" directly, the
 * most recent report date is discovered once (real live probing, an increasing day-offset ladder
 * against a real in-bbox site) and cached for CACHE_TTL.timeSeries so normal queries never re-probe.
 */
import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'webtris' as const
const BASE_URL = 'https://webtris.nationalhighways.co.uk/api/v1.0'
const MAX_RESULTS = 60
const BBOX_PATTERN = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/
// A real day-offset search ladder (not a hardcoded lag assumption) — the actual lag drifts over
// time, so this re-discovers it live rather than baking in today's ~60-day observation.
const REPORT_DATE_OFFSET_LADDER_DAYS = [1, 2, 3, 5, 8, 14, 21, 30, 45, 60, 75, 90, 120]
const RESOLVED_REPORT_DATE_CACHE_KEY = 'webtris:resolved_report_date'

type WebtrisSite = { Id: string; Name?: string; Description?: string; Longitude: number; Latitude: number; Status: string }
type WebtrisSitesResponse = { sites?: WebtrisSite[] | null }
type WebtrisDailyRow = {
  'Site Name'?: string
  'Report Date'?: string
  'Time Period Ending'?: string
  'Avg mph'?: string
  'Total Volume'?: string
}
type WebtrisDailyResponse = { Header?: { row_count: number }; Rows?: WebtrisDailyRow[] | null }

function formatWebtrisDate(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const yyyy = date.getUTCFullYear()
  return `${dd}${mm}${yyyy}`
}

function daysAgo(n: number): Date {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - n)
  return date
}

/** Real direction words WebTRIS embeds in a site's own `Name` string (e.g. "... GPS Ref:
 * 502816;178156; Westbound") — parsed verbatim from the source string, never inferred from
 * geometry. */
function extractDirection(name: string | undefined): string | null {
  if (!name) return null
  const match = /;\s*(Northbound|Southbound|Eastbound|Westbound|Clockwise|Anti-clockwise)\s*$/i.exec(name.trim())
  return match ? match[1] : null
}

async function resolveMostRecentReportDate(probeSiteId: string): Promise<string | null> {
  const cached = cacheGet<string>(RESOLVED_REPORT_DATE_CACHE_KEY)
  if (cached) return cached

  for (const offset of REPORT_DATE_OFFSET_LADDER_DAYS) {
    const dateStr = formatWebtrisDate(daysAgo(offset))
    const url = `${BASE_URL}/reports/daily?sites=${encodeURIComponent(probeSiteId)}&start_date=${dateStr}&end_date=${dateStr}&page=1&page_size=1`
    try {
      const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 10_000 })
      if (!result.ok) continue
      const data = safeJsonParse<WebtrisDailyResponse>(result.text)
      if (data?.Rows && data.Rows.length > 0) {
        cacheSet(RESOLVED_REPORT_DATE_CACHE_KEY, dateStr, CACHE_TTL.timeSeries)
        return dateStr
      }
    } catch {
      continue
    }
  }
  return null
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim()
  const match = BBOX_PATTERN.exec(text)
  if (!match) {
    throw new Error('Query must be a bounding box "lamin,lomin,lamax,lomax" (e.g. "51.3,-0.6,51.7,0.3" for the M25/London area).')
  }
  const [, laminStr, lominStr, lamaxStr, lomaxStr] = match
  const [lamin, lomin, lamax, lomax] = [laminStr, lominStr, lamaxStr, lomaxStr].map(Number)
  const limit = Math.max(1, Math.min(query.maxResults ?? 40, MAX_RESULTS))
  const cacheKey = `webtris:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const sitesCacheKey = 'webtris:sites'
  let sitesData = cacheGet<WebtrisSitesResponse>(sitesCacheKey)
  if (!sitesData) {
    const sitesResult = await safeProviderFetch(PROVIDER, `${BASE_URL}/sites`, { timeoutMs: 20_000 })
    if (!sitesResult.ok) return { ok: false as const, kind: 'http_error' as const, status: sitesResult.status }
    const parsed = safeJsonParse<WebtrisSitesResponse>(sitesResult.text)
    if (!parsed) return { ok: false as const, kind: 'malformed' as const, message: 'WebTRIS sites response was not valid JSON.' }
    sitesData = parsed
    cacheSet(sitesCacheKey, sitesData, CACHE_TTL.codelist)
  }

  const withinBbox = (sitesData.sites ?? []).filter(site =>
    site.Status === 'Active' &&
    typeof site.Latitude === 'number' && typeof site.Longitude === 'number' &&
    site.Latitude >= lamin && site.Latitude <= lamax && site.Longitude >= lomin && site.Longitude <= lomax,
  )

  if (withinBbox.length === 0) {
    const response = okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started })
    cacheSet(cacheKey, response, CACHE_TTL.timeSeries)
    return { ok: true as const, response }
  }

  const reportDate = await resolveMostRecentReportDate(withinBbox[0].Id)
  if (!reportDate) {
    // Honest empty result, not an error — WebTRIS itself never supplied a usable recent report
    // date within the probe ladder.
    const response = okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started })
    cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
    return { ok: true as const, response }
  }

  const targets = withinBbox.slice(0, limit)
  const dailyResults = await Promise.all(
    targets.map(site => safeProviderFetch(PROVIDER, `${BASE_URL}/reports/daily?sites=${encodeURIComponent(site.Id)}&start_date=${reportDate}&end_date=${reportDate}&page=1&page_size=100`, { timeoutMs: 15_000 })),
  )

  const documents: ReturnType<typeof makeDocument>[] = []
  targets.forEach((site, i) => {
    const result = dailyResults[i]
    if (!result.ok) return
    const parsed = safeJsonParse<WebtrisDailyResponse>(result.text)
    const rows = parsed?.Rows ?? []
    if (rows.length === 0) return
    // Rows for a single day are returned in ascending Time Interval order — the last row is the
    // most recent 15-minute observation available for that (historical) day.
    const latest = rows[rows.length - 1]
    const avgMph = latest['Avg mph'] ? Number(latest['Avg mph']) : null
    const totalVolume = latest['Total Volume'] ? Number(latest['Total Volume']) : null
    const direction = extractDirection(site.Name)
    const road = site.Description ?? null
    const observedAtIso = latest['Report Date'] && latest['Time Period Ending']
      ? new Date(`${latest['Report Date'].slice(0, 10)}T${latest['Time Period Ending']}Z`).toISOString()
      : null
    const canonicalUrl = `https://webtris.nationalhighways.co.uk/api/v1.0/reports/daily?sites=${site.Id}&start_date=${reportDate}&end_date=${reportDate}`

    documents.push(makeDocument({
      id: `webtris:${site.Id}:${reportDate}`,
      provider: PROVIDER,
      providerRecordId: site.Id,
      title: road ?? `WebTRIS site ${site.Id}`,
      summary: direction ? `${direction} — historical report, not live` : 'Historical report, not live',
      contentSnippet: `lat ${site.Latitude}, lon ${site.Longitude}`,
      canonicalUrl,
      sourceUrl: canonicalUrl,
      sourceName: 'WebTRIS (National Highways, UK)',
      contentType: 'traffic_flow_observation',
      authors: [],
      organization: 'National Highways',
      publishedAt: observedAtIso,
      updatedAt: null,
      geography: `lat ${site.Latitude}, lon ${site.Longitude}`,
      language: null,
      identifiers: {
        siteId: site.Id,
        latitude: String(site.Latitude),
        longitude: String(site.Longitude),
        ...(road ? { road } : {}),
        ...(direction ? { direction } : {}),
        ...(avgMph !== null && Number.isFinite(avgMph) ? { speedMph: String(avgMph) } : {}),
        ...(totalVolume !== null && Number.isFinite(totalVolume) ? { vehicleFlowCount: String(totalVolume) } : {}),
        reportDate,
        ...(observedAtIso ? { observedAtIso } : {}),
        // Always true — see this file's header comment. Never omitted, so no downstream consumer
        // can mistake this for a live reading by its absence.
        isHistoricalBatchReport: 'true',
      },
      subjects: [],
      license: 'UK Open Government Licence (National Highways)',
      accessStatus: 'open',
    }))
  })

  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.timeSeries)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`WebTRIS request failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/sites`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'sites endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const webtrisAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
