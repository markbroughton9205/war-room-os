import { existsSync, statSync } from 'node:fs'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { SovereignCorpus } from '../crawler/corpus'
import { getSharedQueryEmbedder, resetSharedQueryEmbedder } from './embedder'
import { inspectLocalSemanticHealth } from './semanticHealth'
import { localOnnxModelPresent, resolveHybridPaths } from './modelStore'
import { PRODUCTION_RETRIEVAL_PROFILE } from './retrievalProfile'
import { searchLocalHybrid } from './retrieve'

type CaseResult = { name: string; pass: boolean; detail: string; proof: string }

function check(name: string, pass: boolean, detail: string, proof = 'LIVE'): CaseResult {
  return { name, pass, detail, proof }
}

const LIVE_QUERIES = [
  { id: 'A', query: 'RFC 2606' },
  { id: 'B', query: 'reserved DNS names' },
  { id: 'C', query: 'LIV Golf' },
  { id: 'D', query: 'reserved DNS names and LIV Golf' },
  { id: 'E', query: 'cash trouble for a gulf-backed breakaway golf circuit' },
  { id: 'F', query: 'antarctic penguin census 1994' },
  { id: 'G', query: 'protein domains in eukaryotic genomes' },
] as const

function isDnsFamily(title: string, url: string): boolean {
  return /RFC 2606|IANA|reserved/i.test(`${title} ${url}`) && /dns|domain|rfc-editor|iana/i.test(`${title} ${url}`)
}

function isLivFamily(title: string, url: string): boolean {
  return /LIV Golf/i.test(`${title} ${url}`) || /dw\.com.*liv-golf/i.test(url)
}

