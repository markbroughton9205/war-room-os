import { hostnameFromUrl } from '@/lib/intelligence/canonicalUrl'
import { searchLocalCorpus } from '../crawler/localSearch'
import { WAR_ROOM_STORAGE_ORIGIN } from '../crawler/types'
import type { EvidenceDiscoveryProvider } from '@/lib/intelligence/intelligencePacket'
import { searchLocalHybrid } from '../hybrid/retrieve'
import { emptyLocalSemanticHealth, inspectLocalSemanticHealth } from '../hybrid/semanticHealth'
import type { LocalRetrievalMode, LocalRetrievalSignals, LocalSemanticHealth } from '../types'

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
  lexicalRank?: number | null
  semanticRank?: number | null
  fusionScore?: number | null
  matchedChunkId?: string | null
  semanticScore?: number | null
  lexicalScore?: number | null
  localRetrievalSignals?: LocalRetrievalSignals | null
}

export type WarRoomLocalLeg = {
  ok: boolean
  configured: boolean
  results: WarRoomLocalHit[]
  error?: string
  warningCode?: WarRoomLocalWarningCode
  durationMs: number
  semanticAvailable?: boolean
  semanticReason?: string | null
  localSemantic?: LocalSemanticHealth | null
  retrievalMode?: LocalRetrievalMode
}

export function emptyWarRoomLocalLeg(error?: string, warningCode?: WarRoomLocalWarningCode): WarRoomLocalLeg {
  return {
    ok: false,
    configured: false,
    results: [],
    error,
    warningCode,
    durationMs: 0,
    semanticAvailable: false,
    semanticReason: error ?? null,
    localSemantic: emptyLocalSemanticHealth(error === 'WAR_ROOM_LOCAL_DISABLED' ? 'disabled' : 'error', error ?? null),
    retrievalMode: 'FTS_FALLBACK',
  }
}

export function warRoomLocalSearchDisabled(env: Record<string, string | undefined> = process.env): boolean {
  return /^(1|true|yes)$/i.test(env.WAR_ROOM_LOCAL_SEARCH_DISABLED ?? '')
}

export async function runWarRoomLocalSearch(
  query: string,
  opts?: { pageSize?: number; corpusRoot?: string; env?: Record<string, string | undefined> },
): Promise<WarRoomLocalLeg> {
  const started = Date.now()
  const env = opts?.env ?? process.env
  if (warRoomLocalSearchDisabled(env)) {
    return { ...emptyWarRoomLocalLeg('WAR_ROOM_LOCAL_DISABLED', 'WAR_ROOM_LOCAL_DISABLED'), durationMs: Date.now() - started }
  }
  try {
    const hybrid = await searchLocalHybrid(query, {
      limit: opts?.pageSize ?? 8,
      corpusRoot: opts?.corpusRoot ?? env.WAR_ROOM_SOVEREIGN_SEARCH_DIR,
    })
    const results = hybrid.hits.map(hit => mapHit(hit.document, {
      snippet: hit.snippet,
      providerRank: hit.fusionRank,
      lexicalRank: hit.lexicalRank,
      semanticRank: hit.semanticRank,
      fusionScore: hit.fusionScore,
      matchedChunkId: hit.matchedChunkId,
      semanticScore: hit.semanticScore,
      lexicalScore: hit.lexicalScore,
      mode: hybrid.retrievalMode,
    }))
    const localSemantic = inspectLocalSemanticHealth({
      corpusRoot: opts?.corpusRoot ?? env.WAR_ROOM_SOVEREIGN_SEARCH_DIR,
      env,
      queryResult: hybrid,
    })
    return {
      ok: true,
      configured: true,
      results,
      warningCode: results.length ? undefined : 'WAR_ROOM_LOCAL_EMPTY',
      durationMs: Date.now() - started,
      semanticAvailable: hybrid.semanticAvailable,
      semanticReason: hybrid.semanticReason,
      localSemantic,
      retrievalMode: hybrid.retrievalMode,
    }
  } catch (error) {
    try {
      const hits = searchLocalCorpus(query, { limit: opts?.pageSize ?? 8, corpusRoot: opts?.corpusRoot ?? env.WAR_ROOM_SOVEREIGN_SEARCH_DIR })
      const results = hits.map((hit, index) => mapHit(hit.document, {
        snippet: hit.snippet || hit.document.description || hit.document.contentText.slice(0, 280),
        providerRank: index + 1,
      }))
      return {
        ok: true,
        configured: true,
        results,
        warningCode: results.length ? undefined : 'WAR_ROOM_LOCAL_EMPTY',
        durationMs: Date.now() - started,
        semanticAvailable: false,
        semanticReason: error instanceof Error ? error.message : 'SEMANTIC_UNAVAILABLE',
        localSemantic: inspectLocalSemanticHealth({
          corpusRoot: opts?.corpusRoot ?? env.WAR_ROOM_SOVEREIGN_SEARCH_DIR,
          env,
        }),
        retrievalMode: 'FTS_FALLBACK',
      }
    } catch (ftsError) {
      return {
        ok: false,
        configured: true,
        results: [],
        error: ftsError instanceof Error ? ftsError.message : 'Local index unavailable.',
        warningCode: 'WAR_ROOM_LOCAL_UNAVAILABLE',
        durationMs: Date.now() - started,
        semanticAvailable: false,
        semanticReason: error instanceof Error ? error.message : 'SEMANTIC_UNAVAILABLE',
        localSemantic: emptyLocalSemanticHealth('error', error instanceof Error ? error.message : 'SEMANTIC_UNAVAILABLE'),
        retrievalMode: 'FTS_FALLBACK',
      }
    }
  }
}

function mapHit(
  doc: {
    originalUrl: string
    canonicalUrl: string
    publisher: string
    domain: string
    title: string | null
    description: string | null
    contentText: string
    publishedAt: string | null
    lastCrawledAt: string
    language: string | null
    contentHash: string
    firstSeenAt: string
    discoveredVia: EvidenceDiscoveryProvider | null
    alsoDiscoveredVia: EvidenceDiscoveryProvider[]
    robotsStatus: string
  },
  extra: {
    snippet: string
    providerRank: number | null
    lexicalRank?: number | null
    semanticRank?: number | null
    fusionScore?: number | null
    matchedChunkId?: string | null
    semanticScore?: number | null
    lexicalScore?: number | null
    mode?: LocalRetrievalMode
  },
): WarRoomLocalHit {
  const publisher = doc.publisher || doc.domain || hostnameFromUrl(doc.canonicalUrl) || 'unknown'
  return {
    title: doc.title || publisher,
    url: doc.originalUrl,
    canonicalUrl: doc.canonicalUrl,
    snippet: extra.snippet,
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
    providerRank: extra.providerRank,
    lexicalRank: extra.lexicalRank ?? null,
    semanticRank: extra.semanticRank ?? null,
    fusionScore: extra.fusionScore ?? null,
    matchedChunkId: extra.matchedChunkId ?? null,
    semanticScore: extra.semanticScore ?? null,
    lexicalScore: extra.lexicalScore ?? null,
    localRetrievalSignals: {
      lexicalRank: extra.lexicalRank ?? null,
      lexicalScore: extra.lexicalScore ?? null,
      semanticRank: extra.semanticRank ?? null,
      semanticScore: extra.semanticScore ?? null,
      fusionRank: extra.providerRank,
      fusionScore: extra.fusionScore ?? null,
      matchedChunkId: extra.matchedChunkId ?? null,
      mode: extra.mode ?? (extra.semanticRank == null ? 'FTS_FALLBACK' : 'HYBRID_RRF'),
    },
  }
}
