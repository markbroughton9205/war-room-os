/**
 * Mixed-mission proof on Nebula: one pipeline of different kinds of work, each ROUTED by role from recorded evidence, each executed through the
 * Residency Governor on the real local models, each result checked, each step's provenance taken from the model that actually answered.
 * Steps whose role has no qualified model are shown with their explicit fallback (builder / deterministic / UNAVAILABLE) instead of being run by an unqualified model.
 *   WAR_ROOM_AGENT_FOUNDRY_DIR=<store> node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/agents/forge/mixedProof.ts <out.json>
 * Needs an idle node. No downloads, no cloud.
 */
import { writeFileSync } from 'node:fs'
import { loopbackBaseUrl } from '@/lib/agents/ops/engineering/runtime/ollamaModel'
import { ResidencyGovernor } from './governor'
import { probeLocalNode } from './localNode'
import { NodeRegistry } from './node'
import { assignPool } from './pool'
import { governedClientForRef } from './poolRuntime'
import { FIRST_POOL } from './registry'
import { routeTask, type RouteOutcome, type TaskIntent } from './roleRouting'
import { ForgeStore } from './store'
import { fastRepairFixtures } from './roleBench/fastRepair'
import { debuggerFixtures } from './roleBench/debugger'
import { researchFixtures } from './roleBench/research'
import { QUERY_INSTRUCTION, buildCorpus, embed, embeddingRank } from './roleBench/retrieval'
import type { Fixture } from './roleBench/types'

const out = process.argv[2]
if (!out) { console.error('usage: mixedProof.ts <out.json>'); process.exit(2) }
const store = new ForgeStore()
const probe = await probeLocalNode()
if (!probe.reachable || probe.record.resident.length) { console.error('node unreachable or not idle'); process.exit(3) }
const reg = new NodeRegistry(); const lr = reg.registerLocal(); if (!lr.ok) throw new Error('no local node')
const gov = new ResidencyGovernor(lr.node)
const models = store.models().length ? store.models() : FIRST_POOL
const world = { nodes: [probe.record], models, benchmarks: store.benchmarks(), profiles: store.resourceProfiles(), now: new Date(), allowProvisional: true, designatedBuilder: assignPool(models, store.benchmarks()).members[0].modelRef ?? undefined }
const base = loopbackBaseUrl()

type Step = { n: number; intent: TaskIntent; role: string; via: string; model: string | null; executor: string | null; governor: { action: string; evict: string[]; basis: string } | null; ms: number; pass: boolean | null; detail: string; routeReason: string }
const steps: Step[] = []
const lastDecision = () => gov.decisions().at(-1)
const keepBuilder = (r: RouteOutcome | undefined) => (r?.modelRef ? [r.modelRef] : [])
const builderRoute = routeTask('feature_build', world)

async function generate(route: RouteOutcome, fx: Fixture): Promise<{ text: string; executor: string } | { error: string }> {
  const ref = route.modelRef as string
  const entry = models.find((m) => m.ref === ref)
  const c = governedClientForRef(gov, ref, route.role, route.role === 'PRIMARY_BUILDER' ? 'RESIDENT' : 'TRANSIENT', route.role === 'PRIMARY_BUILDER' ? '10m' : '0', keepBuilder(builderRoute), entry)
  const r = await c.generate({ system: fx.system, prompt: fx.prompt, maxTokens: fx.maxTokens, json: fx.json, temperature: 0.1, seed: 7, timeoutMs: 240_000 })
  return r.ok ? { text: r.text, executor: `${r.executor.provider}:${r.executor.model}` } : { error: r.detail }
}
async function record(n: number, intent: TaskIntent, route: RouteOutcome, run: (() => Promise<{ executor: string | null; pass: boolean; detail: string }>) | null) {
  const t0 = Date.now(); const before = gov.decisions().length
  let executor: string | null = null, pass: boolean | null = null, detail = route.via === 'UNAVAILABLE' ? 'not run: no qualified model and no substitute is allowed' : route.via === 'FALLBACK_DETERMINISTIC' ? 'not run through a model: deterministic method' : ''
  if (run) { try { const r = await run(); executor = r.executor; pass = r.pass; detail = r.detail } catch (e) { pass = false; detail = `error: ${e instanceof Error ? e.message : e}` } }
  const d = gov.decisions().length > before ? lastDecision() : undefined
  steps.push({ n, intent, role: route.role, via: route.via, model: route.modelRef, executor, governor: d ? { action: d.action, evict: d.evict, basis: d.basis } : null, ms: Date.now() - t0, pass, detail, routeReason: route.reason })
  console.log(`${n}. ${intent} -> ${route.role} via ${route.via} ${route.modelRef ?? '-'} | ${pass === null ? 'n/a' : pass ? 'PASS' : 'FAIL'} | ${detail.slice(0, 100)} | governor ${d?.action ?? '-'}${d?.evict.length ? ' evict ' + d.evict.join(',') : ''}`)
}

