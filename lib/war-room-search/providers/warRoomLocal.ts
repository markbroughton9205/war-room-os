import { hostnameFromUrl } from '@/lib/intelligence/canonicalUrl'
import { searchLocalCorpus } from '../crawler/localSearch'
import { WAR_ROOM_STORAGE_ORIGIN } from '../crawler/types'
import type { EvidenceDiscoveryProvider } from '@/lib/intelligence/intelligencePacket'

export const WAR_ROOM_LOCAL_WARNING_CODES = [
  'WAR_ROOM_LOCAL_DISABLED',
  'WAR_ROOM_LOCAL_UNAVAILABLE',
  'WAR_ROOM_LOCAL_EMPTY',
] as const

export type WarRoomLocalWarningCode = (typeof WAR_ROOM_LOCAL_WARNING_CODES)[number]

export type WarRoomLocalHit = {
  title: string
  url: string
  canonicalUrl: string
  snippet: string
  publisher: string
  domain: string
  publishedAt: string | null
  observedAt: string
  language: string | null
  contentHash: string
  firstSeenAt: string
  lastCrawledAt: string
  discoveredVia: EvidenceDiscoveryProvider
  alsoDiscoveredVia: EvidenceDiscoveryProvider[]
  storageOrigin: typeof WAR_ROOM_STORAGE_ORIGIN
  robotsStatus: string
  providerRank: number | null
}

export type WarRoomLocalLeg = {
  ok: boolean
  configured: boolean
  results: WarRoomLocalHit[]
  error?: string
  warningCode?: WarRoomLocalWarningCode
  durationMs: number
}

export function emptyWarRoomLocalLeg(error?: string, warningCode?: WarRoomLocalWarningCode): WarRoomLocalLeg {
  return {
    ok: false,
    configured: false,
    results: [],
    error,
    warningCode,
    durationMs: 0,
  }
}

export function warRoomLocalSearchDisabled(env: Record<string, string | undefined> = process.env): boolean {
  return /^(1|true|yes)$/i.test(env.WAR_ROOM_LOCAL_SEARCH_DISABLED ?? '')
}

export function runWarRoomLocalSearch(
  query: string,
  opts?: { pageSize?: number; corpusRoot?: string; env?: Record<string, string | undefined> },
): WarRoomLocalLeg {
  const started = Date.now()
  const env = opts?.env ?? process.env
  if (warRoomLocalSearchDisabled(env)) {
    return { ...emptyWarRoomLocalLeg('WAR_ROOM_LOCAL_DISABLED', 'WAR_ROOM_LOCAL_DISABLED'), durationMs: Date.now() - started }
  }
  try {
    const hits = searchLocalCorpus(query, { limit: opts?.pageSize ?? 8, corpusRoot: opts?.corpusRoot ?? env.WAR_ROOM_SOVEREIGN_SEARCH_DIR })
    const results: WarRoomLocalHit[] = hits.map((hit, index) => {
      const doc = hit.document
      const publisher = doc.publisher || doc.domain || hostnameFromUrl(doc.canonicalUrl) || 'unknown'
      return {
        title: doc.title || publisher,
        url: doc.originalUrl,
        canonicalUrl: doc.canonicalUrl,
        snippet: hit.snippet || doc.description || doc.contentText.slice(0, 280),
        publisher,
        domain: doc.domain,
        publishedAt: doc.publishedAt,
        observedAt: doc.lastCrawledAt,
        language: doc.language,
        contentHash: doc.contentHash,
        firstSeenAt: doc.firstSeenAt,
        lastCrawledAt: doc.lastCrawledAt,
        discoveredVia: 'WAR_ROOM_LOCAL',
        alsoDiscoveredVia: [
          ...(doc.discoveredVia && doc.discoveredVia !== 'WAR_ROOM_LOCAL' ? [doc.discoveredVia] : []),
          ...doc.alsoDiscoveredVia.filter(value => value !== 'WAR_ROOM_LOCAL'),
        ],
        storageOrigin: WAR_ROOM_STORAGE_ORIGIN,
        robotsStatus: doc.robotsStatus,
        providerRank: index + 1,
      }
    })
    return {
      ok: true,
      configured: true,
      results,
      warningCode: results.length ? undefined : 'WAR_ROOM_LOCAL_EMPTY',
      durationMs: Date.now() - started,
    }
  } catch (error) {
    return {
      ok: false,
      configured: true,
      results: [],
      error: error instanceof Error ? error.message : 'Local index unavailable.',
      warningCode: 'WAR_ROOM_LOCAL_UNAVAILABLE',
      durationMs: Date.now() - started,
    }
  }
}
