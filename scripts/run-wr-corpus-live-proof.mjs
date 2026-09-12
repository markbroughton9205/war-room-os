import { migrateExistingWrCorpus } from '../lib/wr-corpus/migrate.ts'
import { inspectProvenance, listWrCorpusVersions, queryWrCorpus } from '../lib/wr-corpus/query.ts'
import { ragFromWrCorpus } from '../lib/wr-corpus/rag.ts'
import { promoteApprovedCandidate } from '../lib/wr-corpus/promote.ts'
import { CorpusCandidateStore } from '../lib/ascension/integration/candidateStore.ts'
import { runKnowledgePipeline } from '../lib/ascension/integration/workflows.ts'

const owner = 'local-commander'
const migrated = await migrateExistingWrCorpus({})
const listed = listWrCorpusVersions()
const q0 = queryWrCorpus({ query: 'Wonderland', ownerUserId: owner, corpusVersion: 'WR-CORPUS-0' })
const q1 = queryWrCorpus({ query: 'CLAUDE.md', ownerUserId: owner, corpusVersion: 'WR-CORPUS-1' })
const rag = await ragFromWrCorpus({
  query: 'Who is Alice in the genesis corpus?',
  ownerUserId: owner,
})

const live = await runKnowledgePipeline({
  ownerUserId: owner,
  requestedBy: owner,
  topic: 'Public Digitraffic marine vessel API for Finnish waters',
  useFixtures: true,
  liveSearchAllowed: true,
  internetAvailable: true,
})

let promoted = null
if (live.candidate_ids[0]) {
  const store = new CorpusCandidateStore()
  store.setReviewState({
    candidateId: live.candidate_ids[0],
    ownerUserId: owner,
    reviewState: 'APPROVED_FOR_FUTURE_CORPUS',
  })
  store.close()
  promoted = await promoteApprovedCandidate({
    candidateId: live.candidate_ids[0],
    ownerUserId: owner,
    commanderApproval: true,
  })
}

const promoInspect = promoted ? inspectProvenance(promoted.record_id, owner) : null

console.log(JSON.stringify({
  migrated_bytes: migrated.bytesCopied,
  alreadyImported: migrated.alreadyImported,
  versions: listed.versions.map(v => ({ id: v.canonical_id, historical: v.historical_id, records: v.record_count })),
  query0: q0.lexical.slice(0, 2).map(h => ({ id: h.record_id, title: h.title })),
  query1: q1.lexical.slice(0, 2).map(h => ({ id: h.record_id, title: h.title })),
  rag: {
    model_ok: rag.model_ok,
    model: rag.model,
    intelligence_class: rag.intelligence_class,
    training: rag.training,
    weight_mutation: rag.weight_mutation,
    sources: rag.sources.map(s => ({ id: s.record_id, version: s.corpus_version, title: s.title })),
    answer: rag.answer ? rag.answer.slice(0, 800) : null,
    error: rag.error,
  },
  live_growth: {
    status: live.status,
    candidate_ids: live.candidate_ids,
    live_discovery: live.live_discovery,
    wr_corpus: live.wr_corpus,
    production_corpus_persisted: live.production_corpus_persisted,
    promoted,
    provenance: promoInspect
      ? {
          version: promoInspect.corpus_version,
          retrievedAt: promoInspect.provenance.retrievedAt,
          pipeline: promoInspect.provenance.pipeline,
          rights: promoInspect.rights,
          training_eligibility: promoInspect.training_eligibility,
          freshness: promoInspect.provenance.freshness ?? promoInspect.review_state,
        }
      : null,
  },
}, null, 2))

if (!migrated.ok || q0.lexical.length === 0 || q1.lexical.length === 0 || rag.sources.length === 0) {
  process.exitCode = 1
}
