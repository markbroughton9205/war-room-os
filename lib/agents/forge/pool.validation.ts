import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { FIRST_POOL } from './registry'
import { assignPool, keepAliveFor, DEFAULT_POOL_POLICY } from './pool'
import { GovernorRefusal, ResidencyGovernor, planAdmission, type NodeState } from './governor'
import { NodeRegistry, placeOnNode, isPrivateHost, type NodeDescriptor } from './node'
import { governedClient } from './poolRuntime'
import { buildPoolView } from './poolView'
import { poolViewModel } from './poolViewModel'
import { ForgeStore } from './store'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { BenchmarkRecord, ModelEntry } from './types'

let fails = 0
const check = (n: string, ok: boolean, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : ' ' + d}`); if (!ok) fails++ }
const GiB = 1024 ** 3
const DEV = 'AliBilge/Huihui-Devstral-Small-2-24B-Instruct-2512-abliterated:q4_k_m'
const QWEN3 = 'huihui_ai/qwen3-abliterated:14b'
const CODER = 'qwen2.5-coder:14b'
const HEAVY = 'huihui_ai/devstral-2-abliterated:123b'
const bench = (o: Partial<BenchmarkRecord> = {}): BenchmarkRecord => ({ modelRef: DEV, executor: 'ollama:real', fixture: 'f', at: 'now', taskClass: 'complete_feature', verifierScore: { pass: 12, total: 12 }, completion: 'COMPLETED', modelCalls: 9, repairs: 0, retries: 0, regressions: 0, elapsedMs: 1000, manualIntervention: false, contextTokens: 8192, ramMiB: 'UNKNOWN', vramMiB: 'UNKNOWN', ...o })

// ---------------------------------------------------------------- pool: role assignment from evidence and policy
const a = assignPool(FIRST_POOL, [bench()])
const by = (r: string) => a.members.find((m) => m.role === r)!
check('Q01_the_builder_is_the_evidence_route_and_stays_resident', by('BUILDER').modelRef === DEV && by('BUILDER').basis === 'EVIDENCE' && by('BUILDER').residency === 'RESIDENT' && by('BUILDER').keepAlive === '10m' && a.residentRefs.join() === DEV)
check('Q02_helpers_are_transient_and_unload_at_once', ['TEST_REVIEWER', 'TEST_CANDIDATE'].every((r) => by(r).residency === 'TRANSIENT' && by(r).keepAlive === '0') && by('TEST_REVIEWER').modelRef === QWEN3 && by('TEST_CANDIDATE').modelRef === CODER)
check('Q03_the_heavy_model_is_never_assigned_and_the_reason_says_why', by('ESCALATION').modelRef === null && by('ESCALATION').residency === 'NEVER_IMPLICIT' && /FUTURE_HEAVY/.test(by('ESCALATION').reason) && /devstral-2-abliterated-123b/.test(by('ESCALATION').reason))
const none = assignPool(FIRST_POOL, [])
check('Q04_without_evidence_no_builder_is_chosen_and_nothing_is_defaulted', by('BUILDER') && none.members.find((m) => m.role === 'BUILDER')!.modelRef === null && none.members.find((m) => m.role === 'BUILDER')!.basis === 'NONE' && none.notes.some((n) => /no builder/.test(n)) && none.residentRefs.length === 0)
check('Q05_a_scripted_double_run_gives_no_builder_evidence', assignPool(FIRST_POOL, [bench({ executor: 'scripted-double' })]).members.find((m) => m.role === 'BUILDER')!.modelRef === null)
check('Q06_keep_alive_follows_the_role_and_defaults_to_unload', keepAliveFor(a, DEV) === '10m' && keepAliveFor(a, QWEN3) === '0' && keepAliveFor(a, 'something-else') === '0' && DEFAULT_POOL_POLICY.helperKeepAlive === '0')
const asBuilderToo = assignPool(FIRST_POOL.map((m) => (m.ref === QWEN3 ? { ...m, roles: ['review', 'complete_feature'] } : m)), [bench({ modelRef: QWEN3 })])
check('Q07_a_model_with_two_roles_keeps_the_resident_setting', keepAliveFor(asBuilderToo, QWEN3) === '10m')

// ---------------------------------------------------------------- governor: pure planning
const state = (o: Partial<NodeState> = {}): NodeState => ({ reachable: true, residents: [], vramTotalMiB: 16384, ramTotalMiB: 30000, gpuUsedMiB: 'UNKNOWN', ramUsedMiB: 'UNKNOWN', at: 'now', ...o })
const res = (ref: string, vramGiB: number, sizeGiB = vramGiB) => ({ ref, sizeBytes: sizeGiB * GiB, vramBytes: vramGiB * GiB })
check('Q10_a_heavy_model_is_refused_without_an_explicit_decision', planAdmission(state(), { ref: HEAVY, role: 'ESCALATION', residency: 'NEVER_IMPLICIT', status: 'FUTURE_HEAVY', artifactBytes: 70 * GiB }).action === 'REFUSE')
check('Q11_even_when_allowed_a_model_that_cannot_fit_VRAM_plus_RAM_is_refused', (() => { const p = planAdmission(state(), { ref: HEAVY, role: 'ESCALATION', residency: 'RESIDENT', status: 'FUTURE_HEAVY', artifactBytes: 70 * GiB, allowHeavy: true }); return p.action === 'REFUSE' && /cannot be resident/.test(p.reason) })())
check('Q12_an_unreachable_node_refuses', planAdmission(state({ reachable: false }), { ref: DEV, role: 'BUILDER', residency: 'RESIDENT' }).action === 'REFUSE')
check('Q13_an_already_resident_model_is_admitted_as_is', planAdmission(state({ residents: [res(DEV, 15)] }), { ref: DEV, role: 'BUILDER', residency: 'RESIDENT' }).action === 'ADMIT')
check('Q14_a_helper_that_fits_next_to_the_resident_is_admitted_without_eviction', (() => { const p = planAdmission(state({ residents: [res(QWEN3, 4)] }), { ref: CODER, role: 'TEST_CANDIDATE', residency: 'TRANSIENT', artifactBytes: 5 * GiB }); return p.action === 'ADMIT' && p.evict.length === 0 && p.basis === 'MEASURED' })())
check('Q15_a_helper_that_does_not_fit_unloads_the_residents_transient_first_and_only_as_many_as_needed', (() => { const p = planAdmission(state({ residents: [res(DEV, 10), res(CODER, 4)] }), { ref: QWEN3, role: 'TEST_REVIEWER', residency: 'TRANSIENT', artifactBytes: 9 * GiB }, [DEV]); return p.action === 'EVICT_THEN_ADMIT' && p.evict[0] === CODER && p.evict.join() === `${CODER},${DEV}` })())
check('Q16_unmeasured_sizes_unload_everything_and_say_so', (() => { const p = planAdmission(state({ residents: [{ ref: DEV, sizeBytes: 'UNKNOWN', vramBytes: 'UNKNOWN' }] }), { ref: QWEN3, role: 'TEST_REVIEWER', residency: 'TRANSIENT' }); return p.action === 'EVICT_THEN_ADMIT' && p.basis === 'UNKNOWN' && p.evict.join() === DEV })())
check('Q17_an_empty_node_admits', planAdmission(state(), { ref: DEV, role: 'BUILDER', residency: 'RESIDENT', artifactBytes: 15 * GiB }).action === 'ADMIT')

// ---------------------------------------------------------------- governor: serialization and eviction against a fake loopback runtime
let residents: { name: string; size: number; size_vram: number }[] = []
let concurrent = 0, maxConcurrent = 0
const calls: { model: string; keep: unknown; hasPrompt: boolean }[] = []
const server = http.createServer((req, rsp) => {
  if (req.method === 'GET' && req.url === '/api/ps') { rsp.writeHead(200, { 'content-type': 'application/json' }); return rsp.end(JSON.stringify({ models: residents })) }
  let raw = ''
  req.on('data', (d) => { raw += d })
  req.on('end', async () => {
    const b = JSON.parse(raw || '{}') as { model: string; keep_alive?: unknown; prompt?: string }
    calls.push({ model: b.model, keep: b.keep_alive, hasPrompt: typeof b.prompt === 'string' && b.prompt.length > 0 })
    if (!b.prompt) { residents = residents.filter((r) => r.name !== b.model); rsp.writeHead(200, { 'content-type': 'application/json' }); return rsp.end(JSON.stringify({ model: b.model, done: true, done_reason: 'unload' })) }
    concurrent += 1; maxConcurrent = Math.max(maxConcurrent, concurrent)
    await new Promise((r) => setTimeout(r, 60))
    if (!residents.some((r) => r.name === b.model)) residents.push({ name: b.model, size: 5 * GiB, size_vram: 5 * GiB })
    concurrent -= 1
    rsp.writeHead(200, { 'content-type': 'application/x-ndjson' })
    rsp.end(JSON.stringify({ response: 'ok', done: false }) + '\n' + JSON.stringify({ response: '', done: true, eval_count: 1, prompt_eval_count: 1 }) + '\n')
  })
})
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
const port = (server.address() as AddressInfo).port
const nodes = new NodeRegistry()
const reg = nodes.registerLocal('local', { vramMiB: 8192, ramMiB: 16384 }, `http://127.0.0.1:${port}`)
check('Q20_the_local_node_registers_over_loopback_only', reg.ok && reg.callable && nodes.callable().length === 1 && nodes.registerLocal('x', {}, 'https://api.openai.com').ok === false)
const localNode = (reg as unknown as { node: NodeDescriptor }).node
const gov = new ResidencyGovernor(localNode, { gpuUsedMiB: () => 'UNKNOWN', ramUsedMiB: () => 'UNKNOWN' })
const models: ModelEntry[] = FIRST_POOL.map((m) => (m.ref === DEV ? { ...m, artifactBytes: 5 * GiB } : m.ref === QWEN3 ? { ...m, artifactBytes: 5 * GiB } : m))
const asg = assignPool(models, [bench()])
const builder = governedClient(gov, asg, models, 'BUILDER')!, reviewer = governedClient(gov, asg, models, 'TEST_REVIEWER')!
check('Q21_a_role_without_a_model_or_a_never_implicit_role_has_no_client', governedClient(gov, asg, models, 'ESCALATION') === null && governedClient(gov, assignPool(models, []), models, 'BUILDER') === null)
const results = await Promise.all([builder.generate({ system: 's', prompt: 'p1' }), builder.generate({ system: 's', prompt: 'p2' }), reviewer.generate({ system: 's', prompt: 'p3' })])
check('Q22_generations_on_one_node_are_serialized_never_two_at_once', maxConcurrent === 1 && results.every((r) => r.ok) && gov.busy() === 0 && gov.queued() === 0, `max=${maxConcurrent}`)
const gens = calls.filter((c) => c.hasPrompt)
check('Q23_each_call_carries_the_keep_alive_of_its_role', gens.filter((c) => c.model === DEV).every((c) => c.keep === '10m') && gens.filter((c) => c.model === QWEN3).every((c) => c.keep === '0'), JSON.stringify(gens))
residents = [{ name: DEV, size: 5 * GiB, size_vram: 5 * GiB }, { name: CODER, size: 4 * GiB, size_vram: 4 * GiB }]
calls.length = 0
await reviewer.generate({ system: 's', prompt: 'review' })
const unloads = calls.filter((c) => !c.hasPrompt)
check('Q24_a_helper_that_does_not_fit_makes_the_governor_unload_the_resident_over_loopback', unloads.length >= 1 && unloads.every((u) => u.keep === 0) && unloads.some((u) => u.model === CODER) && gov.decisions().slice(-1)[0].action === 'EVICT_THEN_ADMIT', JSON.stringify(calls))
const heavyClient = governedClient(gov, assignPool(models, [bench()]), models, 'BUILDER')!
const refused = await new ResidencyGovernor(localNode, { gpuUsedMiB: () => 'UNKNOWN', ramUsedMiB: () => 'UNKNOWN', fetchImpl: (async () => { throw new Error('down') }) as typeof fetch }).lease({ ref: DEV, role: 'BUILDER', residency: 'RESIDENT' }, [], async () => 'ran').then(() => 'ran', (e) => (e instanceof GovernorRefusal ? 'refused' : 'other'))
check('Q25_an_unreachable_runtime_refuses_and_runs_nothing', refused === 'refused' && !!heavyClient)
const refusedClient = governedClient(new ResidencyGovernor(localNode, { gpuUsedMiB: () => 'UNKNOWN', ramUsedMiB: () => 'UNKNOWN', fetchImpl: (async () => { throw new Error('down') }) as typeof fetch }), asg, models, 'BUILDER')!
const rr = await refusedClient.generate({ system: 's', prompt: 'x' })
check('Q26_a_refusal_comes_back_as_a_failed_result_naming_the_governor_never_as_a_silent_fallback', !rr.ok && /governor refused/.test((rr as { detail: string }).detail))
for (let i = 0; i < 60; i++) await builder.generate({ system: 's', prompt: 'n' + i })
check('Q27_the_decision_log_is_bounded', gov.decisions().length === 50)
server.close()

