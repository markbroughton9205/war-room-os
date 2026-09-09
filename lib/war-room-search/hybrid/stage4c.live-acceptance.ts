import { existsSync, statSync } from 'node:fs'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { searchLocalCorpus } from '../crawler/localSearch'
import { SovereignCorpus } from '../crawler/corpus'
import { calibrateFixtureCorpus, calibrateLiveCorpus, LIVE_CALIBRATION_QUERIES } from './calibration'
import { getSharedQueryEmbedder, resetSharedQueryEmbedder } from './embedder'
import { inspectLocalSemanticHealth } from './semanticHealth'
import { localOnnxModelPresent, resolveHybridPaths } from './modelStore'
import { PRODUCTION_RETRIEVAL_PROFILE } from './retrievalProfile'
import { searchLocalHybrid } from './retrieve'

type CaseResult = { name: string; pass: boolean; detail: string; proof: string }

function check(name: string, pass: boolean, detail: string, proof = 'LIVE'): CaseResult {
  return { name, pass, detail, proof }
}

function peakRssMb(): number {
  return Math.round(process.memoryUsage().rss / 1048576)
}

export async function runStage4cLiveAcceptance(): Promise<CaseResult[]> {
  const cases: CaseResult[] = []
  const paths = resolveHybridPaths()
  const corpus = new SovereignCorpus()
  try {
    const count = corpus.countDocuments()
    cases.push(check('live4c_01_corpus_present', count >= 1 && existsSync(paths.corpusDbPath), JSON.stringify({ count, db: paths.corpusDbPath })))
    if (count < 1) return cases

    const modelReady = localOnnxModelPresent(paths.localModelDir) || localOnnxModelPresent(paths.modelsDir)
    if (!modelReady) {
      cases.push(check('live4c_02_model_present', false, 'local ONNX model missing'))
      return cases
    }

    resetSharedQueryEmbedder()
    const embedder = getSharedQueryEmbedder()
    const rssBefore = peakRssMb()
    const fixtureCal = await calibrateFixtureCorpus(embedder)
    const liveCal = await calibrateLiveCorpus(embedder)
    cases.push(check(
      'live4c_02_calibration_ran',
      fixtureCal.selected != null && Boolean(liveCal?.distribution),
      JSON.stringify({
        fixtureSelected: fixtureCal.selected,
        liveSelected: liveCal?.selected ?? null,
        production: PRODUCTION_RETRIEVAL_PROFILE,
        fixtureNegMax: fixtureCal.distribution.negativeTop1.max,
        fixturePosMinRelevant: fixtureCal.distribution.positiveRelevantTop1.min,
        liveNegMax: liveCal?.distribution.negativeTop1.max ?? null,
        livePosMinRelevant: liveCal?.distribution.positiveRelevantTop1.min ?? null,
      }),
    ))

    const exact = await searchLocalHybrid('RFC 2606', { corpus, embedder, retrievalMode: 'hybrid', limit: 5 })
    const paraphrase = await searchLocalHybrid('cash trouble for a gulf-backed breakaway golf circuit', { corpus, embedder, retrievalMode: 'hybrid', limit: 5 })
    const penguin = await searchLocalHybrid('antarctic penguin census 1994', { corpus, embedder, retrievalMode: 'hybrid', limit: 5 })
    const hardNeg = await searchLocalHybrid('protein domains in eukaryotic genomes', { corpus, embedder, retrievalMode: 'hybrid', limit: 5 })
    const mixed = await searchLocalHybrid('reserved DNS names and LIV Golf', { corpus, embedder, retrievalMode: 'hybrid', limit: 5 })
    const ftsPenguin = searchLocalCorpus('antarctic penguin census 1994', { corpus, limit: 5 })
    const health = inspectLocalSemanticHealth({ queryResult: penguin })

    function pack(label: string, result: typeof exact) {
      return {
        label,
        query: result.query,
        ftsTop: result.hits.filter(hit => hit.lexicalRank != null).map(hit => hit.document.title),
        semanticCandidate: result.semanticAdmission.candidateScore,
        semanticSecond: result.semanticAdmission.secondScore,
        margin: result.semanticAdmission.margin,
        admitted: result.semanticAdmission.admitted,
        abstained: result.semanticAdmission.abstained,
        hybridTop: result.hits[0]?.document.title ?? null,
        mode: result.retrievalMode,
        health: health.status,
      }
    }

    cases.push(check(
      'live4c_03_exact_lexical_rfc',
      exact.hits.some(hit => /RFC 2606/i.test(hit.document.title || '') && hit.lexicalRank != null),
      JSON.stringify(pack('exact_lexical', exact)),
    ))
    cases.push(check(
      'live4c_04_liv_paraphrase_admitted',
      paraphrase.semanticAdmission.admitted === true
        && /LIV Golf/i.test(paraphrase.hits[0]?.document.title || '')
        && (paraphrase.semanticAdmission.candidateScore ?? 0) >= PRODUCTION_RETRIEVAL_PROFILE.semanticThreshold,
      JSON.stringify(pack('semantic_positive', paraphrase)),
    ))
    cases.push(check(
      'live4c_05_penguin_abstains',
      penguin.hits.length === 0
        && penguin.semanticAdmission.abstained === true
        && penguin.semanticAvailable === true
        && health.status !== 'modelMissing'
        && ftsPenguin.length === 0,
      JSON.stringify({ ...pack('known_negative', penguin), ftsCount: ftsPenguin.length, healthStatus: health.status }),
    ))
    cases.push(check(
      'live4c_06_hard_negative_biology',
      hardNeg.semanticAdmission.admitted === false && hardNeg.hits.every(hit => hit.semanticRank == null),
      JSON.stringify(pack('hard_negative', hardNeg)),
    ))
    cases.push(check(
      'live4c_07_mixed_topic_observable',
      mixed.semanticAdmission.threshold === PRODUCTION_RETRIEVAL_PROFILE.semanticThreshold
        && mixed.semanticAdmission.profileVersion === PRODUCTION_RETRIEVAL_PROFILE.profileVersion,
      JSON.stringify({ ...pack('mixed_topic', mixed), andFts: searchLocalCorpus('reserved DNS names and LIV Golf', { corpus, limit: 5 }).length }),
    ))

    const rssAfter = peakRssMb()
    cases.push(check(
      'live4c_08_resource_impact',
      paraphrase.durationMs >= 0 && penguin.semanticQueryMs != null,
      JSON.stringify({
        rssMbBefore: rssBefore,
        rssMbAfter: rssAfter,
        rssDeltaMb: rssAfter - rssBefore,
        paraphraseMs: paraphrase.durationMs,
        penguinMs: penguin.durationMs,
        semanticQueryMs: paraphrase.semanticQueryMs,
        vectorIndexBytes: existsSync(paths.vectorDbPath) ? statSync(paths.vectorDbPath).size : 0,
        liveQueries: LIVE_CALIBRATION_QUERIES.map(item => item.id),
      }),
    ))
  } finally {
    corpus.close()
  }
  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify({ host: os.hostname(), node: process.version, profile: PRODUCTION_RETRIEVAL_PROFILE }, null, 2))
  const results = await runStage4cLiveAcceptance()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} [${result.proof}] ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Sovereign search stage 4C live acceptance: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
