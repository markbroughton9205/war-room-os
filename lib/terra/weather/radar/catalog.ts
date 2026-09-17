import { cacheGet, cacheSet } from '@/lib/research-engine/cache/ttlCache'
import {
  IEM_JSON_RADAR,
  IEM_N0Q_META,
  RADAR_ATTRIBUTION,
  RADAR_HISTORY_MINUTES,
  RADAR_METADATA_CACHE_MS,
  RADAR_PRODUCT,
  RADAR_PRODUCT_LABEL,
  RADAR_PROVIDER_ID,
  RADAR_PROVIDER_NAME,
  RADAR_SITE,
  RADAR_TRUTH_KIND,
  IEM_DISCLAIMER,
  IEM_OGC_DOCS,
  IEM_USCOMP_COVERAGE,
  type RadarCatalog,
} from './types'
import { mergeRadarFrames, pickLatestRadarFrame } from './frames'

const CACHE_KEY = 'terra-weather-radar-iem-catalog'
const LAST_GOOD_KEY = 'terra-weather-radar-iem-last-good'
const USER_AGENT = 'WarRoomOS-Terra/1.0 (weather-radar@warroom.internal; +https://mesonet.agron.iastate.edu/ogc/)'

type N0qMeta = { meta?: { product?: string; site?: string; valid?: string } }
type RadarList = { scans?: Array<{ ts?: string }>; generated_at?: string }

async function fetchJson<T>(url: string, timeoutMs: number): Promise<{ ok: true; status: number; value: T } | { ok: false; status: number; message: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: controller.signal,
      cache: 'no-store',
    })
    if (response.status === 429) {
      return { ok: false, status: 429, message: 'IEM rate limited this metadata request.' }
    }
    if (!response.ok) {
      return { ok: false, status: response.status, message: `IEM metadata HTTP ${response.status}` }
    }
    const value = await response.json() as T
    return { ok: true, status: response.status, value }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'IEM metadata fetch failed'
    return { ok: false, status: 0, message }
  } finally {
    clearTimeout(timer)
  }
}

function historyWindow(now: Date): { start: string; end: string } {
  const end = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours(),
    now.getUTCMinutes(),
  ))
  const start = new Date(end.getTime() - RADAR_HISTORY_MINUTES * 60_000)
  const fmt = (date: Date) => date.toISOString().slice(0, 16) + 'Z'
  return { start: fmt(start), end: fmt(end) }
}

export async function loadIemRadarCatalog(now = new Date()): Promise<RadarCatalog> {
  const cached = cacheGet<RadarCatalog>(CACHE_KEY)
  if (cached) return { ...cached, fromCache: true }

  const window = historyWindow(now)
  const listUrl = `${IEM_JSON_RADAR}?operation=list&radar=${encodeURIComponent(RADAR_SITE)}&product=${encodeURIComponent(RADAR_PRODUCT.split('-')[1] ?? 'N0Q')}&start=${encodeURIComponent(window.start)}&end=${encodeURIComponent(window.end)}`

  const [metaResult, listResult] = await Promise.all([
    fetchJson<N0qMeta>(IEM_N0Q_META, 8_000),
    fetchJson<RadarList>(listUrl, 8_000),
  ])

  const retrievedAt = now.toISOString()
  const lastGood = cacheGet<RadarCatalog>(LAST_GOOD_KEY)

  if (!metaResult.ok && !listResult.ok) {
    const rateLimited = metaResult.status === 429 || listResult.status === 429
    if (lastGood?.latest) {
      return {
        ...lastGood,
        fromCache: true,
        retrievedAt,
        catalogState: rateLimited ? 'RATE_LIMITED' : 'STALE',
        error: rateLimited ? 'IEM rate limited. Showing last verified frame.' : `${metaResult.message}; ${listResult.message}`,
      }
    }
    return {
      provider: RADAR_PROVIDER_ID,
      providerName: RADAR_PROVIDER_NAME,
      product: RADAR_PRODUCT,
      productLabel: RADAR_PRODUCT_LABEL,
      truthKind: RADAR_TRUTH_KIND,
      attribution: RADAR_ATTRIBUTION,
      docsUrl: IEM_OGC_DOCS,
      disclaimerUrl: IEM_DISCLAIMER,
      coverage: IEM_USCOMP_COVERAGE,
      frames: [],
      latest: null,
      retrievedAt,
      generatedAt: null,
      fromCache: false,
      catalogState: rateLimited ? 'RATE_LIMITED' : 'ERROR_UPSTREAM',
      error: rateLimited ? 'IEM rate limited this metadata request.' : `${metaResult.message}; ${listResult.message}`,
    }
  }

  const scans = listResult.ok
    ? (listResult.value.scans ?? []).map(item => item.ts).filter((item): item is string => typeof item === 'string')
    : []
  const metaValid = metaResult.ok && typeof metaResult.value.meta?.valid === 'string'
    ? metaResult.value.meta.valid
    : null
  const frames = mergeRadarFrames({ metaValid, scans })
  const latest = pickLatestRadarFrame(frames)
  const catalog: RadarCatalog = {
    provider: RADAR_PROVIDER_ID,
    providerName: RADAR_PROVIDER_NAME,
    product: RADAR_PRODUCT,
    productLabel: RADAR_PRODUCT_LABEL,
    truthKind: RADAR_TRUTH_KIND,
    attribution: RADAR_ATTRIBUTION,
    docsUrl: IEM_OGC_DOCS,
    disclaimerUrl: IEM_DISCLAIMER,
    coverage: IEM_USCOMP_COVERAGE,
    frames,
    latest,
    retrievedAt,
    generatedAt: listResult.ok && typeof listResult.value.generated_at === 'string' ? listResult.value.generated_at : null,
    fromCache: false,
    catalogState: latest ? 'AVAILABLE' : 'UNAVAILABLE',
    error: metaResult.ok && listResult.ok ? null : [!metaResult.ok ? metaResult.message : null, !listResult.ok ? listResult.message : null].filter(Boolean).join('; ') || null,
  }
  cacheSet(CACHE_KEY, catalog, RADAR_METADATA_CACHE_MS)
  if (latest) cacheSet(LAST_GOOD_KEY, catalog, 30 * 60_000)
  return catalog
}