// ---------------------------------------------------------------- nodes: the rack seam
const n2 = new NodeRegistry()
check('Q30_a_rack_node_needs_a_commander_approval_with_a_note', n2.registerRack({ id: 'r1', endpoint: 'http://192.168.1.20:11434' }).ok === false && (n2.registerRack({ id: 'r1', endpoint: 'http://192.168.1.20:11434', approvedByCommander: true }) as { code: string }).code === 'NO_COMMANDER_APPROVAL')
check('Q31_a_public_or_hosted_endpoint_is_never_registered_even_with_approval', (n2.registerRack({ id: 'r2', endpoint: 'https://api.openai.com', approvedByCommander: true, approvalNote: 'x' }) as { code: string }).code === 'NOT_PRIVATE_NETWORK' && (n2.registerRack({ id: 'r3', endpoint: 'http://8.8.8.8:11434', approvedByCommander: true, approvalNote: 'x' }) as { code: string }).code === 'NOT_PRIVATE_NETWORK' && (n2.registerRack({ id: 'r4', endpoint: 'http://u:p@10.0.0.5:11434', approvedByCommander: true, approvalNote: 'x' }) as { code: string }).code === 'INVALID')
const okRack = n2.registerRack({ id: 'rack-1', endpoint: 'http://10.0.0.7:11434', approvedByCommander: true, approvalNote: 'Commander approved rack node 1 for planning', capabilities: { vramMiB: 49152, ramMiB: 131072 } })
check('Q32_an_approved_private_rack_node_is_recorded_but_not_callable_in_this_slice', okRack.ok && !okRack.callable && n2.list().length === 1 && n2.callable().length === 0 && placeOnNode(n2, 10 * GiB).basis === 'NO_NODE')
check('Q33_placement_reports_fits_unknown_and_too_large_honestly', (() => { const n = new NodeRegistry(); n.registerLocal('l', { vramMiB: 16384, ramMiB: 30000 }, 'http://127.0.0.1:1'); const u = new NodeRegistry(); u.registerLocal('l', {}, 'http://127.0.0.1:1'); return placeOnNode(n, 10 * GiB).basis === 'FITS' && placeOnNode(n, 70 * GiB).basis === 'TOO_LARGE' && placeOnNode(u, 10 * GiB).basis === 'UNKNOWN_CAPACITY' && placeOnNode(n, undefined).basis === 'UNKNOWN_CAPACITY' })())
check('Q34_private_host_detection', isPrivateHost('10.1.2.3') && isPrivateHost('192.168.0.5') && isPrivateHost('172.16.0.1') && isPrivateHost('rack.local') && !isPrivateHost('172.32.0.1') && !isPrivateHost('8.8.8.8') && !isPrivateHost('example.com'))

