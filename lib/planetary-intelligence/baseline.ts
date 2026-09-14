import { createHash } from 'node:crypto'
import { canonicalizeUrl } from '@/lib/intelligence/canonicalUrl'
import { FIRST_PASS_DISCOVERY_SEATS, type DivergentProtocolSeat } from './identity'
import type {
  BaselineSnapshot,
  LedgerClaim,
  OverlapMetrics,
  RetrievedDocument,
  RootCauseClass,
  SeatOverlapRecord,
} from './types'

function jaccard(a: string[], b: string[]): number {
  const left = new Set(a.filter(Boolean))
  const right = new Set(b.filter(Boolean))
  if (!left.size && !right.size) return 1
  let inter = 0
  for (const value of left) if (right.has(value)) inter += 1
  const union = left.size + right.size - inter
  return union === 0 ? 0 : inter / union
}

function entropy(counts: number[]): number {
  const total = counts.reduce((sum, n) => sum + n, 0)
  if (total <= 0) return 0
  let h = 0
  for (const n of counts) {
    if (n <= 0) continue
    const p = n / total
    h -= p * Math.log2(p)
  }
  return h
}

function tokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(token => token.length > 3),
  )
}

export function lexicalClaimSimilarity(a: string, b: string): number {
  const left = tokenSet(a)
  const right = tokenSet(b)
  if (!left.size && !right.size) return 1
  let inter = 0
  for (const token of left) if (right.has(token)) inter += 1
  const union = left.size + right.size - inter
  return union === 0 ? 0 : inter / union
}

/**
 * Effective rank = exp(Shannon entropy of independent-origin mass).
 * Distinct-n / lexical variation is rejected as a primary intelligence metric.
 */
export function effectiveRank(originWeights: Record<string, number>): number {
  const values = Object.values(originWeights).filter(n => n > 0)
  if (!values.length) return 0
  return 2 ** entropy(values)
}

export function pairwiseOverlap(a: SeatOverlapRecord, b: SeatOverlapRecord): OverlapMetrics {
  const urlJaccard = jaccard(a.retrievedUrls, b.retrievedUrls)
  const canonicalSourceOverlap = jaccard(a.canonicalUrls, b.canonicalUrls)
  const evidenceOriginOverlap = jaccard(a.sourceOrigins, b.sourceOrigins)
  const claimOverlap = jaccard(a.claimClusters, b.claimClusters)
  const origins = [...a.sourceOrigins, ...b.sourceOrigins]
  const originWeights: Record<string, number> = {}
  for (const origin of origins) originWeights[origin] = (originWeights[origin] ?? 0) + 1
  const uniqueOrigins = new Set(origins.filter(Boolean)).size
  const urlCount = new Set([...a.retrievedUrls, ...b.retrievedUrls]).size
  const geo: Record<string, number> = {}
  const topic: Record<string, number> = {}
  return {
    urlJaccard,
    canonicalSourceOverlap,
    evidenceOriginOverlap,
    claimOverlap,
    reportEmbeddingSimilarity: lexicalClaimSimilarity(a.finalResponse, b.finalResponse),
    geographicDistribution: geo,
    topicDistribution: topic,
    effectiveRank: effectiveRank(originWeights),
    independentOriginRatio: urlCount === 0 ? 0 : uniqueOrigins / urlCount,
    duplicateDocumentRatio: urlCount === 0 ? 0 : 1 - (new Set([...a.canonicalUrls, ...b.canonicalUrls]).size / Math.max(1, urlCount)),
    agentAgreement: 2,
    independentOrigins: uniqueOrigins,
    urlCount,
  }
}

