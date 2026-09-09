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
  'HARD_NEGATIVE',
  'NO_RELEVANT_DOCUMENT',
  'MIXED_TOPIC',
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
  {
    url: 'https://dw.com/en/liv-golf-fixture',
    title: 'LIV Golf in financial turmoil',
    publisher: 'dw.com',
    text: 'LIV Golf is in financial turmoil after Saudi Arabia pulled back from the gulf-backed breakaway golf circuit and its remaining events faced cash trouble.',
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
    id: 'paraphrase_liv',
    query: 'cash trouble for a gulf-backed breakaway golf circuit',
    type: 'PARAPHRASE',
    expectedCanonicalUrls: ['https://dw.com/en/liv-golf-fixture'],
    notes: 'Paraphrase of the LIV Golf fixture. Relevant because the fixture is about that circuit\'s cash trouble, not because the query contains the token golf.',
  },
  {
    id: 'mixed_topic',
    query: 'reserved DNS names and LIV Golf',
    type: 'MIXED_TOPIC',
    expectedCanonicalUrls: ['https://iana.org/domains/reserved', 'https://dw.com/en/liv-golf-fixture'],
    notes: 'Two relevant fixtures. Stage 4 FTS ANDs tokens so this query may have no lexical hit; labels remain from fixture contents.',
  },
  {
    id: 'no_relevant',
    query: 'antarctic penguin census 1994',
    type: 'NO_RELEVANT_DOCUMENT',
    expectedCanonicalUrls: [],
    notes: 'No fixture document is about penguins, Antarctica, or a 1994 census.',
  },
  {
    id: 'no_relevant_finance',
    query: 'municipal bond yield curve inversion 1987',
    type: 'NO_RELEVANT_DOCUMENT',
    expectedCanonicalUrls: [],
    notes: 'No fixture is about municipal bonds, yield curves, or 1987 finance.',
  },
  {
    id: 'no_relevant_sports',
    query: 'olympic curling medal count 2010',
    type: 'NO_RELEVANT_DOCUMENT',
    expectedCanonicalUrls: [],
    notes: 'No fixture is about Olympic curling. LIV Golf is business reporting, not this sporting event.',
  },
  {
    id: 'no_relevant_geo',
    query: 'kalahari desert nomadic pastoral routes 1962',
    type: 'NO_RELEVANT_DOCUMENT',
    expectedCanonicalUrls: [],
    notes: 'No fixture is about the Kalahari, nomadic pastoralism, or 1962 geography.',
  },
  {
    id: 'hard_negative_industrial',
    query: 'factory PLC industrial process controls for a chemical plant',
    type: 'HARD_NEGATIVE',
    expectedCanonicalUrls: [],
    notes: 'Mentions controls but refers to industrial process hardware. The chip-export fixture is about semiconductor export controls, not PLC hardware.',
  },
  {
    id: 'hard_negative_biology',
    query: 'protein domains in eukaryotic genomes',
    type: 'HARD_NEGATIVE',
    expectedCanonicalUrls: [],
    notes: 'Mentions domains in a biology sense. The IANA fixture is about reserved DNS domains, not protein domains.',
  },
  {
    id: 'hard_negative_golf_equipment',
    query: 'graphite golf club shafts for amateur players',
    type: 'HARD_NEGATIVE',
    expectedCanonicalUrls: [],
    notes: 'Mentions golf equipment. The LIV fixture is business reporting about a breakaway circuit, not clubs or shafts.',
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
  trueNoHitRejectionRate: number | null
  falsePositiveRateOnNegatives: number | null
  falseNegativeRateOnPositives: number | null
  admittedTop1Precision: number | null
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

export function isPositiveEvalQuery(item: EvalQuery): boolean {
  return item.expectedCanonicalUrls.length > 0
}

export type AdmissionMetrics = {
  trueNoHitRejectionRate: number
  falsePositiveRateOnNegatives: number
  falseNegativeRateOnPositives: number
  admittedTop1Precision: number | null
  positiveCount: number
  negativeCount: number
}

export function admissionMetricsFromDecisions(rows: Array<{
  expectedCanonicalUrls: string[]
  admittedUrls: string[]
}>): AdmissionMetrics {
  const positives = rows.filter(row => row.expectedCanonicalUrls.length > 0)
  const negatives = rows.filter(row => row.expectedCanonicalUrls.length === 0)
  const trueRejects = negatives.filter(row => row.admittedUrls.length === 0).length
  const falsePositives = negatives.filter(row => row.admittedUrls.length > 0).length
  const falseNegatives = positives.filter(row => !row.expectedCanonicalUrls.some(url => row.admittedUrls.includes(url))).length
  const admittedPositives = positives.filter(row => row.admittedUrls.length > 0)
  const precise = admittedPositives.filter(row => row.expectedCanonicalUrls.includes(row.admittedUrls[0]!)).length
  return {
    trueNoHitRejectionRate: negatives.length ? trueRejects / negatives.length : 0,
    falsePositiveRateOnNegatives: negatives.length ? falsePositives / negatives.length : 0,
    falseNegativeRateOnPositives: positives.length ? falseNegatives / positives.length : 0,
    admittedTop1Precision: admittedPositives.length ? precise / admittedPositives.length : null,
    positiveCount: positives.length,
    negativeCount: negatives.length,
  }
}

export async function evaluateRetrievalMode(opts: {
  corpus: SovereignCorpus
  embedder: Embedder
  store?: import('./vectors').SqliteVectorStore
  mode: HybridRetrievalMode
}): Promise<{ metrics: ModeMetrics; rows: Array<{ id: string; query: string; type: EvalQueryType; top: string[]; rank: number | null; admitted: boolean }> }> {
  const topical = EVAL_QUERIES.filter(isPositiveEvalQuery)
  const ranks: Array<number | null> = []
  const rows: Array<{ id: string; query: string; type: EvalQueryType; top: string[]; rank: number | null; admitted: boolean }> = []
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
    rows.push({ id: item.id, query: item.query, type: item.type, top, rank, admitted: top.length > 0 })
  }

  const negatives = EVAL_QUERIES.filter(item => !isPositiveEvalQuery(item))
  const negativeDecisions: Array<{ expectedCanonicalUrls: string[]; admittedUrls: string[] }> = []
  let noRelevantOk: boolean | null = null
  for (const item of negatives) {
    const result = await searchLocalHybrid(item.query, {
      corpus: opts.corpus,
      embedder: opts.embedder,
      store: opts.store,
      retrievalMode: opts.mode === 'fts' ? 'fts' : opts.mode,
      limit: 8,
    })
    const admittedUrls = result.hits.map(hit => hit.document.canonicalUrl)
    negativeDecisions.push({ expectedCanonicalUrls: [], admittedUrls })
    if (item.id === 'no_relevant' && opts.mode === 'fts') noRelevantOk = admittedUrls.length === 0
    rows.push({
      id: item.id,
      query: item.query,
      type: item.type,
      top: admittedUrls,
      rank: null,
      admitted: admittedUrls.length > 0,
    })
  }

  const decisions = [
    ...rows.filter(row => EVAL_QUERIES.find(item => item.id === row.id)?.expectedCanonicalUrls.length).map(row => ({
      expectedCanonicalUrls: EVAL_QUERIES.find(item => item.id === row.id)!.expectedCanonicalUrls,
      admittedUrls: row.top,
    })),
    ...negativeDecisions,
  ]
  const admission = admissionMetricsFromDecisions(decisions)

  return {
    metrics: {
      mode: opts.mode,
      recallAt1: recallAtK(ranks, 1),
      recallAt3: recallAtK(ranks, 3),
      recallAt5: recallAtK(ranks, 5),
      mrr: meanReciprocalRank(ranks),
      scoredQueries: ranks.length,
      noRelevantOk,
      trueNoHitRejectionRate: admission.trueNoHitRejectionRate,
      falsePositiveRateOnNegatives: admission.falsePositiveRateOnNegatives,
      falseNegativeRateOnPositives: admission.falseNegativeRateOnPositives,
      admittedTop1Precision: admission.admittedTop1Precision,
    },
    rows,
  }
}
