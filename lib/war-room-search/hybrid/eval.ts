import { createHash } from 'node:crypto'
import { canonicalizeUrl, hostnameFromUrl } from '@/lib/intelligence/canonicalUrl'
import { hashEvidenceContent } from '@/lib/intelligence/contentHash'
import { SovereignCorpus } from '../crawler/corpus'
import type { CrawlDocumentRecord } from '../crawler/types'
import { WAR_ROOM_STORAGE_ORIGIN } from '../crawler/types'
import type { Embedder, HybridRetrievalMode } from './types'
import { searchLocalHybrid } from './retrieve'

export const EVAL_QUERY_TYPES = [
  'EXACT_LEXICAL',
  'PARAPHRASE',
  'CONCEPTUAL',
  'ENTITY',
  'AMBIGUOUS',
  'NO_RELEVANT_DOCUMENT',
] as const

export type EvalQueryType = (typeof EVAL_QUERY_TYPES)[number]

export type EvalQuery = {
  id: string
  query: string
  type: EvalQueryType
  expectedCanonicalUrls: string[]
  notes: string
}

export type EvalDocFixture = {
  url: string
  title: string
  text: string
  publisher: string
}

export const EVAL_NOW = '2026-09-09T18:00:00.000Z'

export const EVAL_DOCUMENTS: EvalDocFixture[] = [
  {
    url: 'https://www.reuters.com/world/asia/chip-export-2026',
    title: 'Chip export controls widen',
    publisher: 'reuters.com',
    text: 'Governments expanded semiconductor export restrictions on selling advanced processors abroad for foundry equipment and lithography tools.',
  },
  {
    url: 'https://weather.example/zxqplorbit',
    title: 'Rainfall note',
    publisher: 'weather.example',
    text: 'ZXQPLORBIT calibration token appears in this otherwise unrelated weather note about rainfall totals.',
  },
  {
    url: 'https://freight.example/brokerage',
    title: 'Freight brokerage',
    publisher: 'freight.example',
    text: 'Freight brokerage compliance for trucking companies remains a separate logistics topic.',
  },
  {
    url: 'https://iana.org/domains/reserved',
    title: 'IANA-managed Reserved Domains',
    publisher: 'iana.org',
    text: 'Example domains such as example.com are reserved for documentation and testing without operational use.',
  },
]

export const EVAL_QUERIES: EvalQuery[] = [
  {
    id: 'exact_lexical',
    query: 'ZXQPLORBIT',
    type: 'EXACT_LEXICAL',
    expectedCanonicalUrls: ['https://weather.example/zxqplorbit'],
    notes: 'Unique lexical token present in one fixture document.',
  },
  {
    id: 'paraphrase',
    query: 'limits on overseas sales of advanced processors',
    type: 'PARAPHRASE',
    expectedCanonicalUrls: ['https://reuters.com/world/asia/chip-export-2026'],
    notes: 'Paraphrase of semiconductor export controls; no shared unique token with ZXQPLORBIT.',
  },
  {
    id: 'conceptual',
    query: 'chip foundry export bans',
    type: 'CONCEPTUAL',
    expectedCanonicalUrls: ['https://reuters.com/world/asia/chip-export-2026'],
    notes: 'Conceptual overlap with semiconductor export restrictions.',
  },
  {
    id: 'entity',
    query: 'Reuters chip export',
    type: 'ENTITY',
    expectedCanonicalUrls: ['https://reuters.com/world/asia/chip-export-2026'],
    notes: 'Publisher entity plus topical tokens.',
  },
  {
    id: 'ambiguous',
    query: 'controls',
    type: 'AMBIGUOUS',
    expectedCanonicalUrls: ['https://reuters.com/world/asia/chip-export-2026'],
    notes: 'Ambiguous common token; expected relevant doc is still the export-controls article.',
  },
  {
    id: 'no_relevant',
    query: 'antarctic penguin census 1994',
    type: 'NO_RELEVANT_DOCUMENT',
    expectedCanonicalUrls: [],
    notes: 'No fixture document is about penguins; do not treat any fixture as relevant.',
  },
]

