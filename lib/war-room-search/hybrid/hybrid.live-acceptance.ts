import { execSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { searchLocalCorpus } from '../crawler/localSearch'
import { SovereignCorpus } from '../crawler/corpus'
import { createQueryEmbedder } from './embedder'
import { indexCorpusDocuments } from './indexCorpus'
import { localModelGovernance, localOnnxModelPresent, resolveHybridPaths } from './modelStore'
import { prepareLocalEmbeddingModel } from './prepareModel'
import { searchLocalHybrid } from './retrieve'

type CaseResult = { name: string; pass: boolean; detail: string; proof: string }

function check(name: string, pass: boolean, detail: string, proof = 'LIVE'): CaseResult {
  return { name, pass, detail, proof }
}

function dirSize(root: string): number {
  if (!existsSync(root)) return 0
  let total = 0
  const walk = (current: string) => {
    const stat = statSync(current)
    if (stat.isFile()) {
      total += stat.size
      return
    }
    if (!stat.isDirectory()) return
    for (const name of readdirSync(current)) {
      if (name === '.' || name === '..') continue
      walk(path.join(current, name))
    }
  }
  walk(root)
  return total
}

function peakMemoryMb(): number | null {
  const usage = process.memoryUsage()
  return Math.round((usage.rss || usage.heapUsed) / 1048576)
}

export async function runHybridLiveAcceptance(): Promise<CaseResult[]> {
  const cases: CaseResult[] = []
  const paths = resolveHybridPaths()
  const governance = localModelGovernance()
  const corpus = new SovereignCorpus()
  try {
    const count = corpus.countDocuments()
    cases.push(check('live_01_corpus_present', count >= 1 && existsSync(paths.corpusDbPath), JSON.stringify({ count, db: paths.corpusDbPath })))
    if (count < 1) return cases

    const documents = corpus.listDocuments()
    const rfc = documents.find(doc => /RFC 2606/i.test(`${doc.title}\n${doc.contentText}`))
    const liv = documents.find(doc => /LIV Golf/i.test(`${doc.title}\n${doc.contentText}`))
    const sample = rfc ?? liv ?? documents.find(doc => doc.contentText.length > 40) ?? documents[0]!
    const lexicalQuery = rfc ? 'RFC 2606' : (sample.title || sample.contentText).split(/\s+/).filter(token => token.length > 3).slice(0, 2).join(' ')
    const semanticQuery = liv
      ? 'cash trouble for a gulf-backed breakaway golf circuit'
      : 'limits on overseas sales of advanced processors'
    const lexical = searchLocalCorpus(lexicalQuery || sample.domain, { corpus, limit: 8 })
    cases.push(check(
      'live_02_lexical_fts',
      lexical.length >= 1 && Boolean(lexical[0]?.document.canonicalUrl),
      JSON.stringify({ query: lexicalQuery, hits: lexical.map(hit => ({ title: hit.document.title, url: hit.document.canonicalUrl, publisher: hit.document.publisher })) }),
    ))

    const prepared = localOnnxModelPresent(paths.localModelDir) || localOnnxModelPresent(paths.modelsDir)
      ? { ok: true, skipped: true, reason: 'already_present', modelDir: paths.localModelDir, governance }
      : await prepareLocalEmbeddingModel({ allowDownload: true })
    cases.push(check(
      'live_03_model_prepared',
      prepared.ok && prepared.governance.license === 'MIT',
      JSON.stringify({ ok: prepared.ok, skipped: prepared.skipped, reason: prepared.reason, license: prepared.governance.license, dir: prepared.modelDir }),
    ))
    if (!prepared.ok) return cases

    const embedder = createQueryEmbedder({ allowDownload: false })
    cases.push(check('live_04_query_embedder_local_only', embedder.available && embedder.info.backend === 'local_onnx', JSON.stringify(embedder.info)))
    if (!embedder.available) return cases

    const memBefore = peakMemoryMb()
    const indexed = await indexCorpusDocuments({ corpus, embedder })
    const embedMs = indexed.durationMs
    cases.push(check(
      'live_05_explicit_index',
      indexed.chunks >= 1 && indexed.documents >= 1,
      JSON.stringify({ ...indexed, memoryMb: peakMemoryMb() }),
    ))

    const started = Date.now()
    const hybrid = await searchLocalHybrid(semanticQuery, { corpus, embedder, limit: 8 })
    const queryMs = Date.now() - started
    const ftsSemantic = searchLocalCorpus(semanticQuery, { corpus, limit: 8 })
    const ftsLexical = searchLocalCorpus(lexicalQuery, { corpus, limit: 8 })
    const hybridLexical = await searchLocalHybrid(lexicalQuery, { corpus, embedder, limit: 8 })
    const lexicalCompare = ftsLexical[0]
    const hybridTop = hybrid.hits[0]
    cases.push(check(
      'live_06_semantic_and_hybrid',
      hybrid.semanticAvailable && hybrid.hits.length >= 1 && Boolean(hybridTop?.document.publisher),
      JSON.stringify({
        semanticQuery,
        lexicalQuery,
        ftsForLexicalQuery: ftsLexical.map(hit => ({ title: hit.document.title, url: hit.document.canonicalUrl, publisher: hit.document.publisher })),
        hybridForLexicalQuery: hybridLexical.hits.map(hit => ({
          title: hit.document.title,
          lexicalRank: hit.lexicalRank,
          semanticRank: hit.semanticRank,
          fusionScore: hit.fusionScore,
        })),
        ftsForSemanticQuery: ftsSemantic.map(hit => ({ title: hit.document.title, url: hit.document.canonicalUrl })),
        hybridForSemanticQuery: hybrid.hits.map(hit => ({
          title: hit.document.title,
          publisher: hit.document.publisher,
          url: hit.document.canonicalUrl,
          lexicalRank: hit.lexicalRank,
          semanticRank: hit.semanticRank,
          fusionScore: hit.fusionScore,
          chunk: hit.matchedChunkId,
          snippet: hit.snippet.slice(0, 160),
        })),
        why: hybridTop
          ? `RRF fused lexicalRank=${hybridTop.lexicalRank} semanticRank=${hybridTop.semanticRank} fusionScore=${Number(hybridTop.fusionScore).toFixed(4)}; lexical and semantic scores are not treated as equivalent.`
          : 'no hybrid hit',
        measurements: {
          modelDiskBytes: dirSize(paths.modelsDir),
          vectorDiskBytes: existsSync(paths.vectorDbPath) ? statSync(paths.vectorDbPath).size : 0,
          embedMs,
          queryMs,
          hybridDurationMs: hybrid.durationMs,
          rssMbBefore: memBefore,
          rssMbAfter: peakMemoryMb(),
          corpusDocuments: count,
        },
        lexicalTop: lexicalCompare && { title: lexicalCompare.document.title, url: lexicalCompare.document.canonicalUrl },
      }),
    ))
    cases.push(check(
      'live_07_no_git_model_tracking',
      execSync('git check-ignore -v .war-room/models', { encoding: 'utf8' }).includes('.war-room/'),
      'models remain gitignored',
    ))
  } finally {
    corpus.close()
  }
  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify({ host: os.hostname(), node: process.version, governance: localModelGovernance() }, null, 2))
  const results = await runHybridLiveAcceptance()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} [${result.proof}] ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Sovereign hybrid live acceptance: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