export function aggregateOverlap(seats: SeatOverlapRecord[]): OverlapMetrics {
  if (seats.length < 2) {
    const urls = new Set(seats.flatMap(seat => seat.retrievedUrls))
    const origins = new Set(seats.flatMap(seat => seat.sourceOrigins.filter(Boolean)))
    return {
      urlJaccard: 0,
      canonicalSourceOverlap: 0,
      evidenceOriginOverlap: 0,
      claimOverlap: 0,
      reportEmbeddingSimilarity: null,
      geographicDistribution: {},
      topicDistribution: {},
      effectiveRank: effectiveRank(Object.fromEntries([...origins].map(origin => [origin, 1]))),
      independentOriginRatio: urls.size === 0 ? 0 : origins.size / urls.size,
      duplicateDocumentRatio: 0,
      agentAgreement: seats.length,
      independentOrigins: origins.size,
      urlCount: urls.size,
    }
  }
  const pairs: OverlapMetrics[] = []
  for (let i = 0; i < seats.length; i += 1) {
    for (let j = i + 1; j < seats.length; j += 1) {
      pairs.push(pairwiseOverlap(seats[i]!, seats[j]!))
    }
  }
  const mean = (pick: (row: OverlapMetrics) => number) => pairs.reduce((sum, row) => sum + pick(row), 0) / pairs.length
  const allUrls = new Set(seats.flatMap(seat => seat.retrievedUrls))
  const allOrigins = new Set(seats.flatMap(seat => seat.sourceOrigins.filter(Boolean)))
  const originWeights: Record<string, number> = {}
  for (const seat of seats) for (const origin of seat.sourceOrigins) originWeights[origin] = (originWeights[origin] ?? 0) + 1
  return {
    urlJaccard: mean(row => row.urlJaccard),
    canonicalSourceOverlap: mean(row => row.canonicalSourceOverlap),
    evidenceOriginOverlap: mean(row => row.evidenceOriginOverlap),
    claimOverlap: mean(row => row.claimOverlap),
    reportEmbeddingSimilarity: mean(row => row.reportEmbeddingSimilarity ?? 0),
    geographicDistribution: {},
    topicDistribution: {},
    effectiveRank: effectiveRank(originWeights),
    independentOriginRatio: allUrls.size === 0 ? 0 : allOrigins.size / allUrls.size,
    duplicateDocumentRatio: mean(row => row.duplicateDocumentRatio),
    agentAgreement: seats.length,
    independentOrigins: allOrigins.size,
    urlCount: allUrls.size,
  }
}

export function classifyRootCauses(metrics: OverlapMetrics, seats: SeatOverlapRecord[]): RootCauseClass[] {
  const causes: RootCauseClass[] = []
  if (metrics.urlJaccard >= 0.45 || metrics.canonicalSourceOverlap >= 0.5) {
    causes.push('RETRIEVAL_CONVERGENCE_CONFIRMED')
  }
  const queries = seats.map(seat => seat.generatedQuery.replace(/^[A-Z]+ [^:]+:\s*/i, '').toLowerCase())
  const queryJaccardPairs: number[] = []
  for (let i = 0; i < queries.length; i += 1) {
    for (let j = i + 1; j < queries.length; j += 1) {
      queryJaccardPairs.push(jaccard(queries[i]!.split(/\s+/), queries[j]!.split(/\s+/)))
    }
  }
  const queryMean = queryJaccardPairs.length ? queryJaccardPairs.reduce((a, b) => a + b, 0) / queryJaccardPairs.length : 0
  if (queryMean >= 0.55 && metrics.reportEmbeddingSimilarity !== null && metrics.reportEmbeddingSimilarity >= 0.45) {
    causes.push('SHARED_BACKEND_REPRESENTATIONAL_CONVERGENCE')
  }
  if (metrics.independentOriginRatio < 0.6 && metrics.urlCount > metrics.independentOrigins) {
    causes.push('SYNDICATION_FALSE_CONSENSUS')
  }
  return causes
}

