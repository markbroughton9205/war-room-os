import fs from 'node:fs'
import { migrateExistingWrCorpus } from '@/lib/wr-corpus/migrate'
import {
  CURRENT_WR_TOKENIZER,
  HISTORICAL_WR_TOKENIZER_0_SHA256,
  WR_TOKENIZER_RECOMMENDATION,
  WR_TOKENIZER_RECONCILIATION,
  wrTokenizerTruthNotes,
} from './identity'
import { importWrTokenizer0 } from './importArtifact'
import { inspectTokenizerJson, readWrim0Lineage, readWrim1TokenizerLineage, rehashDumpTokenizer } from './inspect'
import { byteAlphabetCoverage, encodeText, getLoadedTokenizer, roundTripOk } from './encode'
import { auditSpecialTokens } from './specialTokens'
import { CHAT_FORMAT_SAMPLES, DOMAIN_SAMPLES, FUTURE_WORLD_SAMPLES, MULTILINGUAL_SAMPLES } from './fixtures'
import { benchmarkSamples, benchmarkCorpusVersion } from './corpusBenchmark'
import { saveBenchmarkJson, summarizeRows } from './benchmark'
import { compareRows, qwenTokenizerAvailable } from './compare'
import { decideTokenizerRecommendation } from './decision'
import { probeNebulaTokenizerRuntime } from './nebula'
import { resolveWrTokenizerPaths } from './paths'

export async function runTokenizerReconciliation(opts?: {
  dataDirOverride?: string | null
  dumpRoot?: string | null
  migrateCorpus?: boolean
}) {
  const hashed = await rehashDumpTokenizer(opts?.dumpRoot)
  const imported = await importWrTokenizer0(opts)
  if (opts?.migrateCorpus !== false) {
    await migrateExistingWrCorpus({ dataDirOverride: opts?.dataDirOverride, dumpRoot: opts?.dumpRoot })
  }
  const tokenizerPath = imported.canonicalPath
  const inspected = inspectTokenizerJson(tokenizerPath)
  const tok = getLoadedTokenizer(tokenizerPath)
  const specials = auditSpecialTokens(tok)
  const coverage = byteAlphabetCoverage(tokenizerPath)
  const wrim0 = readWrim0Lineage(opts?.dumpRoot)
  const wrim1 = readWrim1TokenizerLineage(opts?.dumpRoot)

  const corpus0 = benchmarkCorpusVersion('WR-CORPUS-0', tokenizerPath, opts?.dataDirOverride)
  const corpus1 = benchmarkCorpusVersion('WR-CORPUS-1', tokenizerPath, opts?.dataDirOverride)
  const corpusActive = benchmarkCorpusVersion('WR-CORPUS-ACTIVE', tokenizerPath, opts?.dataDirOverride)

  const domains = benchmarkSamples('domains', DOMAIN_SAMPLES, tokenizerPath)
  const multilingual = benchmarkSamples('multilingual', MULTILINGUAL_SAMPLES, tokenizerPath)
  const chat = benchmarkSamples('chat', CHAT_FORMAT_SAMPLES, tokenizerPath)
  const future = benchmarkSamples('future-world', FUTURE_WORLD_SAMPLES, tokenizerPath)
  const english = summarizeRows(
    'english',
    domains.rows.filter(r => r.domain === 'english'),
  )
  const code = summarizeRows(
    'code',
    domains.rows.filter(r => r.domain === 'code'),
  )
  const json = summarizeRows(
    'json',
    domains.rows.filter(r => r.domain === 'json'),
  )

  const chatSpecialHits = CHAT_FORMAT_SAMPLES.map(sample => {
    const encoded = encodeText(sample.text, tokenizerPath)
    const specialIds = encoded.ids.filter(id => id <= 8)
    return { sample: sample.id, tokens: encoded.ids.length, specialIds, roundTrip: roundTripOk(sample.text, tokenizerPath) }
  })

  const comparatives = compareRows(
    [...DOMAIN_SAMPLES.slice(0, 8), ...MULTILINGUAL_SAMPLES.slice(0, 3)],
    tokenizerPath,
  )

  const decision = decideTokenizerRecommendation({
    english,
    corpus0: corpus0.summary,
    corpus1: corpus1.summary,
    corpusActive: corpusActive.summary,
    multilingual: multilingual.summary,
    code,
    json,
    wrim0Compatible: wrim0.compatible,
    wrim1Compatible: wrim1.compatible,
    vocabFrozen: hashed.sha256 === HISTORICAL_WR_TOKENIZER_0_SHA256,
  })

  const nebula = probeNebulaTokenizerRuntime()
  const payload = {
    historicalSource: hashed.path,
    sha256: hashed.sha256,
    canonicalPath: imported.canonicalPath,
    imported,
    inspected,
    byteAlphabetCoverage: coverage,
    specials,
    wrim0,
    wrim1,
    corpus0: { summary: corpus0.summary, recordCount: corpus0.recordCount },
    corpus1: { summary: corpus1.summary, recordCount: corpus1.recordCount },
    corpusActive: { summary: corpusActive.summary, recordCount: corpusActive.recordCount },
    domains: domains.summary,
    domainRows: domains.rows,
    multilingual: multilingual.summary,
    multilingualRows: multilingual.rows,
    chat: chat.summary,
    chatSpecialHits,
    future: future.summary,
    comparatives,
    qwen: qwenTokenizerAvailable(),
    decision,
    nebula,
    truth: wrTokenizerTruthNotes(),
    identity: {
      CURRENT_WR_TOKENIZER,
      WR_TOKENIZER_RECONCILIATION,
      WR_TOKENIZER_RECOMMENDATION,
    },
  }

  saveBenchmarkJson('reconciliation-report.json', payload, opts?.dataDirOverride)
  saveBenchmarkJson('corpus-0.json', { summary: corpus0.summary, sampleCount: Math.min(corpus0.rows.length, 32), samples: corpus0.rows.slice(0, 32) }, opts?.dataDirOverride)
  saveBenchmarkJson('corpus-1.json', { summary: corpus1.summary, sampleCount: Math.min(corpus1.rows.length, 32), samples: corpus1.rows.slice(0, 32) }, opts?.dataDirOverride)
  saveBenchmarkJson('corpus-active.json', { summary: corpusActive.summary, samples: corpusActive.rows }, opts?.dataDirOverride)
  saveBenchmarkJson('domains.json', domains, opts?.dataDirOverride)
  saveBenchmarkJson('multilingual.json', multilingual, opts?.dataDirOverride)
  saveBenchmarkJson('decision.json', decision, opts?.dataDirOverride)

  const paths = resolveWrTokenizerPaths(opts?.dataDirOverride)
  fs.writeFileSync(paths.decisionPath, `${JSON.stringify(decision, null, 2)}\n`, 'utf8')
  return payload
}
