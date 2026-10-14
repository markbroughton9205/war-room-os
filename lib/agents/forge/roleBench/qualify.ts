/**
 * Model qualification CLI (Nebula). Measures one installed model, runs its role suites, records Forge evidence, and writes a labelled report.
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/agents/forge/roleBench/qualify.ts \
 *        --model <ref> --roles FAST_REPAIR_WORKER:2,DEBUGGER_TEST_SPECIALIST:2 --out <dir> [--ctx 8192] [--allow-resident]
 * Environment: WAR_ROOM_AGENT_FOUNDRY_DIR chooses the Forge store. Needs an idle node (no resident model) unless --allow-resident.
 * Safety: stops the test (unloads, records the constraint) if available RAM falls under 2500 MiB. Never downloads anything.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { OllamaModelClient, loopbackBaseUrl } from '@/lib/agents/ops/engineering/runtime/ollamaModel'
import { measureProfile } from '../profile'
import { probeLocalNode } from '../localNode'
import { buildModelResourceProfile } from '../resourceProfile'
import { ROLE_GATES, isModelRole, type ModelRole } from '../roles'
import { qualification } from '../rank'
import { ForgeStore } from '../store'
import type { BenchmarkRecord } from '../types'
import { QUERIES, QUERY_INSTRUCTION, SEMANTIC_QUERIES, buildCorpus, embed, embeddingRank, keywordRank, measureEmbeddingProfile, metrics } from './retrieval'
import { runFixtures, type RunOutcome } from './run'
import { MemSampler, readMem } from './sampler'
import { suiteFor } from './index'

type Labeled<T> = { value: T; label: 'MEASURED' | 'DECLARED' | 'ESTIMATED' | 'UNKNOWN' }
const L = <T>(value: T, label: Labeled<T>['label']): Labeled<T> => ({ value, label })

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined }
const model = arg('model'); const out = arg('out'); const ctx = Number(arg('ctx') ?? 8192)
const roleSpecs = (arg('roles') ?? '').split(',').filter(Boolean).map((s) => { const [r, n] = s.split(':'); return { role: r as ModelRole, repeats: Number(n ?? 2) } })
if (!model || !out || !roleSpecs.length || roleSpecs.some((r) => !isModelRole(r.role))) { console.error('usage: --model <ref> --roles ROLE[:repeats],... --out <dir>'); process.exit(2) }
mkdirSync(out, { recursive: true })
const base = loopbackBaseUrl()
const store = new ForgeStore()
const nodeProbe = await probeLocalNode()
if (!nodeProbe.reachable) { console.error('local runtime unreachable'); process.exit(2) }
const installed = nodeProbe.record.installedModels.find((m) => m.ref === model)
if (!installed) { console.error(`${model} is not installed`); process.exit(2) }
if (nodeProbe.record.resident.length && !process.argv.includes('--allow-resident')) { console.error(`node not idle: ${nodeProbe.record.resident.map((r) => r.ref).join(', ')} resident`); process.exit(3) }
const show = (await (await fetch(`${base}/api/show`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model }) })).json()) as { details?: { parameter_size?: string; quantization_level?: string; family?: string }; license?: string }

const idle = readMem()
if (idle.availMiB < 4000) { console.error(`refusing: only ${idle.availMiB} MiB RAM available`); process.exit(4) }
const ctrl = new AbortController()
const sampler = new MemSampler((why) => { console.error(`UNSAFE: ${why}; stopping this model's test`); ctrl.abort() }).start()

const taskClassOf = (r: ModelRole) => 'role_benchmark' as const
const record = (o: RunOutcome, role: ModelRole, peakGpu: number, peakRam: number): BenchmarkRecord => ({
  modelRef: model!, executor: `ollama:${model}`, fixture: o.fixtureId, at: new Date().toISOString(), taskClass: taskClassOf(role), role, nodeId: nodeProbe.record.nodeId,
  fixtureClass: o.klass, verifierScore: { pass: o.pass ? 1 : 0, total: 1 }, completion: o.pass ? 'COMPLETED' : 'FAILED', modelCalls: 1, repairs: 0, retries: 0, regressions: 0, elapsedMs: o.ms, manualIntervention: false,
  contextTokens: role === 'CODE_RETRIEVAL' ? 2048 : ctx, ramMiB: peakRam, vramMiB: peakGpu, ...(o.pass ? {} : { rootCause: o.detail.slice(0, 200) }), evidencePath: path.join(out!, 'report.json'), failureClass: o.pass ? undefined : (o.modelOk ? 'WRONG_ANSWER' : 'MODEL_CALL_FAILED'),
})

// 1. warm load + profile (also the load-time / first-token / tokens-per-second / offload measurements)
console.log(`[${model}] loading and profiling at ctx ${ctx} ...`)
let profile: Awaited<ReturnType<typeof measureProfile>> | null = null
let embedProfile: Awaited<ReturnType<typeof measureEmbeddingProfile>> | null = null
const embeddingOnly = roleSpecs.every((r) => r.role === 'CODE_RETRIEVAL')
try { if (embeddingOnly) embedProfile = await measureEmbeddingProfile(base, model, ctx); else profile = await measureProfile(model, ctx) } catch (e) { console.error(`profile failed: ${e instanceof Error ? e.message : e}`) }
const afterLoad = readMem()

const results: Record<string, { n: number; ok: number; rate: number; avgMs: number; failureModes: Record<string, number>; byClass: Record<string, { n: number; ok: number }> }> = {}
const client = new OllamaModelClient(model, base, '5m')
const tally = (role: ModelRole, outs: RunOutcome[]) => {
  const fm: Record<string, number> = {}; const bc: Record<string, { n: number; ok: number }> = {}
  for (const o of outs) { if (!o.pass) { const k = o.modelOk ? o.detail.replace(/["'].*$/, '').slice(0, 60) : o.detail.slice(0, 60); fm[k] = (fm[k] ?? 0) + 1 } if (o.klass) { bc[o.klass] ??= { n: 0, ok: 0 }; bc[o.klass].n++; if (o.pass) bc[o.klass].ok++ } }
  const ok = outs.filter((o) => o.pass).length
  results[role] = { n: outs.length, ok, rate: outs.length ? ok / outs.length : 0, avgMs: outs.length ? Math.round(outs.reduce((a, o) => a + o.ms, 0) / outs.length) : 0, failureModes: fm, byClass: bc }
}
let retrieval: unknown = null
for (const { role, repeats } of roleSpecs) {
  if (ctrl.signal.aborted) break
  console.log(`[${model}] role ${role} x${repeats}`)
  if (role === 'CODE_RETRIEVAL') {
    const { chunks, digest, files } = buildCorpus(process.cwd())
    const t0 = Date.now()
    const cv = await embed(base, model, chunks.map((c) => c.text), '5m')
    const qv = await embed(base, model, QUERIES.map((q) => QUERY_INSTRUCTION + q.q), '5m')
    const emb = QUERIES.map((q, i) => embeddingRank(chunks, cv, qv[i])); const kw = QUERIES.map((q) => keywordRank(chunks, q.q)); const truth = QUERIES.map((q) => q.files)
    const mE = metrics(emb, truth), mK = metrics(kw, truth)
    const sv = await embed(base, model, SEMANTIC_QUERIES.map((q) => QUERY_INSTRUCTION + q.q), '5m')
    const sEmb = SEMANTIC_QUERIES.map((q, i) => embeddingRank(chunks, cv, sv[i])), sKw = SEMANTIC_QUERIES.map((q) => keywordRank(chunks, q.q)), sTruth = SEMANTIC_QUERIES.map((q) => q.files)
    const sE = metrics(sEmb, sTruth), sK = metrics(sKw, sTruth)
    const hybrid = metrics(SEMANTIC_QUERIES.map((q, i) => [...new Set([...sEmb[i].slice(0, 5), ...sKw[i].slice(0, 5), ...sEmb[i], ...sKw[i]])]), sTruth)
    // pre-registered rule: recall@10 >= 0.9 on QUERIES AND recall@10 on SEMANTIC_QUERIES >= the keyword baseline's
    retrieval = { corpusDigest: digest, files: files.length, chunks: chunks.length, embedMs: Date.now() - t0, identifierQueries: { embedding: mE, keywordBaseline: mK }, semanticQueries: { embedding: sE, keywordBaseline: sK, hybridUnion: hybrid }, preRegisteredRulePassed: mE.recall10 >= 0.9 && sE.recall10 >= sK.recall10 }
    writeFileSync(path.join(out, 'retrieval-semantic-detail.json'), JSON.stringify(SEMANTIC_QUERIES.map((q, i) => ({ id: q.id, truth: q.files, embeddingTop3: sEmb[i].slice(0, 3), keywordTop3: sKw[i].slice(0, 3) })), null, 1))
    const allQ = [...QUERIES, ...SEMANTIC_QUERIES]; const allRank = [...emb, ...sEmb]
    const outs: RunOutcome[] = allQ.map((q, i) => { const pos = allRank[i].findIndex((f) => q.files.includes(f)); return { fixtureId: `retrieval/${q.id}`, repeat: 1, pass: pos >= 0 && pos < 10, detail: pos >= 0 ? `rank ${pos + 1}` : 'not retrieved', klass: i < QUERIES.length ? 'identifier' : 'semantic', ms: Math.round((Date.now() - t0) / allQ.length), outputTokens: 'UNKNOWN', modelOk: true } })
    // gate evidence = the identifier queries only (the pre-registered rule judges the semantic set against the keyword baseline, not against a pass rate);
    // semantic outcomes are stored without a role so they inform but never count toward the role gate
    const gateOuts = outs.filter((o) => o.klass === 'identifier'); tally(role, gateOuts)
    for (const o of outs) store.recordBenchmark(o.klass === 'identifier' ? record(o, role, sampler.peakGpu, sampler.peakRam) : { ...record(o, role, sampler.peakGpu, sampler.peakRam), role: undefined })
    writeFileSync(path.join(out, `retrieval-detail.json`), JSON.stringify({ retrieval, perQuery: QUERIES.map((q, i) => ({ id: q.id, truth: q.files, embeddingTop3: emb[i].slice(0, 3), keywordTop3: kw[i].slice(0, 3) })) }, null, 1))
    continue
  }
  const fixtures = await suiteFor(role)
  const outs = await runFixtures(client, fixtures, { repeats, signal: ctrl.signal, onRun: (o) => console.log(`  ${o.pass ? 'ok  ' : 'FAIL'} ${o.fixtureId} r${o.repeat} ${o.ms}ms ${o.pass ? '' : o.detail.slice(0, 100)}`) })
  tally(role, outs); for (const o of outs) store.recordBenchmark(record(o, role, sampler.peakGpu, sampler.peakRam))
  writeFileSync(path.join(out, `runs-${role}.json`), JSON.stringify(outs, null, 1))
}
sampler.stop()
const ps = (await (await fetch(`${base}/api/ps`)).json()) as { models?: { name?: string; size?: number; size_vram?: number; context_length?: number }[] }
const live = ps.models?.find((m) => m.name === model)
await fetch(`${base}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, keep_alive: 0 }) }).catch(() => undefined)
await new Promise((r) => setTimeout(r, 4000))
const after = readMem()

const qualified = roleSpecs.map((r) => r.role).filter((role) => { if (role === 'CODE_RETRIEVAL' && !(retrieval as { preRegisteredRulePassed?: boolean } | null)?.preRegisteredRulePassed) return false; return !!results[role] && qualification(model!, role, store.benchmarks(model)).qualified })
const prof = profile && buildModelResourceProfile({ profile, nodeId: nodeProbe.record.nodeId, quantization: show.details?.quantization_level, residency: 'TRANSIENT', benchmarks: store.benchmarks(model) })
if (prof) store.recordResourceProfile({ ...prof, digest: installed.digest })
const mib = (b?: number) => (typeof b === 'number' ? Math.round(b / 1048576) : 'UNKNOWN')
const report = {
  MODEL_ID: L(model, 'MEASURED'), ROLE_CANDIDATE: L(roleSpecs.map((r) => r.role), 'DECLARED'),
  PARAMETER_COUNT: L(show.details?.parameter_size ?? 'UNKNOWN', show.details?.parameter_size ? 'DECLARED' : 'UNKNOWN'), QUANTIZATION: L(show.details?.quantization_level ?? 'UNKNOWN', show.details?.quantization_level ? 'DECLARED' : 'UNKNOWN'),
  DISK_SIZE_MiB: L(mib(installed.sizeBytes), 'MEASURED'), DIGEST: L(installed.digest, 'MEASURED'),
  VRAM_IDLE_MiB: L(idle.gpuMiB, 'MEASURED'), VRAM_ACTIVE_PEAK_MiB: L(sampler.peakGpu || 'UNKNOWN', sampler.peakGpu ? 'MEASURED' : 'UNKNOWN'), VRAM_AFTER_LOAD_MiB: L(afterLoad.gpuMiB, 'MEASURED'),
  SYSTEM_RAM_IDLE_MiB: L(idle.ramUsedMiB, 'MEASURED'), SYSTEM_RAM_ACTIVE_PEAK_MiB: L(sampler.peakRam, 'MEASURED'), MIN_AVAILABLE_RAM_MiB: L(Number.isFinite(sampler.minAvail) ? sampler.minAvail : 'UNKNOWN', 'MEASURED'),
  LOAD_TIME_MS: L(profile?.loadMs ?? embedProfile?.loadMs ?? 'UNKNOWN', (profile?.loadMs ?? embedProfile?.loadMs ?? 'UNKNOWN') !== 'UNKNOWN' ? 'MEASURED' : 'UNKNOWN'), FIRST_TOKEN_LATENCY_MS: L(profile?.firstTokenMs ?? 'UNKNOWN', profile && profile.firstTokenMs !== 'UNKNOWN' ? 'MEASURED' : 'UNKNOWN'),
  TOKENS_PER_SECOND: L(profile?.tokensPerSecond ?? 'UNKNOWN', profile && profile.tokensPerSecond !== 'UNKNOWN' ? 'MEASURED' : 'UNKNOWN'), CONTEXT_USED: L(live?.context_length ?? profile?.contextTokens ?? ctx, live?.context_length ? 'MEASURED' : 'DECLARED'),
  GPU_OFFLOAD_MiB: L(mib(live?.size_vram ?? embedProfile?.sizeVram ?? (profile && typeof profile.vramBytesLoaded === 'number' ? profile.vramBytesLoaded : undefined)), live || profile || embedProfile ? 'MEASURED' : 'UNKNOWN'),
  CPU_OFFLOAD_MiB: L(live?.size !== undefined && live.size_vram !== undefined ? mib(live.size - live.size_vram) : profile && typeof profile.artifactBytes === 'number' && typeof profile.vramBytesLoaded === 'number' ? mib(profile.artifactBytes - profile.vramBytesLoaded) : 'UNKNOWN', live || profile ? 'MEASURED' : 'UNKNOWN'),
  RESIDENCY_CLASS: L(profile?.residency ?? embedProfile?.residency ?? 'UNKNOWN', profile || embedProfile ? 'MEASURED' : 'UNKNOWN'),
  SWAP_DELTA_PEAK_MiB: L(sampler.peakSwap - idle.swapUsedMiB, 'MEASURED'), SWAP_USED_IDLE_MiB: L(idle.swapUsedMiB, 'MEASURED'), SWAP_USED_PEAK_MiB: L(sampler.peakSwap, 'MEASURED'),
  VRAM_AFTER_UNLOAD_MiB: L(after.gpuMiB, 'MEASURED'),
  SUCCESS_RATE: Object.fromEntries(Object.entries(results).map(([r, v]) => [r, L({ ok: v.ok, n: v.n, rate: Math.round(v.rate * 1000) / 1000, byClass: v.byClass }, 'MEASURED')])),
  AVERAGE_RUNTIME_MS: Object.fromEntries(Object.entries(results).map(([r, v]) => [r, L(v.avgMs, 'MEASURED')])),
  FAILURE_MODES: Object.fromEntries(Object.entries(results).map(([r, v]) => [r, v.failureModes])),
  QUALIFIED_ROLES: L(qualified, 'MEASURED'), GATES: Object.fromEntries(roleSpecs.map((r) => [r.role, ROLE_GATES[r.role]])),
  RETRIEVAL: retrieval, ABORTED_UNSAFE: sampler.unsafe, LICENSE_TEXT_HEAD: (show.license ?? '').slice(0, 160), at: new Date().toISOString(), nodeRuntime: nodeProbe.runtimeVersion,
}
writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1))
console.log(`[${model}] qualified: ${qualified.join(', ') || 'none'} | ${Object.entries(results).map(([r, v]) => `${r} ${v.ok}/${v.n}`).join(' | ')}${sampler.unsafe ? ' | ABORTED: ' + sampler.unsafe : ''}`)