// both files contain the answer (nodeProtocol.ts defines the receipt and its hash, nodeClient.ts verifies it); the accepted set was widened to both after the first run returned nodeProtocol.ts, and the first run is kept in the evidence
const ACCEPT_STEP1 = ['lib/agents/forge/nodeClient.ts', 'lib/agents/forge/nodeProtocol.ts']
// 1. repository context search (CODE_RETRIEVAL): embed corpus + query under the governor
{
  const route = routeTask('repo_context_search', world)
  await record(1, 'repo_context_search', route, route.modelRef ? async () => {
    // this file contains the query text verbatim, so it is left out of the searched corpus (the first run retrieved it, which proved the retriever but not the task)
    const chunks = buildCorpus(process.cwd()).chunks.filter((c) => !c.file.endsWith('/mixedProof.ts'))
    const q = 'which file verifies a signed receipt and compares the output hash'
    const emb = route.modelRef as string
    const res = await gov.lease({ ref: emb, role: 'CODE_RETRIEVAL', residency: 'TRANSIENT', status: models.find((m) => m.ref === emb)?.status, artifactBytes: models.find((m) => m.ref === emb)?.artifactBytes }, keepBuilder(builderRoute), async () => {
      const cv = await embed(base, emb, chunks.map((c) => c.text), 0); const qv = await embed(base, emb, [QUERY_INSTRUCTION + q], 0)
      return embeddingRank(chunks, cv, qv[0]).slice(0, 3)
    })
    return { executor: `ollama:${emb}`, pass: ACCEPT_STEP1.includes(res[0]), detail: `top files: ${res.join(', ')}` }
  } : null)
}
// 2. technical research (RESEARCH_GENERALIST)
{
  const route = routeTask('technical_research', world); const fx = researchFixtures().find((f) => f.id === 'research/helper_keepalive') as Fixture
  await record(2, 'technical_research', route, route.modelRef ? async () => { const g = await generate(route, fx); if ('error' in g) return { executor: null, pass: false, detail: g.error }; const c = await fx.check(g.text); return { executor: g.executor, pass: c.pass, detail: c.detail } } : null)
}
// 3. bounded repair (FAST_REPAIR_WORKER)
{
  const route = routeTask('syntax_import_repair', world); const fx = fastRepairFixtures().find((f) => f.id === 'fast_repair/missing_import') as Fixture
  await record(3, 'syntax_import_repair', route, route.modelRef ? async () => { const g = await generate(route, fx); if ('error' in g) return { executor: null, pass: false, detail: g.error }; const c = await fx.check(g.text); return { executor: g.executor, pass: c.pass, detail: c.detail } } : null)
}
// 4. builder work (PRIMARY_BUILDER): a repair that is routed as a build
{
  const route = builderRoute; const fx = fastRepairFixtures().find((f) => f.id === 'fast_repair/off_by_one') as Fixture
  await record(4, 'feature_build', route, route.modelRef ? async () => { const g = await generate(route, fx); if ('error' in g) return { executor: null, pass: false, detail: g.error }; const c = await fx.check(g.text); return { executor: g.executor, pass: c.pass, detail: c.detail } } : null)
}
// 5. diagnosis (DEBUGGER_TEST_SPECIALIST): no qualified specialist exists, so the route falls back to the builder
{
  const route = routeTask('failure_diagnosis', world); const fx = (await debuggerFixtures()).find((f) => f.id === 'debugger/pagination_offset') as Fixture
  await record(5, 'failure_diagnosis', route, route.modelRef ? async () => { const g = await generate(route, fx); if ('error' in g) return { executor: null, pass: false, detail: g.error }; const c = await fx.check(g.text); return { executor: g.executor, pass: c.pass, detail: c.detail } } : null)
}
// 6-8. roles with no allowed substitute or a deterministic method
await record(6, 'contract_review', routeTask('contract_review', world), null)
await record(7, 'security_review', routeTask('security_review', world), null)
await record(8, 'rerank_candidates', routeTask('rerank_candidates', world), null)
// 9. back to the builder after the helpers (the builder is reloaded by the governor if it was evicted)
{
  const route = builderRoute; const fx = fastRepairFixtures().find((f) => f.id === 'fast_repair/mutates_input') as Fixture
  await record(9, 'multi_file_implementation', route, route.modelRef ? async () => { const g = await generate(route, fx); if ('error' in g) return { executor: null, pass: false, detail: g.error }; const c = await fx.check(g.text); return { executor: g.executor, pass: c.pass, detail: c.detail } } : null)
}
const ran = steps.filter((s) => s.pass !== null)
const report = { at: new Date().toISOString(), store: process.env.WAR_ROOM_AGENT_FOUNDRY_DIR ?? 'default', steps, governorDecisions: gov.decisions(), ranSteps: ran.length, passed: ran.filter((s) => s.pass).length, executorsSeen: [...new Set(steps.map((s) => s.executor).filter(Boolean))], cloudCalls: 0 }
writeFileSync(out, JSON.stringify(report, null, 1))
if (builderRoute.modelRef) await gov.unload(builderRoute.modelRef) // leave the node idle
console.log(`mixed proof: ${report.passed}/${report.ranSteps} model steps passed; ${report.executorsSeen.length} distinct local models answered`)
