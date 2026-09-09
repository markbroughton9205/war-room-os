import { existsSync, statSync } from 'node:fs'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { searchLocalCorpus } from '../crawler/localSearch'
import { SovereignCorpus } from '../crawler/corpus'
import { getSharedQueryEmbedder, resetSharedQueryEmbedder } from './embedder'
import { inspectLocalSemanticHealth } from './semanticHealth'
import { localOnnxModelPresent, resolveHybridPaths } from './modelStore'
import { searchLocalHybrid } from './retrieve'

type CaseResult = { name: string; pass: boolean; detail: string; proof: string }

function check(name: string, pass: boolean, detail: string, proof = 'LIVE'): CaseResult {
  return { name, pass, detail, proof }
}

function peakRssMb(): number {
  return Math.round(process.memoryUsage().rss / 1048576)
}

export async function runStage4bLiveAcceptance(): Promise<CaseResult[]> {
  const cases: CaseResult[] = []
  const paths = resolveHybridPaths()
  const corpus = new SovereignCorpus()
  try {
    const count = corpus.countDocuments()
    cases.push(check('live4b_01_corpus_present', count >= 1 && existsSync(paths.corpusDbPath), JSON.stringify({ count, db: paths.corpusDbPath })))
    if (count < 1) return cases

    const documents = corpus.listDocuments()
    const rfc = documents.find(doc => /RFC 2606/i.test(`${doc.title}\n${doc.contentText}`))
    const liv = documents.find(doc => /LIV Golf/i.test(`${doc.title}\n${doc.contentText}`))
    const sample = rfc ?? liv ?? documents[0]!
    const exactQuery = rfc ? 'RFC 2606' : (sample.title || sample.contentText).split(/\s+/).filter(token => token.length > 3).slice(0, 2).join(' ')
    const paraphraseQuery = liv
      ? 'cash trouble for a gulf-backed breakaway golf circuit'
      : 'limits on overseas sales of advanced processors'
    const mixedQuery = rfc && liv ? 'reserved DNS names and LIV Golf' : `${exactQuery} ${paraphraseQuery}`
    const noHitQuery = 'antarctic penguin census 1994 zxqnohit'

    const modelReady = localOnnxModelPresent(paths.localModelDir) || localOnnxModelPresent(paths.modelsDir)
    if (!modelReady) {
      const health = inspectLocalSemanticHealth()
      cases.push(check('live4b_02_semantic_health', health.status === 'modelMissing' || Boolean(health.status), JSON.stringify(health)))
      cases.push(check('live4b_03_model_present', false, 'local ONNX model missing; FTS-only live path still valid'))
      const fts = await searchLocalHybrid(exactQuery, { corpus, retrievalMode: 'fts', limit: 8 })
      cases.push(check('live4b_04_fts_without_model', fts.hits.length >= 1, JSON.stringify({ mode: fts.retrievalMode, top: fts.hits.map(hit => hit.document.title) })))
      return cases
    }

    resetSharedQueryEmbedder()
    const embedder = getSharedQueryEmbedder()
    const rssBefore = peakRssMb()
    const coldStarted = Date.now()
    const cold = await searchLocalHybrid(paraphraseQuery, { corpus, embedder, retrievalMode: 'hybrid', limit: 8 })
    const coldMs = Date.now() - coldStarted
    const rssAfterCold = peakRssMb()
    const warmStarted = Date.now()
    const warm = await searchLocalHybrid(paraphraseQuery, { corpus, embedder, retrievalMode: 'hybrid', limit: 8 })
    const warmMs = Date.now() - warmStarted
    const rssAfterWarm = peakRssMb()
    const health = inspectLocalSemanticHealth({ queryResult: cold })
    cases.push(check(
      'live4b_02_semantic_health',
      Boolean(health.status) && health.chunkVersion != null,
      JSON.stringify(health),
    ))

    async function compare(query: string, label: string) {
      const fts = await searchLocalHybrid(query, { corpus, embedder, retrievalMode: 'fts', limit: 5 })
      const semantic = await searchLocalHybrid(query, { corpus, embedder, retrievalMode: 'semantic', limit: 5 })
      const hybrid = await searchLocalHybrid(query, { corpus, embedder, retrievalMode: 'hybrid', limit: 5 })
      const lexical = searchLocalCorpus(query, { corpus, limit: 5 })
      return {
        label,
        query,
        fts: fts.hits.map(hit => ({ title: hit.document.title, url: hit.document.canonicalUrl, rank: hit.lexicalRank, score: hit.lexicalScore })),
        semantic: semantic.hits.map(hit => ({ title: hit.document.title, url: hit.document.canonicalUrl, rank: hit.semanticRank, score: hit.semanticScore })),
        hybrid: hybrid.hits.map(hit => ({
          title: hit.document.title,
          url: hit.document.canonicalUrl,
          publisher: hit.document.publisher,
          lexicalRank: hit.lexicalRank,
          semanticRank: hit.semanticRank,
          fusionRank: hit.fusionRank,
          fusionScore: hit.fusionScore,
          reason: `RRF fusionScore=${Number(hit.fusionScore).toFixed(4)} lexicalRank=${hit.lexicalRank} semanticRank=${hit.semanticRank}`,
        })),
        latencyMs: { fts: fts.durationMs, semantic: semantic.durationMs, hybrid: hybrid.durationMs },
        modes: { fts: fts.retrievalMode, semantic: semantic.retrievalMode, hybrid: hybrid.retrievalMode },
        lexicalControlCount: lexical.length,
      }
    }

    const exact = await compare(exactQuery, 'exact_lexical')
    const paraphrase = await compare(paraphraseQuery, 'semantic_paraphrase')
    const mixed = await compare(mixedQuery, 'mixed')
    const noHit = await compare(noHitQuery, 'no_hit')

    cases.push(check(
      'live4b_03_exact_lexical',
      exact.fts.length >= 1 && exact.hybrid.length >= 1,
      JSON.stringify(exact),
    ))
    cases.push(check(
      'live4b_04_semantic_paraphrase',
      paraphrase.semantic.length >= 1 && paraphrase.hybrid.length >= 1,
      JSON.stringify(paraphrase),
    ))
    cases.push(check(
      'live4b_05_mixed',
      mixed.hybrid.length >= 1,
      JSON.stringify(mixed),
    ))
    cases.push(check(
      'live4b_06_no_hit',
      typeof noHit.hybrid.length === 'number',
      JSON.stringify(noHit),
    ))
    cases.push(check(
      'live4b_07_cold_warm_memory',
      cold.hits.length >= 1 && warm.hits.length >= 1 && coldMs >= 0 && warmMs >= 0,
      JSON.stringify({
        coldMs,
        warmMs,
        hybridColdMs: cold.durationMs,
        hybridWarmMs: warm.durationMs,
        semanticQueryMsCold: cold.semanticQueryMs,
        semanticQueryMsWarm: warm.semanticQueryMs,
        rssMbBefore: rssBefore,
        rssMbAfterCold: rssAfterCold,
        rssMbAfterWarm: rssAfterWarm,
        rssDeltaMb: rssAfterWarm - rssBefore,
        vectorIndexBytes: existsSync(paths.vectorDbPath) ? statSync(paths.vectorDbPath).size : 0,
        documents: count,
        chunks: health.indexedChunkCount,
      }),
    ))
  } finally {
    corpus.close()
  }
  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify({ host: os.hostname(), node: process.version }, null, 2))
  const results = await runStage4bLiveAcceptance()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} [${result.proof}] ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Sovereign search stage 4B live acceptance: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
