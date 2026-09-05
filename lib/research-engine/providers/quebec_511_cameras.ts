import 'server-only'

/**
 * Québec 511 traffic cameras — God's Eye Phase 3 (global traffic expansion), via the Ministère
 * des Transports et de la Mobilité durable's official open-data WFS (the same service the
 * province's own datasets portal, donneesquebec.ca dataset "Caméra de circulation", links to).
 *
 * Real endpoint confirmed live this build:
 *   GET https://ws.mapserver.transports.gouv.qc.ca/swtq?service=wfs&version=2.0.0&request=getfeature
 *       &typename=ms:infos_cameras&srsname=EPSG:4326&outputformat=geojson
 *   Real HTTP 200 (application/geo+json), 675 real cameras province-wide. Server-side bbox
 *   filtering confirmed live this build with a real axis-order discovery: this WFS 2.0.0 server
 *   expects `bbox=south,west,north,east,EPSG:4326` (latitude first — WFS 2.0's EPSG:4326 axis
 *   order, not the lon,lat order GeoJSON itself uses). A lon,lat-ordered bbox returned a real
 *   HTTP 200 with zero features; the lat,lon-ordered bbox returned 205 real cameras for the
 *   Montréal area. That is why this adapter forwards the query bbox verbatim rather than
 *   re-ordering it.
 *
 * Each camera's real fields are preserved verbatim (bilingual FR/EN location descriptions,
 * region name, route number, DateDebutDiffusion). IMPORTANT honest gap: the source's
 * URL_FLUX_DONNEE field is an HTML viewer page
 * (quebec511.info/Carte/Fenetres/FenetreVideo.html?id={n}), NOT a direct JPEG — the exact
 * inverse of what Ontario 511 turned out to be. This adapter therefore never claims a direct
 * imageUrl; the viewer URL is preserved as canonicalUrl only.
 *
 * Zero-auth, keyless. Licensing: the dataset is published through the Québec government's open
 * data portal (donneesquebec.ca — Licence CC-BY per that portal's standard listing for MTMD
 * geodata), the same open-data program the WFS endpoint itself is part of.
 */
import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'quebec_511_cameras' as const
const WFS_BASE_URL = 'https://ws.mapserver.transports.gouv.qc.ca/swtq'
const MAX_RESULTS = 100
const BBOX_PATTERN = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/

type QuebecCameraProperties = {
  IDEcamera?: string
  NumeroCamera?: string
  DescriptionLocalisationFr?: string
  DescriptionLocalisationEn?: string
  DateDebutDiffusion?: string
  NumeroRoute?: string
  NomRegionDiffusion?: string
}
type QuebecCameraFeature = {
  id?: number
  properties?: QuebecCameraProperties
  geometry?: { type?: string; coordinates?: number[] }
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim()
  const match = BBOX_PATTERN.exec(text)
  if (!match) {
    throw new Error('Query must be a bounding box "lamin,lomin,lamax,lomax" (e.g. "45.3,-74.2,45.8,-73.3" for Montréal).')
  }
  const [, laminStr, lominStr, lamaxStr, lomaxStr] = match
  const limit = Math.max(1, Math.min(query.maxResults ?? 60, MAX_RESULTS))
  const cacheKey = `quebec_511_cameras:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  // WFS 2.0.0 / EPSG:4326 axis order is lat,lon — the same "lamin,lomin,lamax,lomax" order the
  // query string already carries (confirmed live this build; see file header).
  const url = `${WFS_BASE_URL}?service=wfs&version=2.0.0&request=getfeature&typename=ms:infos_cameras&srsname=EPSG:4326&outputformat=geojson&bbox=${laminStr},${lominStr},${lamaxStr},${lomaxStr},EPSG:4326`
  const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 25_000, maxResponseBytes: 4 * 1024 * 1024 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }
  const payload = safeJsonParse<{ features?: QuebecCameraFeature[] }>(result.text)
  if (!payload || !Array.isArray(payload.features)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Québec 511 cameras WFS response was not a valid GeoJSON FeatureCollection.' }
  }

  const documents: ReturnType<typeof makeDocument>[] = []
  for (const feature of payload.features) {
    if (documents.length >= limit) break
    const coordinates = feature.geometry?.coordinates
    if (!Array.isArray(coordinates) || coordinates.length < 2) continue
    const [longitude, latitude] = coordinates
    if (typeof longitude !== 'number' || typeof latitude !== 'number') continue
    const props = feature.properties ?? {}
    const cameraId = props.IDEcamera ?? String(feature.id ?? '')
    if (!cameraId) continue
    const title = props.DescriptionLocalisationEn || props.DescriptionLocalisationFr || `Traffic camera ${cameraId}`

    documents.push(makeDocument({
      id: `quebec_511_cameras:${cameraId}`,
      provider: PROVIDER,
      providerRecordId: cameraId,
      title,
      summary: props.DescriptionLocalisationFr && props.DescriptionLocalisationFr !== title ? props.DescriptionLocalisationFr : null,
      contentSnippet: `lat ${latitude}, lon ${longitude}`,
      // URL_FLUX_DONNEE is an HTML viewer page, NOT a direct image — see file header. Preserved
      // as the canonical provenance link only; imageUrl is never fabricated from it.
      canonicalUrl: props.IDEcamera ? `https://www.quebec511.info/Carte/Fenetres/FenetreVideo.html?id=${props.IDEcamera}` : null,
      sourceUrl: url,
      sourceName: 'Québec 511 (Ministère des Transports et de la Mobilité durable)',
      contentType: 'traffic_camera',
      authors: [],
      organization: 'Ministère des Transports et de la Mobilité durable du Québec',
      publishedAt: null,
      updatedAt: null,
      geography: `lat ${latitude}, lon ${longitude}`,
      language: 'en',
      identifiers: {
        cameraId,
        latitude: String(latitude),
        longitude: String(longitude),
        ...(props.NumeroCamera ? { cameraNumber: props.NumeroCamera } : {}),
        ...(props.NumeroRoute ? { road: props.NumeroRoute.replace(/^0+/, '') } : {}),
        ...(props.NomRegionDiffusion ? { region: props.NomRegionDiffusion } : {}),
        ...(props.DescriptionLocalisationFr ? { descriptionFr: props.DescriptionLocalisationFr } : {}),
        ...(props.DescriptionLocalisationEn ? { descriptionEn: props.DescriptionLocalisationEn } : {}),
        ...(props.DateDebutDiffusion ? { broadcastSince: props.DateDebutDiffusion } : {}),
      },
      subjects: [],
      license: 'Québec government open data (donneesquebec.ca)',
      accessStatus: 'open',
    }))
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
      if (outcome.kind === 'http_error') throw new Error(`Québec 511 cameras request failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const url = `${WFS_BASE_URL}?service=wfs&version=2.0.0&request=getfeature&typename=ms:infos_cameras&srsname=EPSG:4326&outputformat=geojson&count=1`
    const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 15_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'cameras WFS endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const quebec511CamerasAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
