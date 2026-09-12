/**
 * WR-CORPUS query: lexical + hashed-token semantic retrieval.
 * Does not require rewriting npy shards.
 */
import { cosine, embedText, WrCorpusStore, type CorpusRecordRow } from './store'
import { WrCorpusPolicyError } from './hashes'
import { CorpusCandidateStore } from '@/lib/ascension/integration/candidateStore'

export type WrCorpusQueryInput = {
  query: string
  ownerUserId: string
  corpusVersion?: string
  sourceType?: string
  rightsFilter?: string
  trainingEligibility?: string
  limit?: number
  dataDirOverride?: string | null
}

export type WrCorpusHit = CorpusRecordRow & { score: number; retrieval: 'lexical' | 'semantic' }

export function queryWrCorpus(input: WrCorpusQueryInput): {
  lexical: WrCorpusHit[]
  semantic: WrCorpusHit[]
} {
  if (!input.ownerUserId?.trim()) throw new WrCorpusPolicyError('OWNER_REQUIRED', 'Owner required.')
  const store = new WrCorpusStore(input.dataDirOverride)
  try {
    const lexical = store
      .lexicalSearch(input.query, {
        ownerUserId: input.ownerUserId,
        limit: input.limit ?? 8,
        corpusVersion: input.corpusVersion,
      })
      .filter(row => matchesFilters(row, input))
      .map(row => ({ ...row, score: 1, retrieval: 'lexical' as const }))

    const qv = embedText(input.query)
    const semantic = store
      .allActiveForSemantic(input.ownerUserId, input.corpusVersion)
      .filter(row => matchesFilters(row, input))
      .map(row => ({ ...row, score: cosine(qv, row.embedding), retrieval: 'semantic' as const }))
      .sort((a, b) => b.score - a.score)
      .slice(0, input.limit ?? 8)

    return { lexical, semantic }
  } finally {
    store.close()
  }
}

function matchesFilters(row: CorpusRecordRow, input: WrCorpusQueryInput): boolean {
  if (input.sourceType && row.source_type !== input.sourceType && row.title !== input.sourceType) return false
  if (input.trainingEligibility && row.training_eligibility !== input.trainingEligibility) return false
  if (input.rightsFilter === 'public_domain' && !row.rights.public_domain) return false
  if (input.rightsFilter === 'commander_owned' && !row.rights.commander_owned) return false
  if (input.rightsFilter === 'requires_review' && row.rights.review_state !== 'REQUIRES_REVIEW') return false
  return true
}

export function inspectProvenance(recordId: string, ownerUserId: string, dataDirOverride?: string | null): CorpusRecordRow {
  const store = new WrCorpusStore(dataDirOverride)
  try {
    const rec = store.getRecord(recordId)
    if (!rec) throw new WrCorpusPolicyError('NOT_FOUND', 'Record not found.')
    if (rec.owner_user_id !== ownerUserId && rec.owner_user_id !== 'SYSTEM_HISTORICAL_RECOVERY') {
      throw new WrCorpusPolicyError('OWNER_MISMATCH', 'Private corpus isolation preserved.')
    }
    return rec
  } finally {
    store.close()
  }
}

export function listWrCorpusVersions(dataDirOverride?: string | null) {
  const store = new WrCorpusStore(dataDirOverride)
  try {
    return {
      versions: store.listVersions(),
      artifactBytes: store.artifactBytes(),
      dbPath: store.dbPath,
      root: store.paths.root,
      tombstones: store.listTombstones().map(t => ({
        record_id: t.record_id,
        policy: t.policy,
        historical_source_preserved: t.historical_source_preserved === 1 || t.historical_source_preserved === true,
      })),
    }
  } finally {
    store.close()
  }
}

export function listCandidateReviewQueue(ownerUserId: string, dataDirOverride?: string | null) {
  const candidates = new CorpusCandidateStore(dataDirOverride)
  try {
    return candidates.listByOwner(ownerUserId).map(c => ({
      candidate_id: c.candidate_id,
      review_state: c.review_state,
      freshness: c.freshness,
      recommended_disposition: c.recommended_disposition,
      source_agent: c.source_agent,
    }))
  } finally {
    candidates.close()
  }
}
