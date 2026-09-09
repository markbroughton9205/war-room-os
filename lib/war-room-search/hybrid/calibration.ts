import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { SovereignCorpus } from '../crawler/corpus'
import { EVAL_QUERIES, admissionMetricsFromDecisions, seedEvalCorpus, type EvalQuery } from './eval'
import { indexCorpusDocuments } from './indexCorpus'
import type { Embedder } from './types'
import { CHUNKING_VERSION } from './types'
import { SqliteVectorStore, searchVectors } from './vectors'

export type ScoreRow = {
  id: string
  query: string
  type: EvalQuery['type']
  expectedRelevant: boolean
  expectedCanonicalUrls: string[]
  top1Url: string | null
  top1Score: number | null
  top2Score: number | null
  margin: number | null
  top1Relevant: boolean
  lexicalHitCount: number
}

export type CandidateRule = {
  id: string
  strategy: 'min_cosine' | 'min_cosine_and_margin' | 'min_cosine_or_lexical'
  semanticThreshold: number
  semanticMarginThreshold: number | null
}

export type CandidateRuleReport = CandidateRule & {
  positiveRecall: number
  falsePositiveRateOnNegatives: number
  falseNegativeRateOnPositives: number
  trueNoHitRejectionRate: number
  admittedTop1Precision: number | null
}

function summarize(values: Array<number | null>): { n: number; min: number | null; max: number | null; mean: number | null; values: number[] } {
  const nums = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b)
  if (!nums.length) return { n: 0, min: null, max: null, mean: null, values: [] }
  return {
    n: nums.length,
    min: nums[0]!,
    max: nums[nums.length - 1]!,
    mean: nums.reduce((sum, value) => sum + value, 0) / nums.length,
    values: nums.map(value => Number(value.toFixed(6))),
  }
}

export async function collectScoreRows(opts: {
  corpus: SovereignCorpus
  store: SqliteVectorStore
  embedder: Embedder
  queries?: EvalQuery[]
}): Promise<ScoreRow[]> {
  const hashes = new Map(opts.corpus.listDocuments().map(doc => [doc.id, doc.contentHash]))
  const fresh = opts.store.listFreshEmbeddings({
    embeddingModel: opts.embedder.info.modelId,
    embeddingRevision: opts.embedder.info.revision,
    chunkingVersion: CHUNKING_VERSION,
    documentHashes: hashes,
  })
  const rows: ScoreRow[] = []
  for (const item of opts.queries ?? EVAL_QUERIES) {
    const [queryVector] = await opts.embedder.embed([item.query], 'query')
    const vectorSearch = queryVector && fresh.length
      ? searchVectors({ query: queryVector, embeddings: fresh, limit: 12 })
      : { hits: [] as Array<{ documentId: number; canonicalUrl: string; score: number }> }
    const bestByDoc = new Map<number, { canonicalUrl: string; score: number }>()
    for (const hit of vectorSearch.hits) {
      const current = bestByDoc.get(hit.documentId)
      if (!current || hit.score > current.score) bestByDoc.set(hit.documentId, { canonicalUrl: hit.canonicalUrl, score: hit.score })
    }
    const ranked = [...bestByDoc.values()].sort((a, b) => b.score - a.score)
    const top1 = ranked[0] ?? null
    const top2 = ranked[1] ?? null
    const lexicalHitCount = opts.corpus.searchFts(item.query, 8).length
    rows.push({
      id: item.id,
      query: item.query,
      type: item.type,
      expectedRelevant: item.expectedCanonicalUrls.length > 0,
      expectedCanonicalUrls: item.expectedCanonicalUrls,
      top1Url: top1?.canonicalUrl ?? null,
      top1Score: top1?.score ?? null,
      top2Score: top2?.score ?? null,
      margin: top1 && top2 ? top1.score - top2.score : top1?.score ?? null,
      top1Relevant: Boolean(top1 && item.expectedCanonicalUrls.includes(top1.canonicalUrl)),
      lexicalHitCount,
    })
  }
  return rows
}

export function decideAdmission(row: ScoreRow, rule: CandidateRule): string[] {
  if (row.top1Score == null || !row.top1Url) return []
  const margin = row.margin ?? 0
  if (rule.strategy === 'min_cosine') {
    return row.top1Score >= rule.semanticThreshold ? [row.top1Url] : []
  }
  if (rule.strategy === 'min_cosine_and_margin') {
    const marginOk = rule.semanticMarginThreshold == null || margin >= rule.semanticMarginThreshold
    return row.top1Score >= rule.semanticThreshold && marginOk ? [row.top1Url] : []
  }
  if (row.top1Score >= rule.semanticThreshold) return [row.top1Url]
  if (row.lexicalHitCount > 0 && row.top1Relevant) return [row.top1Url]
  return []
}

