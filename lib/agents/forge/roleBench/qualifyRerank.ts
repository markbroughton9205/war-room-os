/**
 * RERANKER qualification: embed the corpus (embedding model), take the top-20 files per query, rerank them with the reranker model, compare the
 * order with the embedding order. Needs both models installed. No downloads.
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/agents/forge/roleBench/qualifyRerank.ts \
 *        --reranker <ref> --embedder <ref> --out <dir>
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { loopbackBaseUrl } from '@/lib/agents/ops/engineering/runtime/ollamaModel'
import { probeLocalNode } from '../localNode'
import { qualification } from '../rank'
import { ForgeStore } from '../store'
import type { BenchmarkRecord } from '../types'
import { QUERIES, QUERY_INSTRUCTION, SEMANTIC_QUERIES, bestChunkPerFile, buildCorpus, embed, embeddingRank, metrics, rerankScore } from './retrieval'
import { MemSampler, readMem } from './sampler'

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const reranker = arg('reranker'), embedder = arg('embedder'), out = arg('out')
if (!reranker || !embedder || !out) { console.error('usage: --reranker <ref> --embedder <ref> --out <dir>'); process.exit(2) }
mkdirSync(out, { recursive: true })
const base = loopbackBaseUrl(); const store = new ForgeStore()
const probe = await probeLocalNode()
if (!probe.reachable || probe.record.resident.length) { console.error('node unreachable or not idle'); process.exit(3) }
const rr = probe.record.installedModels.find((m) => m.ref === reranker)
if (!rr || !probe.record.installedModels.some((m) => m.ref === embedder)) { console.error('both models must be installed'); process.exit(2) }
const idle = readMem(); const sampler = new MemSampler().start()
const unload = (m: string) => fetch(`${base}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: m, keep_alive: 0 }) }).catch(() => undefined)

const { chunks, digest } = buildCorpus(process.cwd())
const all = [...QUERIES.map((q) => ({ ...q, klass: 'identifier' })), ...SEMANTIC_QUERIES.map((q) => ({ ...q, klass: 'semantic' }))]
const cv = await embed(base, embedder, chunks.map((c) => c.text), '2m')
const qv = await embed(base, embedder, all.map((q) => QUERY_INSTRUCTION + q.q), '2m')
await unload(embedder); await new Promise((r) => setTimeout(r, 3000))
const emb = all.map((q, i) => embeddingRank(chunks, cv, qv[i]))

const TOP = 20
const reranked: string[][] = []; const unscored: number[] = []; let calls = 0; const t0 = Date.now(); let loadMs: number | 'UNKNOWN' = 'UNKNOWN'
for (let i = 0; i < all.length; i++) {
  const cand = emb[i].slice(0, TOP); const docs = bestChunkPerFile(chunks, cv, qv[i], cand)
  const scored: { f: string; s: number; pos: number }[] = []
  let missing = 0
  for (const [pos, f] of cand.entries()) {
    const t1 = Date.now()
    const r = await rerankScore(base, reranker, all[i].q, docs.get(f) ?? '', '5m'); calls++
    if (i === 0 && pos === 0) loadMs = Date.now() - t1
    if (!r.sawEither) missing++
    scored.push({ f, s: r.score, pos })
  }
  unscored.push(missing)
  // ties keep the embedding order (stable by original position)
  reranked.push([...scored].sort((a, b) => b.s - a.s || a.pos - b.pos).map((x) => x.f).concat(emb[i].slice(TOP)))
}
const ps = (await (await fetch(`${base}/api/ps`)).json()) as { models?: { name?: string; size?: number; size_vram?: number }[] }
const live = ps.models?.find((m) => m.name === reranker)
await unload(reranker); sampler.stop()
const truth = all.map((q) => q.files)
const mEmb = metrics(emb, truth), mRe = metrics(reranked, truth)
const mEmbSem = metrics(emb.slice(QUERIES.length), truth.slice(QUERIES.length)), mReSem = metrics(reranked.slice(QUERIES.length), truth.slice(QUERIES.length))
const rank = (rk: string[], i: number) => { const p = rk.findIndex((f) => truth[i].includes(f)); return p < 0 ? Number.POSITIVE_INFINITY : p + 1 }
const pre = mRe.mrr > mEmb.mrr && mRe.recall3 >= mEmb.recall3
// a query only passes when the reranker produced yes/no scores for every candidate, did not move the right file down, AND the run met the pre-registered aggregate rule
// (a reranker that changes nothing, or cannot score, must not record successes)
const rec = (i: number): BenchmarkRecord => {
  const before = rank(emb[i], i), after = rank(reranked[i], i); const pass = after <= before && unscored[i] === 0 && pre
  return { modelRef: reranker, executor: `ollama:${reranker}`, fixture: `rerank/${all[i].id}`, at: new Date().toISOString(), taskClass: 'role_benchmark', role: 'RERANKER', nodeId: probe.record.nodeId, fixtureClass: all[i].klass,
    verifierScore: { pass: pass ? 1 : 0, total: 1 }, completion: pass ? 'COMPLETED' : 'FAILED', modelCalls: TOP, repairs: 0, retries: 0, regressions: pass ? 0 : 1, elapsedMs: Math.round((Date.now() - t0) / all.length), manualIntervention: false, contextTokens: 2048, ramMiB: sampler.peakRam, vramMiB: sampler.peakGpu,
    ...(pass ? {} : { rootCause: unscored[i] > 0 ? `${unscored[i]}/${TOP} candidates produced no yes/no logits` : !pre ? 'run did not meet the pre-registered improvement rule' : `reranking moved the right file from rank ${before} to ${after}` }), failureClass: pass ? undefined : unscored[i] > 0 ? 'NO_SCORES' : !pre ? 'RULE_NOT_MET' : 'RERANK_REGRESSION', evidencePath: path.join(out, 'report.json') }
}
for (let i = 0; i < all.length; i++) store.recordBenchmark(rec(i))
const q = qualification(reranker, 'RERANKER', store.benchmarks(reranker))
const report = {
  MODEL_ID: reranker, DIGEST: rr.digest, DISK_SIZE_MiB: Math.round(rr.sizeBytes / 1048576), PATH: 'generate+logprobs (raw prompt); /api/rerank is not available in this Ollama', PROVENANCE: 'third-party community packaging of Qwen/Qwen3-Reranker-0.6B (Ollama registry namespace dengcao); weights not produced by War Room',
  corpusDigest: digest, queries: all.length, topK: TOP, rerankCalls: calls, totalMs: Date.now() - t0, firstCallMs: loadMs,
  embeddingOrder: { all: mEmb, semantic: mEmbSem }, rerankedOrder: { all: mRe, semantic: mReSem },
  candidatesWithoutYesNoInTop20Logprobs: unscored.reduce((a, b) => a + b, 0),
  preRegisteredRule: 'reranked MRR > embedding MRR AND reranked recall@3 >= embedding recall@3', preRegisteredRulePassed: pre,
  perQuery: all.map((x, i) => ({ id: x.id, before: rank(emb[i], i), after: rank(reranked[i], i) })),
  VRAM_IDLE_MiB: idle.gpuMiB, VRAM_ACTIVE_PEAK_MiB: sampler.peakGpu, SYSTEM_RAM_IDLE_MiB: idle.ramUsedMiB, SYSTEM_RAM_ACTIVE_PEAK_MiB: sampler.peakRam, SWAP_DELTA_PEAK_MiB: sampler.peakSwap - idle.swapUsedMiB,
  GPU_OFFLOAD_MiB: live?.size_vram !== undefined ? Math.round(live.size_vram / 1048576) : 'UNKNOWN', CPU_OFFLOAD_MiB: live?.size !== undefined && live.size_vram !== undefined ? Math.round((live.size - live.size_vram) / 1048576) : 'UNKNOWN',
  gate: q, QUALIFIED_ROLES: pre && q.qualified ? ['RERANKER'] : [], at: new Date().toISOString(),
}
writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1))
console.log(`[${reranker}] embedding MRR ${mEmb.mrr.toFixed(3)} r@1 ${mEmb.recall1.toFixed(3)} r@3 ${mEmb.recall3.toFixed(3)} -> reranked MRR ${mRe.mrr.toFixed(3)} r@1 ${mRe.recall1.toFixed(3)} r@3 ${mRe.recall3.toFixed(3)} | rule ${pre ? 'PASSED' : 'NOT passed'} | no-yes/no-in-top20: ${report.candidatesWithoutYesNoInTop20Logprobs} | qualified: ${report.QUALIFIED_ROLES.join(',') || 'none'}`)
