import 'server-only'

/**
 * Ontario 511 (511on.ca) traffic cameras — God's Eye Phase 2. Real endpoint confirmed live this
 * build: GET https://511on.ca/api/v2/get/cameras — zero-auth, keyless, real JSON array of camera
 * sites, each with one or more physical `Views` (matching digitraffic_road_cameras' "one preset per
 * physical view" shape).
 *
 * CORRECTION to Phase 1's roadTrafficSourceRegistry.ts note, which assumed each View's `Url`
 * (`https://511on.ca/map/Cctv/{id}`) was an HTML viewer page needing further investigation before
 * the camera capability could be implemented. Live-verified this build with a real HTTP GET +
 * header inspection: that URL returns the raw JPEG directly
 * (`content-type: image/jpeg`, real embedded EXIF capture datetime, `cache-control: max-age=20`,
 * served via CloudFront with `access-control-allow-origin: *`) — not an HTML page at all. This is
 * exactly the "Kimi research vs. live source behavior disagree" case the mission asked to be
 * recorded explicitly, and it resolves in the more-capable direction: Ontario 511 cameras ARE
 * directly viewable/proxyable images, not metadata-only.
 *
 * This adapter itself never fetches the image host (511on.ca/map/Cctv/*) — only the metadata
 * endpoint above — mirroring digitraffic_road_cameras' existing "adapter fetches metadata only"
 * split. The image is loaded either directly by the Commander's browser or through
 * app/api/terra/camera-image/route.ts (this phase's new proxy boundary), never by this adapter.
 *
 * Licensing note (honest gap, not a fabricated claim): 511on.ca's own terms-of-use page
 * (https://511on.ca/tos) redirected during this build's live check rather than rendering reviewable
 * text, so redistribution/proxying terms are not independently confirmed this phase. Treated the
 * same way digitraffic/DriveBC's terms were confirmed BEFORE proxying/redistribution was designed
 * around them — see this repo's Phase 2 report for the explicit "document, don't assume" call this
 * produced.
 */
import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'ontario_511_cameras' as const
const BASE_URL = 'https://511on.ca/api/v2/get'
const MAX_RESULTS = 100
const BBOX_PATTERN = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/

type OntarioCameraView = { Id: number; Url: string; Status: string; Description?: string }
type OntarioCamera = { Id: number; Source: string; SourceId: string; Roadway: string; Direction: string; Latitude: number; Longitude: number; Location: string; Views?: OntarioCameraView[] | null }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim()
  const match = BBOX_PATTERN.exec(text)
  if (!match) {
    throw new Error('Query must be a bounding box "lamin,lomin,lamax,lomax" (e.g. "43.5,-79.6,43.9,-79.1" for the Toronto/QEW area).')
  }
  const [, laminStr, lominStr, lamaxStr, lomaxStr] = match
  const [lamin, lomin, lamax, lomax] = [laminStr, lominStr, lamaxStr, lomaxStr].map(Number)
  const limit = Math.max(1, Math.min(query.maxResults ?? 60, MAX_RESULTS))
  const cacheKey = `ontario_511_cameras:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/cameras`, { timeoutMs: 20_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }
  const cameras = safeJsonParse<OntarioCamera[]>(result.text)
  if (!cameras) return { ok: false as const, kind: 'malformed' as const, message: 'Ontario 511 cameras response was not valid JSON.' }

  const withinBbox = cameras.filter(camera =>
    typeof camera.Latitude === 'number' && typeof camera.Longitude === 'number' &&
    camera.Latitude >= lamin && camera.Latitude <= lamax && camera.Longitude >= lomin && camera.Longitude <= lomax,
  )

  const documents: ReturnType<typeof makeDocument>[] = []
  for (const camera of withinBbox) {
    if (documents.length >= limit) break
    const enabledViews = (camera.Views ?? []).filter(view => view.Status === 'Enabled')
    for (const view of enabledViews) {
      if (documents.length >= limit) break
      const title = view.Description ? `${camera.Location} — ${view.Description}` : camera.Location
      const canonicalUrl = view.Url

      documents.push(makeDocument({
        id: `ontario_511_cameras:${view.Id}`,
        provider: PROVIDER,
        providerRecordId: String(view.Id),
        title,
        summary: camera.Roadway || null,
        contentSnippet: `lat ${camera.Latitude}, lon ${camera.Longitude}`,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Ontario 511 (511on.ca)',
        contentType: 'traffic_camera',
        authors: [],
        organization: 'Government of Ontario / Ministry of Transportation',
        publishedAt: null,
        updatedAt: null,
        geography: `lat ${camera.Latitude}, lon ${camera.Longitude}`,
        language: null,
        identifiers: {
          cameraId: String(camera.Id),
          viewId: String(view.Id),
          latitude: String(camera.Latitude),
          longitude: String(camera.Longitude),
          imageUrl: view.Url,
          ...(camera.Roadway ? { road: camera.Roadway } : {}),
          ...(camera.Direction && camera.Direction !== 'Unknown' ? { direction: camera.Direction } : {}),
          ...(view.Description ? { viewDescription: view.Description } : {}),
          source: camera.Source,
        },
        subjects: [],
        // Redistribution/proxying terms not independently confirmed this build — see file header.
        license: 'Government of Ontario — terms not independently confirmed this build',
        accessStatus: 'open',
      }))
    }
  }

  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`Ontario 511 cameras request failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/cameras`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'cameras endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const ontario511CamerasAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