export function evaluateRule(rows: ScoreRow[], rule: CandidateRule): CandidateRuleReport {
  const decisions = rows.map(row => ({
    expectedCanonicalUrls: row.expectedCanonicalUrls,
    admittedUrls: decideAdmission(row, rule),
  }))
  const admission = admissionMetricsFromDecisions(decisions)
  const positives = rows.filter(row => row.expectedRelevant)
  const recalled = positives.filter(row => {
    const admitted = decideAdmission(row, rule)
    return row.expectedCanonicalUrls.some(url => admitted.includes(url) || (row.top1Relevant && admitted.includes(row.top1Url!)))
  }).length
  return {
    ...rule,
    positiveRecall: positives.length ? recalled / positives.length : 0,
    falsePositiveRateOnNegatives: admission.falsePositiveRateOnNegatives,
    falseNegativeRateOnPositives: admission.falseNegativeRateOnPositives,
    trueNoHitRejectionRate: admission.trueNoHitRejectionRate,
    admittedTop1Precision: admission.admittedTop1Precision,
  }
}

export function candidateRulesFromDistribution(rows: ScoreRow[]): CandidateRule[] {
  const positiveScores = rows.filter(row => row.expectedRelevant && row.top1Relevant).map(row => row.top1Score).filter((value): value is number => value != null)
  const negativeScores = rows.filter(row => !row.expectedRelevant).map(row => row.top1Score).filter((value): value is number => value != null)
  const minPositive = positiveScores.length ? Math.min(...positiveScores) : 0.7
  const maxNegative = negativeScores.length ? Math.max(...negativeScores) : 0.3
  const midpoint = (minPositive + maxNegative) / 2
  const justAboveNegative = maxNegative + 0.01
  const justBelowPositive = minPositive - 0.01
  const unique = new Set<string>()
  const rules: CandidateRule[] = []
  const add = (rule: CandidateRule) => {
    const key = `${rule.strategy}:${rule.semanticThreshold}:${rule.semanticMarginThreshold}`
    if (unique.has(key)) return
    unique.add(key)
    rules.push(rule)
  }
  for (const threshold of [maxNegative, justAboveNegative, midpoint, justBelowPositive, minPositive]) {
    const rounded = Number(Math.max(0, Math.min(1, threshold)).toFixed(4))
    add({ id: `A_t${rounded}`, strategy: 'min_cosine', semanticThreshold: rounded, semanticMarginThreshold: null })
    add({ id: `B_t${rounded}_m0.02`, strategy: 'min_cosine_and_margin', semanticThreshold: rounded, semanticMarginThreshold: 0.02 })
    add({ id: `B_t${rounded}_m0.05`, strategy: 'min_cosine_and_margin', semanticThreshold: rounded, semanticMarginThreshold: 0.05 })
    add({ id: `C_t${rounded}`, strategy: 'min_cosine_or_lexical', semanticThreshold: rounded, semanticMarginThreshold: null })
  }
  return rules
}

export function selectRule(reports: CandidateRuleReport[]): CandidateRuleReport | null {
  const separating = reports.filter(report => report.falsePositiveRateOnNegatives === 0 && report.falseNegativeRateOnPositives === 0)
  const pool = separating.length ? separating : reports.filter(report => report.falsePositiveRateOnNegatives === 0)
  if (!pool.length) return null
  return [...pool].sort((a, b) => {
    if (b.positiveRecall !== a.positiveRecall) return b.positiveRecall - a.positiveRecall
    if (a.falseNegativeRateOnPositives !== b.falseNegativeRateOnPositives) return a.falseNegativeRateOnPositives - b.falseNegativeRateOnPositives
    if (a.semanticThreshold !== b.semanticThreshold) return a.semanticThreshold - b.semanticThreshold
    const aMargin = a.semanticMarginThreshold ?? 0
    const bMargin = b.semanticMarginThreshold ?? 0
    if (aMargin !== bMargin) return aMargin - bMargin
    return a.strategy.localeCompare(b.strategy)
  })[0] ?? null
}

export function distributionReport(rows: ScoreRow[]) {
  const positives = rows.filter(row => row.expectedRelevant)
  const negatives = rows.filter(row => !row.expectedRelevant)
  return {
    positiveTop1: summarize(positives.map(row => row.top1Score)),
    positiveRelevantTop1: summarize(positives.filter(row => row.top1Relevant).map(row => row.top1Score)),
    negativeTop1: summarize(negatives.map(row => row.top1Score)),
    positiveMargin: summarize(positives.map(row => row.margin)),
    negativeMargin: summarize(negatives.map(row => row.margin)),
    positiveTop2: summarize(positives.map(row => row.top2Score)),
    negativeTop2: summarize(negatives.map(row => row.top2Score)),
    rows: rows.map(row => ({
      id: row.id,
      type: row.type,
      expectedRelevant: row.expectedRelevant,
      top1Score: row.top1Score == null ? null : Number(row.top1Score.toFixed(6)),
      top2Score: row.top2Score == null ? null : Number(row.top2Score.toFixed(6)),
      margin: row.margin == null ? null : Number(row.margin.toFixed(6)),
      top1Relevant: row.top1Relevant,
      lexicalHitCount: row.lexicalHitCount,
    })),
  }
}

