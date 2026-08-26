import 'server-only'

import type { ResearchGeoFeature, ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

/**
 * NASA EONET (Earth Observatory Natural Event Tracker) v3 — a real, live, zero-auth API of
 * currently open natural-hazard events across multiple categories (wildfires, volcanoes, floods,
 * severe storms, and others), each event carrying a real chronological array of position
 * observations (`geometry`), not just one point. This one adapter serves three distinct Terra
 * layers this phase (wildfire_incident, volcano_event, flood_event) via three catalog entries with
 * different `category` query text — one real provider, three real capabilities, not three clients.
 *
 * Query text selects the EONET category (one of the allowlisted values below) — no free-text
 * search exists on this endpoint, matching the category-scoped nature of the source itself.
 *
 * Each event's full `geometry` history (every dated position/magnitude observation EONET has
 * recorded for it) is preserved in `identifiers`/document fields, not discarded down to the
 * single latest point — Terra's normalizer decides how much of it to use.
 */
const PROVIDER = 'nasa_eonet' as const
const BASE_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events'
const MAX_RESULTS = 25

// The only categories this adapter is scoped to serve this phase — matches the real EONET
// category ids exactly (confirmed live via GET /api/v3/categories). Not every EONET category is
// allowlisted: only the ones a real Terra layer actually consumes this phase.
const ALLOWED_CATEGORIES = ['wildfires', 'volcanoes', 'floods', 'severeStorms'] as const
type EonetCategory = (typeof ALLOWED_CATEGORIES)[number]

type EonetGeometry = { date?: string; type?: string; coordinates?: unknown; magnitudeValue?: number | null; magnitudeUnit?: string | null }
type EonetSource = { id?: string; url?: string }
type EonetEvent = {
  id?: string
  title?: string
  description?: string | null
  link?: string
  closed?: string | null
  categories?: { id?: string; title?: string }[]
  sources?: EonetSource[]
  geometry?: EonetGeometry[]
}
type EonetResponse = { events?: EonetEvent[] }

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isValidCategory(text: string): text is EonetCategory {
  return (ALLOWED_CATEGORIES as readonly string[]).includes(text)
}

/** EONET's own geometry entries are chronological but not guaranteed sorted in every feed — the
 * most recent by real timestamp, never the last array element, matches the same
 * "never assume pre-sorted order" discipline usgs_water's normalizer already established. */
function mostRecentGeometry(geometry: EonetGeometry[]): EonetGeometry | null {
  let best: EonetGeometry | null = null
  for (const entry of geometry) {
    if (entry.type !== 'Point' || !Array.isArray(entry.coordinates) || entry.coordinates.length < 2) continue
    if (!entry.date) continue
    if (!best || !best.date || entry.date > best.date) best = entry
  }
  return best
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim()
  if (!isValidCategory(text)) {
    throw new Error(`Query must be exactly one of: ${ALLOWED_CATEGORIES.join(', ')}.`)
  }
  const limit = Math.max(1, Math.min(query.maxResults ?? 20, MAX_RESULTS))
  const cacheKey = `nasa_eonet:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('status', 'open')
  url.searchParams.set('category', text)
  url.searchParams.set('limit', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<EonetResponse>(result.text)
  if (!data || !Array.isArray(data.events)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'EONET response "events" field was missing or not an array.' }
  }

  const documents = data.events.filter(event => typeof event.id === 'string' && typeof event.title === 'string').map(event =>
    makeDocument({
      id: `nasa_eonet:${event.id}`,
      provider: PROVIDER,
      providerRecordId: event.id as string,
      title: event.title as string,
      summary: event.description ?? null,
      contentSnippet: null,
      canonicalUrl: event.link ?? `https://eonet.gsfc.nasa.gov/api/v3/events/${event.id}`,
      sourceUrl: event.sources?.[0]?.url ?? event.link ?? null,
      sourceName: event.sources?.[0]?.id ?? 'NASA EONET',
      contentType: `eonet_${text}`,
      authors: [],
      organization: 'NASA Earth Observatory Natural Event Tracker',
      publishedAt: event.geometry?.[0]?.date ?? null,
      updatedAt: mostRecentGeometry(event.geometry ?? [])?.date ?? null,
      geography: null,
      language: 'en',
      identifiers: { eonet_event_id: event.id as string, category: text },
      subjects: (event.categories ?? []).map(c => c.id).filter((v): v is string => !!v),
      license: null,
      accessStatus: 'open',
    }),
  )

  const geoFeatures: ResearchGeoFeature[] = data.events
    .filter(event => typeof event.id === 'string')
    .map((event): ResearchGeoFeature | null => {
      const latest = mostRecentGeometry(event.geometry ?? [])
      if (!latest || !Array.isArray(latest.coordinates)) return null
      return {
        id: event.id as string,
        geometryType: 'Point',
        coordinates: latest.coordinates,
        properties: {
          title: event.title ?? null,
          category: text,
          magnitudeValue: isFiniteNumber(latest.magnitudeValue) ? latest.magnitudeValue : null,
          magnitudeUnit: latest.magnitudeUnit ?? null,
          date: latest.date ?? null,
          // Full observation history preserved, not discarded — a future track/trend renderer can
          // use it; this phase's normalizer only projects the latest point.
          geometryHistory: (event.geometry ?? []).map(g => ({ date: g.date ?? null, coordinates: g.coordinates ?? null, magnitudeValue: isFiniteNumber(g.magnitudeValue) ? g.magnitudeValue : null, magnitudeUnit: g.magnitudeUnit ?? null })),
        },
      }
    })
    .filter((f): f is ResearchGeoFeature => f !== null)

  const response = okResponse(PROVIDER, { documents, geoFeatures, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`NASA EONET fetch failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?status=open&category=wildfires&limit=1`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'events endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const nasaEonetAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