export function seatRecordFromDocuments(input: {
  seat: DivergentProtocolSeat
  query: string
  queryLanguage: string
  provider: string
  documents: RetrievedDocument[]
  claims: LedgerClaim[]
  finalResponse: string
}): SeatOverlapRecord {
  return {
    seat: input.seat,
    generatedQuery: input.query,
    queryLanguage: input.queryLanguage,
    retrievalProvider: input.provider,
    retrievedUrls: input.documents.map(doc => doc.url),
    canonicalUrls: input.documents.map(doc => doc.canonicalUrl || canonicalizeUrl(doc.url) || doc.url),
    publishers: input.documents.map(doc => doc.publisher),
    outlets: input.documents.map(doc => doc.outlet),
    sourceOrigins: input.documents.map(doc => doc.independentOriginId || doc.sourceOriginId || doc.publisher),
    storyClusters: [...new Set(input.documents.map(doc => doc.contentHash))],
    claimClusters: input.claims.map(claim => claim.normalizedClaim),
    finalResponse: input.finalResponse,
  }
}

/**
 * Current-failure fixture: several seats receive the same broad query → similar ranking
 * → overlapping Reuters-origin URLs worded differently. This is the pre-redesign baseline.
 */
export function currentSharedPacketBaseline(query: string, nowIso = new Date().toISOString()): BaselineSnapshot {
  const sharedUrls = [
    'https://www.reuters.com/world/breaking-story-today?utm_source=news',
    'https://apnews.com/article/breaking-story-today',
    'https://www.bbc.com/news/world-breaking-story-today',
    'https://www.nytimes.com/world/breaking-story-today',
  ]
  const sharedOrigin = 'reuters_wire'
  const seats: SeatOverlapRecord[] = FIRST_PASS_DISCOVERY_SEATS.map((seat, index) => ({
    seat,
    generatedQuery: index === 0
      ? `${query} current news this week live reporting`
      : index === 1
        ? `${query} latest developments`
        : `${query} what happened today`,
    queryLanguage: 'en',
    retrievalProvider: 'tavily',
    retrievedUrls: sharedUrls,
    canonicalUrls: sharedUrls.map(url => canonicalizeUrl(url) || url),
    publishers: ['Reuters', 'Associated Press', 'BBC', 'The New York Times'],
    outlets: ['Reuters', 'AP', 'BBC News', 'NYT'],
    sourceOrigins: [sharedOrigin, sharedOrigin, sharedOrigin, sharedOrigin],
    storyClusters: ['cluster-reuters-breaking'],
    claimClusters: ['a major international event was reported today'],
    finalResponse: `${seat} notes that major outlets report the same breaking international event today.`,
  }))
  const aggregate = aggregateOverlap(seats)
  const pairwise: Record<string, OverlapMetrics> = {}
  for (let i = 0; i < seats.length; i += 1) {
    for (let j = i + 1; j < seats.length; j += 1) {
      pairwise[`${seats[i]!.seat}:${seats[j]!.seat}`] = pairwiseOverlap(seats[i]!, seats[j]!)
    }
  }
  return {
    query,
    recordedAt: nowIso,
    seats,
    pairwise,
    aggregate,
    rootCauses: classifyRootCauses(aggregate, seats),
    notes: [
      'Baseline captured from the current shared-packet / similar-query failure mode.',
      'Do not declare later success without comparing against this snapshot.',
      'distinct-n is not used as a primary intelligence metric.',
    ],
  }
}

export function snapshotHash(snapshot: BaselineSnapshot): string {
  return createHash('sha256').update(JSON.stringify({
    query: snapshot.query,
    seats: snapshot.seats.map(seat => ({
      seat: seat.seat,
      query: seat.generatedQuery,
      urls: seat.retrievedUrls,
      origins: seat.sourceOrigins,
    })),
    aggregate: snapshot.aggregate,
  })).digest('hex')
}

export function overlapImproved(before: OverlapMetrics, after: OverlapMetrics): boolean {
  return after.urlJaccard < before.urlJaccard
    && after.independentOriginRatio > before.independentOriginRatio
    && after.effectiveRank >= before.effectiveRank
}