export async function runStage4dLiveAcceptance(): Promise<CaseResult[]> {
  const cases: CaseResult[] = []
  const paths = resolveHybridPaths()
  const corpus = new SovereignCorpus()
  try {
    const count = corpus.countDocuments()
    cases.push(check('live4d_01_corpus_present', count >= 1 && existsSync(paths.corpusDbPath), JSON.stringify({ count, db: paths.corpusDbPath })))
    if (count < 1) return cases

    const modelReady = localOnnxModelPresent(paths.localModelDir) || localOnnxModelPresent(paths.modelsDir)
    if (!modelReady) {
      cases.push(check('live4d_02_model_present', false, 'local ONNX model missing'))
      return cases
    }

    resetSharedQueryEmbedder()
    const embedder = getSharedQueryEmbedder()
    const reports: Array<Record<string, unknown>> = []

    for (const item of LIVE_QUERIES) {
      const strictStarted = Date.now()
      const strictRows = corpus.searchFtsLegacyStrict(item.query, 8)
      const strictMs = Date.now() - strictStarted
      const plannedStarted = Date.now()
      const planned = corpus.searchFtsWithPlan(item.query, 8)
      const plannedMs = Date.now() - plannedStarted
      const semantic = await searchLocalHybrid(item.query, { corpus, embedder, retrievalMode: 'semantic', limit: 5 })
      const hybrid = await searchLocalHybrid(item.query, { corpus, embedder, retrievalMode: 'hybrid', limit: 8 })
      const pack = {
        id: item.id,
        query: item.query,
        strictFts: strictRows.map(row => corpus.getById(row.documentId)?.title ?? row.documentId),
        strictCount: strictRows.length,
        strictMs,
        plannedFts: planned.rows.map(row => corpus.getById(row.documentId)?.title ?? row.documentId),
        plannedCount: planned.rows.length,
        plannedMs,
        planUsed: planned.plan.planUsed,
        relaxationApplied: planned.plan.relaxationApplied,
        strictCandidateCount: planned.plan.strictCandidateCount,
        relaxedCandidateCount: planned.plan.relaxedCandidateCount,
        termsUsed: planned.plan.termsUsed,
        phrasesUsed: planned.plan.phrasesUsed,
        semanticAdmission: {
          admitted: semantic.semanticAdmission.admitted,
          abstained: semantic.semanticAdmission.abstained,
          candidateScore: semantic.semanticAdmission.candidateScore,
          threshold: semantic.semanticAdmission.threshold,
        },
        semanticTop: semantic.hits.map(hit => hit.document.title),
        hybridTop: hybrid.hits.map(hit => ({
          title: hit.document.title,
          url: hit.document.canonicalUrl,
          lex: hit.lexicalRank,
          sem: hit.semanticRank,
        })),
        hybridMs: hybrid.durationMs,
        semanticMs: semantic.semanticQueryMs,
      }
      reports.push(pack)

      if (item.id === 'A') {
        cases.push(check(
          'live4d_A_rfc2606',
          hybrid.hits.some(hit => /RFC 2606/i.test(hit.document.title || '') && hit.lexicalRank != null)
            && planned.plan.planUsed === 'STRICT',
          JSON.stringify(pack),
        ))
      }
      if (item.id === 'B') {
        cases.push(check(
          'live4d_B_reserved_dns',
          planned.rows.length >= 1 && hybrid.hits.some(hit => /DNS|IANA|RFC 2606/i.test(hit.document.title || '')),
          JSON.stringify(pack),
        ))
      }
      if (item.id === 'C') {
        cases.push(check(
          'live4d_C_liv_golf',
          hybrid.hits.some(hit => /LIV Golf/i.test(hit.document.title || '')) && planned.plan.planUsed === 'STRICT',
          JSON.stringify(pack),
        ))
      }
      if (item.id === 'D') {
        const dnsHit = hybrid.hits.some(hit => isDnsFamily(hit.document.title || '', hit.document.canonicalUrl))
          || planned.rows.some(row => {
            const doc = corpus.getById(row.documentId)
            return doc ? isDnsFamily(doc.title || '', doc.canonicalUrl) : false
          })
        const livHit = hybrid.hits.some(hit => isLivFamily(hit.document.title || '', hit.document.canonicalUrl))
          || planned.rows.some(row => {
            const doc = corpus.getById(row.documentId)
            return doc ? isLivFamily(doc.title || '', doc.canonicalUrl) : false
          })
        cases.push(check(
          'live4d_D_mixed_both_topics',
          dnsHit && livHit && planned.plan.planUsed === 'RELAXED' && strictRows.length === 0,
          JSON.stringify({ ...pack, dnsHit, livHit }),
        ))
      }
      if (item.id === 'E') {
        cases.push(check(
          'live4d_E_liv_paraphrase',
          semantic.semanticAdmission.admitted === true
            && /LIV Golf/i.test(semantic.hits[0]?.document.title || '')
            && (semantic.semanticAdmission.candidateScore ?? 0) >= PRODUCTION_RETRIEVAL_PROFILE.semanticThreshold,
          JSON.stringify(pack),
        ))
      }
      if (item.id === 'F') {
        cases.push(check(
          'live4d_F_penguin_abstains',
          hybrid.hits.length === 0
            && hybrid.semanticAdmission.abstained === true
            && planned.rows.length === 0
            && strictRows.length === 0,
          JSON.stringify(pack),
        ))
      }
      if (item.id === 'G') {
        cases.push(check(
          'live4d_G_biology_abstains',
          hybrid.semanticAdmission.admitted === false
            && hybrid.hits.every(hit => hit.semanticRank == null)
            && planned.rows.length === 0,
          JSON.stringify(pack),
        ))
      }
    }

    const health = inspectLocalSemanticHealth({ queryResult: await searchLocalHybrid('antarctic penguin census 1994', { corpus, embedder, retrievalMode: 'hybrid', limit: 3 }) })
    cases.push(check(
      'live4d_08_gate_and_resources',
      PRODUCTION_RETRIEVAL_PROFILE.semanticThreshold === 0.61
        && PRODUCTION_RETRIEVAL_PROFILE.profileVersion === 'wr-retrieval-v4c.1'
        && health.status === 'available',
      JSON.stringify({
        profile: PRODUCTION_RETRIEVAL_PROFILE,
        health: health.status,
        vectorIndexBytes: existsSync(paths.vectorDbPath) ? statSync(paths.vectorDbPath).size : 0,
        reports,
      }),
    ))
  } finally {
    corpus.close()
  }
  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify({ host: os.hostname(), node: process.version, profile: PRODUCTION_RETRIEVAL_PROFILE }, null, 2))
  const results = await runStage4dLiveAcceptance()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} [${result.proof}] ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Sovereign search stage 4D live acceptance: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