function contentHash(text: string): string {
  return hashEvidenceContent(text) ?? createHash('sha256').update(text).digest('hex')
}

export function seedEvalCorpus(corpus: SovereignCorpus): CrawlDocumentRecord[] {
  return EVAL_DOCUMENTS.map(input => {
    const canonical = canonicalizeUrl(input.url) || input.url
    return corpus.upsertDocument({
      originalUrl: input.url,
      finalUrl: input.url,
      canonicalUrl: canonical,
      domain: hostnameFromUrl(input.url) || 'example.com',
      publisher: input.publisher,
      title: input.title,
      description: input.text.slice(0, 160),
      language: 'en',
      publishedAt: '2026-09-01T00:00:00.000Z',
      author: null,
      lastCrawledAt: EVAL_NOW,
      contentHash: contentHash(input.text),
      contentText: input.text,
      httpStatus: 200,
      contentType: 'text/html',
      robotsStatus: 'ROBOTS_ALLOWED',
      crawlStatus: 'INDEXED',
      sourceOrigin: WAR_ROOM_STORAGE_ORIGIN,
      discoveredVia: 'COMMANDER',
      alsoDiscoveredVia: [],
      bytesReceived: input.text.length,
    })
  })
}

export type ModeMetrics = {
  mode: HybridRetrievalMode
  recallAt1: number
  recallAt3: number
  recallAt5: number
  mrr: number
  scoredQueries: number
  noRelevantOk: boolean | null
}

function firstRelevantRank(canonicals: string[], expected: string[]): number | null {
  for (const [index, url] of canonicals.entries()) {
    if (expected.includes(url)) return index + 1
  }
  return null
}

export function recallAtK(ranks: Array<number | null>, k: number): number {
  if (!ranks.length) return 0
  return ranks.filter(rank => rank != null && rank <= k).length / ranks.length
}

export function meanReciprocalRank(ranks: Array<number | null>): number {
  if (!ranks.length) return 0
  return ranks.reduce<number>((sum, rank) => sum + (rank ? 1 / rank : 0), 0) / ranks.length
}

export async function evaluateRetrievalMode(opts: {
  corpus: SovereignCorpus
  embedder: Embedder
  store?: import('./vectors').SqliteVectorStore
  mode: HybridRetrievalMode
}): Promise<{ metrics: ModeMetrics; rows: Array<{ id: string; query: string; type: EvalQueryType; top: string[]; rank: number | null }> }> {
  const topical = EVAL_QUERIES.filter(item => item.type !== 'NO_RELEVANT_DOCUMENT')
  const ranks: Array<number | null> = []
  const rows: Array<{ id: string; query: string; type: EvalQueryType; top: string[]; rank: number | null }> = []
  for (const item of topical) {
    const result = await searchLocalHybrid(item.query, {
      corpus: opts.corpus,
      embedder: opts.embedder,
      store: opts.store,
      retrievalMode: opts.mode,
      limit: 8,
    })
    const top = result.hits.map(hit => hit.document.canonicalUrl)
    const rank = firstRelevantRank(top, item.expectedCanonicalUrls)
    ranks.push(rank)
    rows.push({ id: item.id, query: item.query, type: item.type, top, rank })
  }

  const noRelevant = EVAL_QUERIES.find(item => item.type === 'NO_RELEVANT_DOCUMENT')!
  const noHit = await searchLocalHybrid(noRelevant.query, {
    corpus: opts.corpus,
    embedder: opts.embedder,
    store: opts.store,
    retrievalMode: 'fts',
    limit: 3,
  })
  const noRelevantOk = noHit.hits.length === 0

  return {
    metrics: {
      mode: opts.mode,
      recallAt1: recallAtK(ranks, 1),
      recallAt3: recallAtK(ranks, 3),
      recallAt5: recallAtK(ranks, 5),
      mrr: meanReciprocalRank(ranks),
      scoredQueries: ranks.length,
      noRelevantOk,
    },
    rows,
  }
}