export async function calibrateFixtureCorpus(embedder: Embedder): Promise<{
  rows: ScoreRow[]
  distribution: ReturnType<typeof distributionReport>
  candidates: CandidateRuleReport[]
  selected: CandidateRuleReport | null
}> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'wr-stage4c-cal-'))
  const corpus = new SovereignCorpus(tmp)
  const store = new SqliteVectorStore(path.join(tmp, 'vectors.sqlite'))
  try {
    seedEvalCorpus(corpus)
    await indexCorpusDocuments({ corpus, store, embedder })
    const rows = await collectScoreRows({ corpus, store, embedder })
    const candidates = candidateRulesFromDistribution(rows).map(rule => evaluateRule(rows, rule))
    return {
      rows,
      distribution: distributionReport(rows),
      candidates,
      selected: selectRule(candidates),
    }
  } finally {
    store.close()
    corpus.close()
  }
}

export const LIVE_CALIBRATION_QUERIES: EvalQuery[] = [
  {
    id: 'live_exact_rfc',
    query: 'RFC 2606',
    type: 'EXACT_LEXICAL',
    expectedCanonicalUrls: ['https://rfc-editor.org/info/rfc2606'],
    notes: 'Live corpus RFC 2606 page.',
  },
  {
    id: 'live_paraphrase_liv',
    query: 'cash trouble for a gulf-backed breakaway golf circuit',
    type: 'PARAPHRASE',
    expectedCanonicalUrls: ['https://dw.com/en/liv-golf-in-financial-turmoil-whats-next-for-the-sport/a-79199569'],
    notes: 'Live corpus LIV Golf article.',
  },
  {
    id: 'live_mixed',
    query: 'reserved DNS names and LIV Golf',
    type: 'MIXED_TOPIC',
    expectedCanonicalUrls: [
      'https://rfc-editor.org/info/rfc2606',
      'https://iana.org/domains/reserved',
      'https://dw.com/en/liv-golf-in-financial-turmoil-whats-next-for-the-sport/a-79199569',
    ],
    notes: 'Mixed live query. FTS ANDs tokens and may return no lexical hit.',
  },
  {
    id: 'live_penguin',
    query: 'antarctic penguin census 1994',
    type: 'NO_RELEVANT_DOCUMENT',
    expectedCanonicalUrls: [],
    notes: 'No live document is about a 1994 Antarctic penguin census.',
  },
  {
    id: 'live_golf_equipment',
    query: 'graphite golf club shafts for amateur players',
    type: 'HARD_NEGATIVE',
    expectedCanonicalUrls: [],
    notes: 'Golf equipment, not LIV business reporting.',
  },
  {
    id: 'live_industrial',
    query: 'factory PLC industrial process controls for a chemical plant',
    type: 'HARD_NEGATIVE',
    expectedCanonicalUrls: [],
    notes: 'Industrial controls, not semiconductor export controls.',
  },
  {
    id: 'live_biology',
    query: 'protein domains in eukaryotic genomes',
    type: 'HARD_NEGATIVE',
    expectedCanonicalUrls: [],
    notes: 'Biology domains, not DNS domains.',
  },
]

export async function calibrateLiveCorpus(embedder: Embedder): Promise<{
  rows: ScoreRow[]
  distribution: ReturnType<typeof distributionReport>
  candidates: CandidateRuleReport[]
  selected: CandidateRuleReport | null
} | null> {
  const corpus = new SovereignCorpus()
  try {
    if (corpus.countDocuments() < 1) return null
    const store = SqliteVectorStore.tryOpen(path.join(corpus.paths.rootDir, 'vectors.sqlite'))
    if (store === 'missing' || store === 'corrupt') return null
    try {
      const rows = await collectScoreRows({ corpus, store, embedder, queries: LIVE_CALIBRATION_QUERIES })
      const candidates = candidateRulesFromDistribution(rows).map(rule => evaluateRule(rows, rule))
      return { rows, distribution: distributionReport(rows), candidates, selected: selectRule(candidates) }
    } finally {
      store.close()
    }
  } finally {
    corpus.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { createQueryEmbedder, getSharedQueryEmbedder, resetSharedQueryEmbedder } = await import('./embedder')
  resetSharedQueryEmbedder()
  const embedder = getSharedQueryEmbedder()
  if (!embedder.available) {
    console.error('Real ONNX embedder unavailable; cannot calibrate Stage 4C.')
    process.exit(1)
  }
  const fixture = await calibrateFixtureCorpus(embedder)
  const live = await calibrateLiveCorpus(embedder)
  console.log(JSON.stringify({
    model: embedder.info,
    fixture: {
      selected: fixture.selected,
      distribution: fixture.distribution,
      candidates: fixture.candidates,
    },
    live: live && {
      selected: live.selected,
      distribution: live.distribution,
      candidates: live.candidates,
    },
  }, null, 2))
  void createQueryEmbedder
}