// ---------------------------------------------------------------- read-only view for the Foundry panel
{
  const store = new ForgeStore(mkdtempSync(path.join(tmpdir(), 'pool-view-')))
  const down = await buildPoolView({ store, base: 'http://127.0.0.1:1', fetchImpl: (async () => { throw new Error('down') }) as typeof fetch })
  const vmDown = poolViewModel(down)
  check('Q40_with_the_runtime_down_the_view_says_UNKNOWN_and_unreachable_and_shows_the_declared_pool', !down.state.reachable && down.modelsSource === 'DECLARED_FIRST_POOL' && /UNREACHABLE/.test(vmDown.header) && vmDown.notes.some((n) => /did not answer/.test(n)) && vmDown.resident.length === 0)
  check('Q41_the_view_never_defaults_a_builder_when_there_is_no_evidence', vmDown.roles.find((r) => r.id === 'BUILDER')!.title.endsWith('not assigned') && vmDown.roles.find((r) => r.id === 'ESCALATION')!.detail.includes('never implicit'))
  const seen: string[] = []
  const srv = http.createServer((q, r) => { seen.push(`${q.method} ${q.url}`); r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ models: [{ name: DEV, size: 15 * GiB, size_vram: 12 * GiB }] })) })
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()))
  const up = await buildPoolView({ store, base: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` })
  srv.close()
  const vmUp = poolViewModel(up)
  check('Q42_with_the_runtime_up_the_view_lists_what_is_resident_with_measured_sizes', up.state.reachable && vmUp.resident.length === 1 && vmUp.resident[0].detail.includes('15360 MiB') && vmUp.resident[0].detail.includes('12288 MiB') && vmUp.nodes[0].detail.includes('loopback'))
  check('Q43_the_view_only_reads_it_issues_no_unload_and_no_generation', seen.length >= 1 && seen.every((x) => x === 'GET /api/ps'), JSON.stringify(seen))
}

console.log(`FORGE_POOL_VALIDATION ${fails ? 'FAIL (' + fails + ')' : 'PASS'}`)
process.exit(fails ? 1 : 0)
