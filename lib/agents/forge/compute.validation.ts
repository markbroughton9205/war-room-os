import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { generateKeyPairSync } from 'node:crypto'
import { assignPool } from './pool'
import { FIRST_POOL } from './registry'
import { MODEL_ROLES, LEGACY_TO_MODEL_ROLE, ROLE_GATES, type ModelRole } from './roles'
import { rankForRole } from './rank'
import { buildModelResourceProfile, estimateRequirement, requirementFor, type ModelResourceProfile } from './resourceProfile'
import { applyHeartbeat, isAllowedRackHost, nodeHealth, quarantine, revoke, verifyProbe, type HardwareProbe, type NodeRecord } from './nodeRecord'
import { EnrollmentBook, type EnrollRequest } from './enrollment'
import { ReplayGuard, canonicalize, generateNodeKey, newNonce, signEnvelope, verifyEnvelope } from './nodeProtocol'
import { dispatchJob } from './nodeClient'
import { SimNode, simRecord, SIM_EXECUTOR } from './simNode'
import { runWithFailover, schedule, type PlacementOk, type World } from './scheduler'
import { ForgeStore } from './store'
import type { BenchmarkRecord, ModelEntry, ResourceProfile } from './types'
import { readFileSync } from 'node:fs'
import { qualification, classRates } from './rank'
import { SPECIALIST_CANDIDATES, promoteFromEvidence, earnedRoles } from './specialists'
import { CLASS_GATES } from './roles'
import { recommendResidency } from './resourceProfile'
import { INTENT_ROLE, ROLE_FALLBACK, planPhases, routeTask, routingTable } from './roleRouting'
import { probeLocalNode, type LocalProbeDeps } from './localNode'
import { buildComputeView } from './computeView'
import { computeViewModel } from './computeViewModel'
import { shadowDecisions } from './computeShadow'

let fails = 0
const check = (n: string, ok: boolean, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : ' ' + d}`); if (!ok) fails++ }
const GiB = 1024 ** 3
const NOW = new Date('2026-10-13T12:00:00.000Z')
const iso = (ms: number) => new Date(ms).toISOString()

const mk = (id: string, o: Partial<ModelEntry> = {}): ModelEntry => ({ id, ref: id, family: id, roles: [], status: 'ACTIVE', license: { statement: 't', permissive: 'YES' }, lineage: { note: 't' }, routing: { eligible: true, reason: 't' }, ...o })
const BUILD = mk('builder:24b', { artifactBytes: 14 * GiB })
const REVIEW = mk('review:14b', { artifactBytes: 9 * GiB })
const FAST = mk('fast:7b', { artifactBytes: 4.7 * GiB })
const BIG = mk('big:30b', { artifactBytes: 19 * GiB })
const BASE = mk('base:14b', { status: 'BASELINE', routing: { eligible: false, reason: 'baseline' } })
const HEAVY = mk('heavy:123b', { status: 'FUTURE_HEAVY', routing: { eligible: false, reason: 'heavy' }, artifactBytes: 70 * GiB })
const MODELS = [BUILD, REVIEW, FAST, BIG, BASE, HEAVY]

const run = (ref: string, role: ModelRole | undefined, ok: boolean, o: Partial<BenchmarkRecord> = {}): BenchmarkRecord => ({
  modelRef: ref, executor: 'ollama:real', fixture: 'f', at: 'now', taskClass: 'complete_feature', verifierScore: ok ? { pass: 12, total: 12 } : { pass: 6, total: 12 }, completion: ok ? 'COMPLETED' : 'FAILED',
  modelCalls: 5, repairs: 0, retries: 0, regressions: 0, elapsedMs: 1000, manualIntervention: false, contextTokens: 8192, ramMiB: 'UNKNOWN', vramMiB: 'UNKNOWN', ...(role ? { role } : {}), ...o,
})
const many = (ref: string, role: ModelRole, wins: number, losses = 0) => [...Array(wins)].map(() => run(ref, role, true)).concat([...Array(losses)].map(() => run(ref, role, false)))

// ------------------------------------------------------------------ roles
check('C01_there_are_eight_compute_roles_each_with_a_gate', MODEL_ROLES.length === 8 && MODEL_ROLES.every((r) => ROLE_GATES[r].minRuns > 0 && ROLE_GATES[r].minRate > 0))
check('C02_every_legacy_pool_role_maps_and_escalation_maps_to_nothing', LEGACY_TO_MODEL_ROLE.BUILDER === 'PRIMARY_BUILDER' && LEGACY_TO_MODEL_ROLE.TEST_REVIEWER === 'ARCHITECT_REVIEWER' && LEGACY_TO_MODEL_ROLE.ESCALATION === null && Object.keys(LEGACY_TO_MODEL_ROLE).length === 5)

/** reviewer runs carry fixture classes (7 flawed, 3 clean per 10); losses are placed on flawed fixtures so the 90% clean gate still holds */
const archRuns = (ref: string, wins: number, losses = 0): BenchmarkRecord[] => [...Array(losses)].map(() => run(ref, 'ARCHITECT_REVIEWER', false)).concat([...Array(wins)].map(() => run(ref, 'ARCHITECT_REVIEWER', true))).map((b, i) => ({ ...b, fixtureClass: i % 10 < 7 ? 'flawed' : 'clean' }))
// ------------------------------------------------------------------ ranking by role
const rb = [...many(BUILD.ref, 'PRIMARY_BUILDER', 9), ...archRuns(REVIEW.ref, 9, 1), ...many(FAST.ref, 'FAST_REPAIR_WORKER', 5)]
const rBuilder = rankForRole('PRIMARY_BUILDER', MODELS, rb)
check('C03_a_model_with_a_full_gate_is_qualified_for_its_role', rBuilder.ranked[0]?.ref === BUILD.ref && rBuilder.ranked[0].qualified && rBuilder.basis === 'EVIDENCE')
check('C04_evidence_for_one_role_gives_no_credit_in_another', rankForRole('RESEARCH_GENERALIST', MODELS, rb).basis === 'NO_EVIDENCE' && !rankForRole('ARCHITECT_REVIEWER', MODELS, rb).ranked.some((r) => r.ref === BUILD.ref))
const rRev = rankForRole('ARCHITECT_REVIEWER', MODELS, rb).ranked[0]
check('C05_a_90_percent_reviewer_passes_the_80_percent_gate_with_its_counts_shown', rRev.qualified && rRev.evidence.ok === 9 && rRev.evidence.n === 10 && /9\/10/.test(rRev.reason))
const rFast = rankForRole('FAST_REPAIR_WORKER', MODELS, rb).ranked[0]
check('C06_five_clean_runs_is_provisional_not_qualified', !rFast.qualified && rFast.provisional && /provisional/.test(rFast.reason))
check('C07_baseline_and_future_heavy_models_are_never_ranked', !rankForRole('PRIMARY_BUILDER', MODELS, [...rb, ...many(BASE.ref, 'PRIMARY_BUILDER', 20), ...many(HEAVY.ref, 'PRIMARY_BUILDER', 20)]).ranked.some((r) => r.ref === BASE.ref || r.ref === HEAVY.ref))
check('C08_scripted_and_simulated_executors_are_never_evidence', rankForRole('PRIMARY_BUILDER', MODELS, many(BUILD.ref, 'PRIMARY_BUILDER', 9).map((b) => ({ ...b, executor: SIM_EXECUTOR }))).basis === 'NO_EVIDENCE')
check('C09_legacy_task_class_counts_for_the_builder_role_only', rankForRole('PRIMARY_BUILDER', MODELS, [run(BUILD.ref, undefined, true)]).ranked.length === 1 && rankForRole('FAST_REPAIR_WORKER', MODELS, [run(BUILD.ref, undefined, true)]).ranked.length === 0)
check('C10_frontier_assisted_and_manual_runs_are_not_successes', rankForRole('PRIMARY_BUILDER', MODELS, [run(BUILD.ref, 'PRIMARY_BUILDER', true, { cleanKind: 'CLEAN_WITH_FRONTIER_ASSIST' }), run(BUILD.ref, 'PRIMARY_BUILDER', true, { manualIntervention: true })]).ranked[0].evidence.ok === 0)
check('C11_a_model_with_no_run_for_the_role_is_listed_as_no_evidence', rBuilder.noEvidence.includes(REVIEW.ref) && rBuilder.noEvidence.includes(BIG.ref))

// ------------------------------------------------------------------ resource profile
const rp: ResourceProfile = { modelRef: BUILD.ref, at: iso(NOW.getTime()), basis: 'MEASURED', residency: 'FULL_GPU', artifactBytes: 14 * GiB, vramBytesLoaded: 13 * GiB, gpuUsedMiBAfterLoad: 13500, systemRamUsedMiBAfterLoad: 9000, contextTokens: 8192, loadMs: 9000, firstTokenMs: 800, tokensPerSecond: 40, note: 't' }
const prof = buildModelResourceProfile({ profile: rp, nodeId: 'local', quantization: 'q4_K_M', residency: 'RESIDENT', benchmarks: rb })
check('C12_profile_carries_measured_vram_and_only_qualified_roles', prof.vramRequiredMiB === 13312 && prof.activeMemoryMiB === 13312 && prof.taskRoles.join() === 'PRIMARY_BUILDER' && prof.successRate.PRIMARY_BUILDER?.n === 9 && prof.nodeId === 'local')
check('C13_unmeasured_fields_stay_unknown_never_zero', buildModelResourceProfile({ profile: { ...rp, basis: 'UNKNOWN', vramBytesLoaded: 'UNKNOWN', loadMs: 'UNKNOWN' }, nodeId: 'local' }).vramRequiredMiB === 'UNKNOWN' && prof.ramRequiredMiB === 'UNKNOWN')
const part = buildModelResourceProfile({ profile: { ...rp, residency: 'PARTIAL_OFFLOAD', artifactBytes: 19 * GiB, vramBytesLoaded: 15 * GiB }, nodeId: 'local' })
check('C14_partial_offload_reports_the_ram_share', part.ramRequiredMiB === 4096)
const est = estimateRequirement(19 * GiB, 16311)
check('C15_estimates_are_labelled_estimated_and_spill_to_ram', est.basis === 'ESTIMATED' && 'vramMiB' in est && est.vramMiB === Math.round(16311 * 0.9) && est.ramMiB > 4000)
check('C16_requirement_prefers_measured_then_estimated_then_unknown', requirementFor(prof, undefined, 16311).basis === 'MEASURED' && requirementFor(undefined, 5 * GiB, 16311).basis === 'ESTIMATED' && requirementFor(undefined, undefined, 16311).basis === 'UNKNOWN')

// ------------------------------------------------------------------ node health, heartbeat, probe
const HW: HardwareProbe = { cpu: { model: 'x', cores: 8, threads: 16 }, ramMiB: 30945, gpu: [{ model: 'RTX 5060 Ti', vramMiB: 16311 }], storage: { totalBytes: 900 * GiB, freeBytes: 600 * GiB }, installedModels: [
  { ref: BUILD.ref, digest: 'sha256:b', sizeBytes: 14 * GiB }, { ref: REVIEW.ref, digest: 'sha256:r', sizeBytes: 9 * GiB }, { ref: FAST.ref, digest: 'sha256:f', sizeBytes: 4.7 * GiB }] }
const load = { cpuPct: 5, gpuPct: 0, vramUsedMiB: 0, ramUsedMiB: 8000, queued: 0, at: NOW.toISOString() }
const local: NodeRecord = { nodeId: 'local', hostname: 'nebula', kind: 'LOCAL', endpoint: 'http://127.0.0.1:11434', cpu: HW.cpu, ramMiB: HW.ramMiB, gpu: HW.gpu, storage: HW.storage, networkMbps: 100, load, resident: [], installedModels: HW.installedModels, availableModels: [BIG.ref], health: 'HEALTHY', lastHeartbeat: NOW.toISOString(), capabilities: { concurrency: 1, runtimes: ['ollama'], roles: [...MODEL_ROLES] }, identity: null }
const ago = (ms: number) => new Date(NOW.getTime() - ms)
check('C17_a_fresh_heartbeat_is_healthy', nodeHealth(local, NOW) === 'HEALTHY')
check('C18_a_late_heartbeat_degrades_and_three_missed_lose_the_node', nodeHealth({ ...local, lastHeartbeat: ago(16_000).toISOString() }, NOW) === 'DEGRADED' && nodeHealth({ ...local, lastHeartbeat: ago(31_000).toISOString() }, NOW) === 'UNREACHABLE')
check('C19_overload_or_a_self_report_degrades', nodeHealth({ ...local, load: { ...load, queued: 5 } }, NOW) === 'DEGRADED' && nodeHealth({ ...local, health: 'DEGRADED' }, NOW) === 'DEGRADED')
check('C20_revoked_and_quarantined_are_sticky_even_with_fresh_heartbeats', nodeHealth(revoke(local, NOW), NOW) === 'QUARANTINED' && nodeHealth(quarantine(local, 'x'), NOW) === 'QUARANTINED')
const hb = { nodeId: 'local', challenge: 'c', load, resident: [], installedModels: HW.installedModels, selfHealth: 'HEALTHY' as const, nonce: 'n', issuedAt: iso(NOW.getTime() - 3_600_000) }
const ap = applyHeartbeat({ ...local, lastHeartbeat: ago(100_000).toISOString() }, hb, NOW)
check('C21_heartbeat_time_is_receive_time_not_the_nodes_claim', ap.ok && ap.node.lastHeartbeat === NOW.toISOString())
check('C22_a_heartbeat_for_another_node_or_with_bad_load_is_refused', !applyHeartbeat(local, { ...hb, nodeId: 'other' }, NOW).ok && !applyHeartbeat(local, { ...hb, load: { ...load, gpuPct: 400 } }, NOW).ok)
check('C23_resident_models_must_be_installed', !applyHeartbeat(local, { ...hb, resident: [{ ref: 'ghost:1b', sizeBytes: 1, vramBytes: 1 }] }, NOW).ok)
check('C24_probe_mismatch_on_vram_ram_threads_or_digest_is_reported', verifyProbe(local, HW).ok && !verifyProbe(local, { ...HW, gpu: [{ model: 'x', vramMiB: 8000 }] }).ok && !verifyProbe(local, { ...HW, ramMiB: 16000 }).ok && !verifyProbe(local, { ...HW, installedModels: HW.installedModels.map((m) => ({ ...m, digest: 'sha256:evil' })) }).ok && !verifyProbe(local, { ...HW, cpu: { ...HW.cpu, threads: 4 } }).ok)
check('C25_rack_hosts_must_be_private_tailnet_lan_or_loopback', ['192.168.1.5', '10.0.0.2', '172.16.3.3', '100.64.1.1', '100.127.0.9', 'rack1.lan', 'box.local', '127.0.0.1'].every(isAllowedRackHost) && ['8.8.8.8', '100.128.0.1', '100.63.0.1', 'example.com', '172.32.0.1'].every((h) => !isAllowedRackHost(h)))

// ------------------------------------------------------------------ signing
const fKey = generateNodeKey(), nKey = generateNodeKey()
const pinN = { publicKeyPem: nKey.publicKeyPem, fingerprint: nKey.fingerprint }
const body = (extra: Record<string, unknown> = {}, at = NOW) => ({ nonce: newNonce(), issuedAt: at.toISOString(), v: 1, ...extra })
const env = signEnvelope(nKey, 'ping', body())
check('C26_a_signed_envelope_verifies_with_the_pinned_key', verifyEnvelope(env, pinN, 'ping', NOW, new ReplayGuard()).ok)
check('C27_a_tampered_body_fails_the_signature', (() => { const r = verifyEnvelope({ ...env, body: { ...env.body, v: 2 } }, pinN, 'ping', NOW, new ReplayGuard()); return !r.ok && r.code === 'BAD_SIGNATURE' })())
check('C28_another_signer_or_kind_is_refused', (() => { const e2 = signEnvelope(fKey, 'ping', body()); const a = verifyEnvelope(e2, pinN, 'ping', NOW, new ReplayGuard()); const b = verifyEnvelope(env, pinN, 'pong', NOW, new ReplayGuard()); return !a.ok && a.code === 'WRONG_SIGNER' && !b.ok && b.code === 'WRONG_KIND' })())
check('C29_a_replayed_message_is_refused', (() => { const g = new ReplayGuard(); const a = verifyEnvelope(env, pinN, 'ping', NOW, g); const b = verifyEnvelope(env, pinN, 'ping', NOW, g); return a.ok && !b.ok && b.code === 'REPLAY' })())
check('C30_a_message_outside_the_60s_window_is_stale_either_way', (() => { const old = signEnvelope(nKey, 'ping', body({}, ago(61_000))); const fut = signEnvelope(nKey, 'ping', body({}, new Date(NOW.getTime() + 61_000))); const a = verifyEnvelope(old, pinN, 'ping', NOW, new ReplayGuard()); const b = verifyEnvelope(fut, pinN, 'ping', NOW, new ReplayGuard()); return !a.ok && a.code === 'STALE' && !b.ok && b.code === 'STALE' })())
check('C31_a_full_replay_guard_fails_closed', (() => { const g = new ReplayGuard(2); const m = [1, 2, 3].map(() => verifyEnvelope(signEnvelope(nKey, 'ping', body()), pinN, 'ping', NOW, g)); return m[0].ok && m[1].ok && !m[2].ok })())
check('C32_a_pinned_key_that_does_not_match_its_fingerprint_is_refused', (() => { const r = verifyEnvelope(env, { publicKeyPem: fKey.publicKeyPem, fingerprint: nKey.fingerprint }, 'ping', NOW, new ReplayGuard()); return !r.ok })())
check('C33_garbage_is_malformed_not_a_crash', [null, 'x', {}, { kind: 'ping' }].every((g) => { const r = verifyEnvelope(g, pinN, 'ping', NOW, new ReplayGuard()); return !r.ok && r.code === 'MALFORMED' }))
check('C34_canonical_json_ignores_key_order', canonicalize({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: undefined } }) === canonicalize({ a: { c: undefined, d: [1, { y: 2, z: 1 }] }, b: 1 }))

// ------------------------------------------------------------------ enrollment
const enReq = (token: string, o: Partial<EnrollRequest> = {}): EnrollRequest => ({ token, nodeId: 'rack-a', hostname: 'rack-a.lan', endpoint: 'https://192.168.1.50:8443', publicKeyPem: nKey.publicKeyPem, probe: HW, runtimes: ['ollama'], roles: ['PRIMARY_BUILDER'], concurrency: 1, ...o })
const mint = (b: EnrollmentBook) => { const m = b.mint({ approvedByCommander: true, approvalNote: 'Commander approved rack-a', now: NOW }); if (!m.ok) throw new Error('mint'); return m.token }
{
  const b = new EnrollmentBook()
  check('C35_minting_needs_a_commander_approval_with_a_note', !b.mint({ approvedByCommander: false, approvalNote: 'x', now: NOW }).ok && !b.mint({ approvedByCommander: true, approvalNote: '  ', now: NOW }).ok)
  const t = mint(b)
  const ok = b.redeem(enReq(t), NOW)
  check('C36_enrollment_pins_the_nodes_key_and_records_the_approval', ok.ok && ok.node.identity?.pubkeyFingerprint === nKey.fingerprint && ok.node.kind === 'RACK' && /Commander/.test(ok.node.identity.approvalNote))
  const again = b.redeem(enReq(t, { nodeId: 'rack-b' }), NOW)
  check('C37_a_token_works_once', !again.ok && again.code === 'BAD_TOKEN')
  const cases: [string, Partial<EnrollRequest>, string][] = [
    ['public_host', { endpoint: 'https://example.com' }, 'NOT_PRIVATE_NETWORK'], ['credentials', { endpoint: 'https://u:p@192.168.1.5' }, 'INVALID_ENDPOINT'], ['plain_http_off_loopback', { endpoint: 'http://192.168.1.5:11434' }, 'INSECURE_TRANSPORT'],
    ['id_local', { nodeId: 'local' }, 'INVALID_ID'], ['id_shape', { nodeId: 'Bad Id!' }, 'INVALID_ID'], ['dup', { nodeId: 'rack-a' }, 'DUPLICATE'],
    ['rsa_key', { publicKeyPem: generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' }).toString() }, 'BAD_KEY'], ['junk_key', { publicKeyPem: 'nope' }, 'BAD_KEY'],
    ['no_ram', { probe: { ...HW, ramMiB: 0 } }, 'PROBE_MISMATCH'],
  ]
  for (const [name, patch, code] of cases) {
    const b2 = new EnrollmentBook(); if (name === 'dup') b2.redeem(enReq(mint(b2)), NOW)
    const r = b2.redeem(enReq(mint(b2), patch), NOW)
    check(`C38_refused_${name}`, !r.ok && r.code === code, JSON.stringify(r))
  }
  const b3 = new EnrollmentBook(); const t3 = mint(b3)
  b3.redeem(enReq(t3, { endpoint: 'https://example.com' }), NOW)
  check('C39_a_failed_attempt_burns_the_token', (() => { const r = b3.redeem(enReq(t3), NOW); return !r.ok && r.code === 'BAD_TOKEN' })())
  const b4 = new EnrollmentBook(); const t4 = mint(b4)
  check('C40_an_expired_token_is_refused', (() => { const r = b4.redeem(enReq(t4), new Date(NOW.getTime() + 16 * 60_000)); return !r.ok && r.code === 'EXPIRED' })())
  check('C41_loopback_http_is_allowed_for_the_simulated_remote_proof', (() => { const b5 = new EnrollmentBook(); return b5.redeem(enReq(mint(b5), { endpoint: 'http://127.0.0.1:9999', simulated: true }), NOW).ok })())
}

// ------------------------------------------------------------------ dispatch against the simulated node
const rackKey = generateNodeKey()
const rackHw: HardwareProbe = { ...HW, installedModels: HW.installedModels }
const mkRack = (id = 'rack-a', fault: SimNode['fault'] = 'NONE') => { const key = generateNodeKey(); const sim = new SimNode(id, key, rackHw, { publicKeyPem: fKey.publicKeyPem, fingerprint: fKey.fingerprint }, undefined, () => NOW); sim.fault = fault; return { sim, key, rec: simRecord(id, key, rackHw, NOW) } }
const dArgs = (r: ReturnType<typeof mkRack>, o: Partial<Parameters<typeof dispatchJob>[0]> = {}) => ({ client: r.sim, node: r.rec, foundryKey: fKey, jobId: 'j1', attempt: 1, role: 'PRIMARY_BUILDER' as ModelRole, modelRef: BUILD.ref, digest: 'sha256:b', messages: [{ role: 'user' as const, content: 'hi' }], limits: { maxTokens: 1000, timeoutMs: 200 }, guard: new ReplayGuard(), now: () => NOW, ...o })
{
  const r = mkRack(); const seen: string[] = []
  const d = await dispatchJob(dArgs(r, { onDelta: (s) => seen.push(s) }))
  check('C42_a_good_job_returns_verified_output_with_the_node_identity', d.ok && d.output === 'sim:PRIMARY_BUILDER:j1' && d.keyFingerprint === r.key.fingerprint && d.receipt.digest === 'sha256:b' && seen.join('') === d.output)
  const faults: [SimNode['fault'], string][] = [['DIE_MID_STREAM', 'NODE_ERROR'], ['BAD_SIGNATURE', 'BAD_RECEIPT'], ['WRONG_SIGNER', 'BAD_RECEIPT'], ['TAMPER_OUTPUT', 'OUTPUT_HASH_MISMATCH'], ['WRONG_MODEL', 'MODEL_MISMATCH'], ['WRONG_DIGEST', 'DIGEST_MISMATCH'], ['HANG', 'TIMEOUT']]
  for (const [f, code] of faults) {
    const rr = mkRack('rack-a', f); const x = await dispatchJob(dArgs(rr))
    check(`C43_fault_${f}_is_${code}_and_returns_no_output`, !x.ok && x.code === code && !('output' in x), JSON.stringify(x))
  }
  const rr = mkRack(); const g = new ReplayGuard()
  const first = await dispatchJob(dArgs(rr, { guard: g })); rr.sim.fault = 'REPLAY_RECEIPT'
  const second = await dispatchJob(dArgs(rr, { guard: g, jobId: 'j2' }))
  check('C44_a_replayed_receipt_is_refused', first.ok && !second.ok && second.code === 'BAD_RECEIPT' && /REPLAY/.test(second.detail), JSON.stringify(second))
  const wrongFoundry = await dispatchJob(dArgs(mkRack(), { foundryKey: generateNodeKey() }))
  check('C45_a_node_refuses_jobs_not_signed_by_the_pinned_foundry', !wrongFoundry.ok && wrongFoundry.code === 'NODE_ERROR' && /job refused/.test(wrongFoundry.detail))
  const noId = mkRack(); const x = await dispatchJob(dArgs(noId, { node: { ...noId.rec, identity: null } }))
  check('C46_a_rack_node_without_identity_is_never_called', !x.ok && x.code === 'NODE_NOT_ENROLLED' && noId.sim.calls === 0)
  const notInstalled = await dispatchJob(dArgs(mkRack(), { modelRef: 'ghost:1b', digest: undefined }))
  check('C47_a_node_that_lacks_the_model_errors_cleanly', !notInstalled.ok && notInstalled.code === 'NODE_ERROR')
}

// ------------------------------------------------------------------ scheduler
const profs: ModelResourceProfile[] = []
const evidence = [...many(BUILD.ref, 'PRIMARY_BUILDER', 9), ...archRuns(REVIEW.ref, 10), ...many(FAST.ref, 'FAST_REPAIR_WORKER', 10)]
const world = (o: Partial<World> = {}): World => ({ nodes: [local], models: MODELS, benchmarks: evidence, profiles: profs, now: NOW, ...o })
const ok = (p: ReturnType<typeof schedule>): PlacementOk => { if (!p.ok) throw new Error('expected placement: ' + p.reason); return p }
check('S01_no_evidence_for_a_role_means_no_placement_and_nothing_is_defaulted', (() => { const p = schedule({ jobId: 'a', role: 'SECURITY_REVIEWER' }, world()); return !p.ok && p.code === 'NO_QUALIFIED_MODEL' })())
{
  const p = ok(schedule({ jobId: 'a', role: 'PRIMARY_BUILDER' }, world()))
  check('S02_the_qualified_builder_is_placed_on_the_local_node', p.modelRef === BUILD.ref && p.nodeId === 'local' && p.action === 'ADMIT' && p.basis !== 'UNKNOWN' && !p.simulated)
  const p2 = ok(schedule({ jobId: 'a', role: 'PRIMARY_BUILDER' }, world({ nodes: [{ ...local }] })))
  const shuffled = ok(schedule({ jobId: 'a', role: 'PRIMARY_BUILDER' }, world({ nodes: [mkRack('zz').rec, local, mkRack('aa').rec].reverse(), rackEnabled: true })))
  check('S03_same_snapshot_same_placement_and_hash', JSON.stringify(p) === JSON.stringify(p2) && p.snapshot === p2.snapshot && !!shuffled.nodeId)
  const nodesA = [mkRack('r1').rec, mkRack('r2').rec], nodesB = [...nodesA].reverse()
  const a = ok(schedule({ jobId: 'a', role: 'PRIMARY_BUILDER' }, world({ nodes: nodesA, rackEnabled: true }))), b = ok(schedule({ jobId: 'a', role: 'PRIMARY_BUILDER' }, world({ nodes: nodesB, rackEnabled: true })))
  check('S04_node_order_does_not_change_the_decision', a.nodeId === b.nodeId && a.modelRef === b.modelRef && a.nodeId === 'r1')
}
{
  const rack = mkRack('r1').rec
  const off = schedule({ jobId: 'a', role: 'PRIMARY_BUILDER' }, world({ nodes: [rack] }))
  check('S05_rack_nodes_are_not_used_unless_the_world_enables_them', !off.ok && off.rejected.some((r) => r.code === 'RACK_DISABLED'))
  const noid = schedule({ jobId: 'a', role: 'PRIMARY_BUILDER' }, world({ nodes: [{ ...rack, identity: null }], rackEnabled: true }))
  check('S06_a_rack_node_without_identity_is_never_scheduled', !noid.ok && noid.rejected.some((r) => r.code === 'NO_IDENTITY'))
  const on = ok(schedule({ jobId: 'a', role: 'PRIMARY_BUILDER' }, world({ nodes: [rack], rackEnabled: true })))
  check('S07_an_enrolled_sim_rack_node_is_placed_and_labelled_simulated', on.nodeId === 'r1' && on.simulated && /SIMULATED/.test(on.reason))
  const down = schedule({ jobId: 'a', role: 'PRIMARY_BUILDER' }, world({ nodes: [{ ...local, lastHeartbeat: ago(40_000).toISOString() }] }))
  check('S08_an_unreachable_node_is_skipped_with_the_reason', !down.ok && down.rejected.some((r) => r.code === 'NODE_UNHEALTHY'))
  const roleless = schedule({ jobId: 'a', role: 'PRIMARY_BUILDER' }, world({ nodes: [{ ...local, capabilities: { ...local.capabilities, roles: ['CODE_RETRIEVAL'] } }] }))
  check('S09_a_node_that_does_not_serve_the_role_is_skipped', !roleless.ok && roleless.rejected.some((r) => r.code === 'ROLE_NOT_SERVED'))
}
{
  const nosize = mk('nosize:8b'); const ev = many(nosize.ref, 'FAST_REPAIR_WORKER', 10)
  const unk = schedule({ jobId: 'a', role: 'FAST_REPAIR_WORKER' }, world({ models: [nosize], benchmarks: ev, nodes: [{ ...local, installedModels: [], availableModels: [] }] }))
  check('S10_unknown_requirement_is_never_fits', !unk.ok)
  const nosz = schedule({ jobId: 'a', role: 'FAST_REPAIR_WORKER' }, world({ models: [mk('nosize:8b', {})], benchmarks: ev, nodes: [{ ...local, installedModels: [{ ref: 'nosize:8b', digest: 'd', sizeBytes: 0 }] }] }))
  check('S11_a_zero_size_artifact_is_unknown_not_free', !nosz.ok && nosz.rejected.some((r) => r.code === 'UNKNOWN_REQUIREMENT'))
  const allow = schedule({ jobId: 'a', role: 'FAST_REPAIR_WORKER' }, world({ models: [mk('nosize:8b', {})], benchmarks: ev, allowUnknownRequirement: true, nodes: [{ ...local, installedModels: [{ ref: 'nosize:8b', digest: 'd', sizeBytes: 0 }] }] }))
  check('S12_benchmark_mode_may_allow_unknown_and_the_basis_says_unknown', allow.ok && allow.basis === 'UNKNOWN')
}
{
  const bigEv = many(BIG.ref, 'PRIMARY_BUILDER', 9)
  const tight = schedule({ jobId: 'a', role: 'PRIMARY_BUILDER' }, world({ models: [BIG], benchmarks: bigEv, nodes: [{ ...local, load: { ...load, ramUsedMiB: 27_000 }, installedModels: [{ ref: BIG.ref, digest: 'd', sizeBytes: 19 * GiB }] }] }))
  check('S13_a_model_that_spills_to_ram_is_refused_when_ram_is_short', !tight.ok && tight.rejected.some((r) => r.code === 'INSUFFICIENT_RAM'))
  const roomy = schedule({ jobId: 'a', role: 'PRIMARY_BUILDER' }, world({ models: [BIG], benchmarks: bigEv, nodes: [{ ...local, load: { ...load, ramUsedMiB: 6_000 }, installedModels: [{ ref: BIG.ref, digest: 'd', sizeBytes: 19 * GiB }] }] }))
  check('S14_the_same_model_is_placed_when_ram_is_free_with_an_estimated_basis', roomy.ok && roomy.basis !== 'MEASURED')
  const huge = schedule({ jobId: 'a', role: 'PRIMARY_BUILDER' }, world({ models: [mk('huge:123b', { artifactBytes: 70 * GiB })], benchmarks: many('huge:123b', 'PRIMARY_BUILDER', 9), nodes: [{ ...local, installedModels: [{ ref: 'huge:123b', digest: 'd', sizeBytes: 70 * GiB }] }] }))
  check('S15_a_model_larger_than_vram_plus_ram_is_refused', !huge.ok)
}
{
  const resident = { ref: BUILD.ref, sizeBytes: 14 * GiB, vramBytes: 13 * GiB }
  const busy = { ...local, resident: [resident], load: { ...load, vramUsedMiB: 13312 } }
  const p = ok(schedule({ jobId: 'a', role: 'ARCHITECT_REVIEWER' }, world({ nodes: [busy], keep: [BUILD.ref] })))
  check('S16_with_one_node_a_helper_evicts_the_builder_and_the_decision_says_so', p.action === 'EVICT_THEN_ADMIT' && p.evict.includes(BUILD.ref) && /evicts a kept resident/.test(p.reason))
  const rack = mkRack('r1').rec
  const p2 = ok(schedule({ jobId: 'a', role: 'ARCHITECT_REVIEWER' }, world({ nodes: [busy, rack], keep: [BUILD.ref], rackEnabled: true })))
  check('S17_with_a_second_node_the_helper_goes_there_and_the_builder_stays_resident', p2.nodeId === 'r1' && p2.evict.length === 0)
  const b = ok(schedule({ jobId: 'a', role: 'PRIMARY_BUILDER' }, world({ nodes: [busy, rack], keep: [BUILD.ref], rackEnabled: true })))
  check('S18_a_model_already_resident_is_preferred_over_a_cold_copy', b.nodeId === 'local' && b.action === 'ADMIT' && /already resident/.test(b.reason))
}
{
  const ev2 = [...many(BUILD.ref, 'PRIMARY_BUILDER', 9), ...many(BIG.ref, 'PRIMARY_BUILDER', 10)]
  const n = { ...local, installedModels: [...local.installedModels, { ref: BIG.ref, digest: 'd', sizeBytes: 5 * GiB }], resident: [{ ref: BUILD.ref, sizeBytes: 14 * GiB, vramBytes: 13 * GiB }] }
  const tiny = mk('big:30b', { artifactBytes: 5 * GiB })
  const p = ok(schedule({ jobId: 'a', role: 'PRIMARY_BUILDER' }, world({ models: [BUILD, tiny], benchmarks: ev2, nodes: [n] })))
  check('S19_residency_decides_inside_an_evidence_tier', p.modelRef === BUILD.ref)
  const p2 = ok(schedule({ jobId: 'a', role: 'PRIMARY_BUILDER' }, world({ models: [BUILD, tiny], benchmarks: [...many(BUILD.ref, 'PRIMARY_BUILDER', 9, 8), ...many(BIG.ref, 'PRIMARY_BUILDER', 10)], nodes: [n] })))
  check('S20_a_clearly_better_evidence_tier_beats_residency', (() => { const q = rankForRole('PRIMARY_BUILDER', [BUILD, tiny], [...many(BUILD.ref, 'PRIMARY_BUILDER', 9, 8), ...many(BIG.ref, 'PRIMARY_BUILDER', 10)]); return !q.ranked.find((r) => r.ref === BUILD.ref)?.qualified && p2.modelRef === BIG.ref })())
}
check('S21_future_heavy_and_baseline_models_are_never_scheduled_even_if_allowed_by_name', (() => { const p = schedule({ jobId: 'a', role: 'PRIMARY_BUILDER' }, world({ benchmarks: [...evidence, ...many(HEAVY.ref, 'PRIMARY_BUILDER', 20), ...many(BASE.ref, 'PRIMARY_BUILDER', 20)], allowUnqualified: [HEAVY.ref] })); return p.ok && p.modelRef === BUILD.ref })())
check('S22_provisional_models_are_used_only_when_the_world_allows_it', (() => { const ev = many(FAST.ref, 'FAST_REPAIR_WORKER', 4); const a = schedule({ jobId: 'a', role: 'FAST_REPAIR_WORKER' }, world({ benchmarks: ev })); const b = schedule({ jobId: 'a', role: 'FAST_REPAIR_WORKER' }, world({ benchmarks: ev, allowProvisional: true })); return !a.ok && b.ok })())
check('S23_benchmark_mode_can_name_an_unqualified_model_explicitly', (() => { const a = schedule({ jobId: 'a', role: 'SECURITY_REVIEWER' }, world({ allowUnqualified: [REVIEW.ref] })); return a.ok && a.modelRef === REVIEW.ref })())
{
  const rem = { ...local, installedModels: local.installedModels.filter((m) => m.ref !== BUILD.ref), availableModels: [BUILD.ref] }
  const a = schedule({ jobId: 'a', role: 'PRIMARY_BUILDER' }, world({ nodes: [rem] }))
  check('S24_a_model_that_is_only_available_is_not_moved_mid_mission', !a.ok && a.rejected.some((r) => r.code === 'NOT_INSTALLED' && /no model movement/.test(r.detail)))
  const b = ok(schedule({ jobId: 'a', role: 'PRIMARY_BUILDER' }, world({ nodes: [rem], allowPrepare: true })))
  check('S25_prepare_is_flagged_when_allowed', b.needsPrepare)
  const c = schedule({ jobId: 'a', role: 'PRIMARY_BUILDER' }, world({ nodes: [{ ...rem, networkMbps: 'UNKNOWN' }], allowPrepare: true }))
  check('S26_unknown_network_speed_refuses_a_transfer', !c.ok && c.rejected.some((r) => r.code === 'TRANSFER_UNKNOWN'))
  const d = schedule({ jobId: 'a', role: 'PRIMARY_BUILDER' }, world({ nodes: [{ ...local, installedModels: local.installedModels.map((m) => (m.ref === BUILD.ref ? { ...m, digest: 'sha256:evil' } : m)) }], models: [{ ...BUILD, digest: 'sha256:b' }, ...MODELS.slice(1)] }))
  check('S27_an_installed_digest_that_differs_from_the_pin_is_refused', !d.ok && d.rejected.some((r) => r.code === 'DIGEST_MISMATCH'))
  const e = schedule({ jobId: 'a', role: 'PRIMARY_BUILDER' }, world({ excluded: [{ nodeId: 'local' }] }))
  check('S28_excluded_nodes_are_skipped', !e.ok && e.rejected.some((r) => r.code === 'EXCLUDED'))
}
check('S29_a_degraded_node_loses_to_a_healthy_one_in_the_same_tier', (() => { const slow = { ...mkRack('r1').rec, load: { ...load, queued: 9 } }; const good = mkRack('r2').rec; const p = ok(schedule({ jobId: 'a', role: 'PRIMARY_BUILDER' }, world({ nodes: [slow, good], rackEnabled: true }))); return p.nodeId === 'r2' })())
check('S30_the_shorter_predicted_wait_wins_when_speed_is_measured', (() => {
  const mp = (nodeId: string, tps: number): ModelResourceProfile => ({ ...prof, nodeId, latency: { firstTokenMs: 100, tokensPerSecond: tps }, residency: 'COLD' })
  const a = { ...mkRack('r1').rec, load: { ...load, queued: 2 } }, b = { ...mkRack('r2').rec, load: { ...load, queued: 2 } }
  const p = ok(schedule({ jobId: 'a', role: 'PRIMARY_BUILDER', estTokens: 1000 }, world({ nodes: [a, b], rackEnabled: true, profiles: [mp('r1', 10), mp('r2', 50)] })))
  return p.nodeId === 'r2' })())

// ------------------------------------------------------------------ failover
const makeDispatch = (rigs: Record<string, ReturnType<typeof mkRack>>, guard = new ReplayGuard()) => (p: PlacementOk, attempt: number) => { const r = rigs[p.nodeId]; return dispatchJob(dArgs(r, { jobId: p.jobId, attempt, modelRef: p.modelRef, digest: p.digest, role: p.role, guard })) }
{
  const a = mkRack('r1', 'DIE_MID_STREAM'), b = mkRack('r2')
  const f = await runWithFailover({ jobId: 'f1', role: 'PRIMARY_BUILDER' }, { world: () => world({ nodes: [a.rec, b.rec], rackEnabled: true }), dispatch: makeDispatch({ r1: a, r2: b }) })
  check('S31_a_node_that_dies_mid_stream_fails_over_to_the_next_node_and_both_attempts_are_logged', f.ok && f.attempts.length === 2 && f.attempts[0].outcome?.ok === false && f.result.nodeId === 'r2' && f.attempts[1].placement.ok && f.result.output === 'sim:PRIMARY_BUILDER:f1')
  check('S32_an_availability_failure_is_not_a_quarantine_suspect', f.ok && !f.attempts[0].integrityFailure)
}
{
  const a = mkRack('r1', 'TAMPER_OUTPUT'), b = mkRack('r2')
  const f = await runWithFailover({ jobId: 'f2', role: 'PRIMARY_BUILDER' }, { world: () => world({ nodes: [a.rec, b.rec], rackEnabled: true }), dispatch: makeDispatch({ r1: a, r2: b }) })
  check('S33_tampered_output_fails_over_and_the_node_becomes_a_suspect', f.ok && f.result.nodeId === 'r2' && f.attempts[0].integrityFailure)
  const c = mkRack('r1', 'BAD_SIGNATURE'), d = mkRack('r2', 'BAD_SIGNATURE')
  const g = await runWithFailover({ jobId: 'f3', role: 'PRIMARY_BUILDER' }, { world: () => world({ nodes: [c.rec, d.rec], rackEnabled: true }), dispatch: makeDispatch({ r1: c, r2: d }) })
  check('S34_when_every_node_fails_the_job_is_blocked_with_both_suspects_and_no_output', !g.ok && g.suspects.join() === 'r1,r2' && g.attempts.length === 2)
}
{
  const a = mkRack('r1', 'HANG')
  const f = await runWithFailover({ jobId: 'f4', role: 'PRIMARY_BUILDER' }, { world: () => world({ nodes: [a.rec], rackEnabled: true }), dispatch: makeDispatch({ r1: a }) })
  check('S35_with_no_second_node_the_job_is_blocked_not_downgraded', !f.ok && f.attempts.length === 2 && !f.attempts[1].placement.ok && /no node can run/.test(f.reason))
  const r1 = mkRack('a1', 'DIE_MID_STREAM')
  let localCalls = 0
  const f2 = await runWithFailover({ jobId: 'f5', role: 'PRIMARY_BUILDER' }, { world: () => world({ nodes: [r1.rec, local], rackEnabled: true, models: MODELS }), dispatch: async (p, att) => { if (p.nodeId === 'local') { localCalls++; return { ok: true as const, output: 'local-output', nodeId: 'local', keyFingerprint: 'loopback', receipt: {} as never } } return makeDispatch({ a1: r1 })(p, att) } })
  check('S36_failover_can_fall_back_to_the_local_node', f2.ok && f2.result.nodeId === 'local' && localCalls === 1 && f2.attempts.length === 2 && f2.attempts[0].placement.ok && (f2.attempts[0].placement as PlacementOk).nodeId === 'a1')
}

// ------------------------------------------------------------------ store and legacy parity
{
  const dir = mkdtempSync(path.join(tmpdir(), 'compute-'))
  const s = new ForgeStore(dir)
  s.registerModel(BUILD); s.recordBenchmark(run(BUILD.ref, 'PRIMARY_BUILDER', true))
  const before = JSON.stringify([s.models(), s.benchmarks()])
  s.recordResourceProfile(prof); s.recordNode(local); s.recordNode({ ...local, health: 'DEGRADED' }); const sim = mkRack('r1').rec; s.recordNode(sim)
  check('S37_new_record_types_leave_the_existing_readers_unchanged', JSON.stringify([s.models(), s.benchmarks()]) === before && s.profiles().length === 0 && s.smokes().length === 0)
  check('S38_profiles_and_the_latest_node_snapshots_read_back', s.resourceProfiles(BUILD.ref, 'local').length === 1 && s.nodes().length === 2 && s.nodes().find((n) => n.nodeId === 'local')?.health === 'DEGRADED' && s.nodes().find((n) => n.nodeId === 'r1')?.simulated === true)
  check('S39_a_private_key_in_a_node_record_is_refused', (() => { try { s.recordNode({ ...local, nodeId: 'leak', hostname: rackKey.privateKeyPem }); return false } catch { return true } })())
}
check('S40_legacy_assign_pool_is_unchanged_by_the_compute_modules', (() => { const a = assignPool(FIRST_POOL, []); return a.members.length === 5 && a.members[0].role === 'BUILDER' && a.members[0].modelRef === null && a.members[4].role === 'ESCALATION' })())


// ------------------------------------------------------------------ stage 2: local node probe, view, shadow
const calls: string[] = []
const fakeFetch = (up: boolean): typeof fetch => (async (u: string | URL | Request, init?: RequestInit) => {
  const url = String(u); calls.push(`${init?.method ?? 'GET'} ${url.replace('http://127.0.0.1:11434', '')}`)
  if (!up) throw new Error('ECONNREFUSED')
  if (url.endsWith('/api/tags')) return new Response(JSON.stringify({ models: [{ name: BUILD.ref, size: 14 * GiB, digest: 'abc', details: { quantization_level: 'Q4_K_M' } }, { name: REVIEW.ref, size: 9 * GiB, digest: 'def' }, { name: 'bad', digest: 'x' }] }))
  if (url.endsWith('/api/ps')) return new Response(JSON.stringify({ models: [{ name: BUILD.ref, size: 15 * GiB, size_vram: 13 * GiB }] }))
  if (url.endsWith('/api/version')) return new Response(JSON.stringify({ version: '0.34.2' }))
  return new Response('', { status: 404 })
}) as typeof fetch
const pdeps = (up: boolean): LocalProbeDeps => ({ fetchImpl: fakeFetch(up), now: () => NOW, gpus: () => [{ model: 'RTX 5060 Ti', vramMiB: 16311, usedMiB: 2334, utilPct: 3 }], ram: () => ({ totalMiB: 30945, usedMiB: 11000 }), cpu: () => ({ model: 'x', cores: 8, threads: 16 }), disk: () => ({ totalBytes: 900 * GiB, freeBytes: 600 * GiB }), networkMbps: () => 100, hostname: () => 'nebula' })
{
  const up = await probeLocalNode({ deps: pdeps(true) })
  check('T01_the_local_node_record_is_measured_from_the_machine_and_the_runtime', up.reachable && up.record.kind === 'LOCAL' && up.record.identity === null && up.record.gpu[0].vramMiB === 16311 && up.record.ramMiB === 30945 && up.record.load.vramUsedMiB === 2334 && up.record.installedModels.length === 2 && up.record.installedModels[0].digest === 'sha256:abc' && up.runtimeVersion === '0.34.2' && up.record.networkMbps === 100)
  check('T02_models_without_a_size_are_not_invented_and_quantization_is_kept', !up.record.installedModels.some((m) => m.ref === 'bad') && up.quantizations[BUILD.ref] === 'Q4_K_M' && !(REVIEW.ref in up.quantizations))
  check('T03_resident_models_come_from_the_runtime_with_measured_vram', up.record.resident[0]?.ref === BUILD.ref && up.record.resident[0].vramBytes === 13 * GiB && nodeHealth(up.record, NOW) === 'HEALTHY')
  check('T04_probing_only_reads_never_posts', calls.every((c) => c.startsWith('GET ')) && calls.length === 3, calls.join())
  const down = await probeLocalNode({ deps: pdeps(false) })
  check('T05_an_unreachable_runtime_makes_the_node_unreachable_not_healthy', !down.reachable && nodeHealth(down.record, NOW) === 'UNREACHABLE' && down.record.installedModels.length === 0 && down.record.capabilities.runtimes.length === 0)
  const sched = schedule({ jobId: 'x', role: 'PRIMARY_BUILDER' }, world({ nodes: [down.record] }))
  check('T06_nothing_is_placed_on_an_unreachable_local_node', !sched.ok && sched.rejected.some((r) => r.code === 'NODE_UNHEALTHY'))
  check('T07_the_probe_refuses_a_non_loopback_runtime_address', await probeLocalNode({ base: 'http://192.168.1.9:11434', deps: pdeps(true) }).then(() => false, () => true))
}
{
  const dir = mkdtempSync(path.join(tmpdir(), 'compute-view-'))
  const st = new ForgeStore(dir)
  const view0 = await buildComputeView({ store: st, deps: pdeps(true), now: NOW })
  const vm0 = computeViewModel(view0)
  check('T08_with_no_evidence_every_role_is_not_placeable_and_says_so', view0.roles.length === 8 && view0.roles.every((r) => !r.placement.ok) && vm0.roles.every((r) => /not placeable/.test(r.title) && /no model has benchmark evidence|no model is qualified/.test(r.detail)))
  check('T09_the_view_notes_say_estimates_and_declared_pool_when_nothing_is_stored', view0.notes.some((n) => /no resource profiles/.test(n)) && view0.notes.some((n) => /declared first pool/.test(n)))
  for (const m of MODELS) st.registerModel(m)
  for (const b of evidence) st.recordBenchmark(b)
  st.recordResourceProfile(prof)
  const rack = mkRack('r1').rec; st.recordNode(rack)
  const view1 = await buildComputeView({ store: st, deps: pdeps(true), now: NOW })
  const vm1 = computeViewModel(view1)
  const pb = view1.roles.find((r) => r.role === 'PRIMARY_BUILDER')!.placement
  check('T10_with_evidence_the_view_shows_a_would_place_decision_on_the_local_node', pb.ok && pb.nodeId === 'local' && /placeable|local/.test(vm1.roles[0].title))
  check('T11_stored_rack_nodes_are_listed_labelled_simulated_and_receive_no_work', vm1.nodes.some((n) => /r1 \(rack, SIMULATED\)/.test(n.title)) && view1.roles.every((r) => !r.placement.ok || r.placement.nodeId === 'local') && view1.notes.some((n) => /not enabled/.test(n)))
  check('T12_measured_profiles_are_shown_with_their_basis', vm1.profiles.length === 1 && /full gpu \(measured\)/.test(vm1.profiles[0].detail) && /13312 MiB/.test(vm1.profiles[0].detail))
}
{
  const up = await probeLocalNode({ deps: pdeps(true) })
  const sh = shadowDecisions({ node: up.record, models: MODELS, benchmarks: [...many(BUILD.ref, 'PRIMARY_BUILDER', 2)], profiles: [], harness: [{ role: 'PRIMARY_BUILDER', modelRef: BUILD.ref }, { role: 'ARCHITECT_REVIEWER', modelRef: REVIEW.ref }, { role: 'FAST_REPAIR_WORKER', modelRef: null }], now: NOW })
  check('T13_shadow_agrees_with_the_harness_builder_using_provisional_evidence', sh[0].placement.ok && sh[0].agrees === true && /agrees/.test(sh[0].note))
  check('T14_shadow_reports_disagreement_and_unplaceable_roles_instead_of_hiding_them', sh[1].agrees === null || sh[1].agrees === false ? !sh[1].placement.ok && /would not place/.test(sh[1].note) : false)
  check('T15_shadow_without_a_harness_model_is_not_an_agreement', sh[2].agrees === null)
}
{
  const src = readFileSync(path.join(process.cwd(), 'lib/agents/ops/engineering/e2eRealModel.ts'), 'utf8')
  check('T16_the_harness_shadow_is_opt_in_and_never_replaces_the_builder_client', /process\.env\.FOUNDRY_COMPUTE === '1'/.test(src) && /mode: 'SHADOW'/.test(src) && /const real: ModelClient = poolGov \?/.test(src) && /compute: computeShadow/.test(src))
  const route = readFileSync(path.join(process.cwd(), 'app/api/foundry/agents/ops/route.ts'), 'utf8')
  check('T17_the_compute_section_is_behind_the_same_route_guard_as_pool', /section'\) === 'compute'/.test(route) && route.indexOf("=== 'compute'") > route.indexOf('export async function GET'))
}

// ------------------------------------------------------------------ stage 3: class gates and evidence-based promotion
const cls = (ref: string, role: ModelRole, klass: string, wins: number, losses: number): BenchmarkRecord[] => [...Array(wins)].map(() => run(ref, role, true, { fixtureClass: klass })).concat([...Array(losses)].map(() => run(ref, role, false, { fixtureClass: klass })))
{
  const SEC = mk('sec:7b')
  const flagsEverything = [...cls(SEC.ref, 'SECURITY_REVIEWER', 'vulnerable', 10, 0), ...cls(SEC.ref, 'SECURITY_REVIEWER', 'safe', 5, 2)]
  const q1 = qualification(SEC.ref, 'SECURITY_REVIEWER', flagsEverything)
  check('U01_a_security_model_that_flags_safe_code_fails_the_class_gate_despite_a_high_overall_rate', !q1.qualified && q1.evidence.rate >= 0.8 && q1.problems.some((p) => /safe .* class gate/.test(p)), JSON.stringify(q1.problems))
  const good = [...cls(SEC.ref, 'SECURITY_REVIEWER', 'vulnerable', 9, 1), ...cls(SEC.ref, 'SECURITY_REVIEWER', 'safe', 7, 0)]
  check('U02_detection_and_a_clean_false_positive_record_qualify', qualification(SEC.ref, 'SECURITY_REVIEWER', good).qualified)
  check('U03_a_missing_class_counts_against_the_model', !qualification(SEC.ref, 'SECURITY_REVIEWER', cls(SEC.ref, 'SECURITY_REVIEWER', 'vulnerable', 12, 0)).qualified && qualification(SEC.ref, 'SECURITY_REVIEWER', cls(SEC.ref, 'SECURITY_REVIEWER', 'vulnerable', 12, 0)).problems.some((p) => /no safe runs/.test(p)))
  check('U04_roles_without_class_gates_need_only_the_overall_gate', qualification(FAST.ref, 'FAST_REPAIR_WORKER', many(FAST.ref, 'FAST_REPAIR_WORKER', 19, 1)).qualified && !CLASS_GATES.FAST_REPAIR_WORKER)
  check('U05_class_rates_are_computed_per_class_for_one_role_only', (() => { const r = classRates(SEC.ref, 'SECURITY_REVIEWER', [...good, ...cls(SEC.ref, 'ARCHITECT_REVIEWER', 'safe', 5, 0)]); return r.vulnerable.n === 10 && r.safe.n === 7 && r.safe.rate === 1 })())
  check('U06_rank_for_role_uses_the_class_gates', (() => { const r = rankForRole('SECURITY_REVIEWER', [SEC], flagsEverything).ranked[0]; return !r.qualified && /class gate/.test(r.reason) })())
  const cand = SPECIALIST_CANDIDATES.find((c) => c.ref === 'qwen2.5-coder:7b')!
  const none = promoteFromEvidence(cand, [])
  check('U07_a_specialist_with_no_evidence_stays_a_candidate_and_ineligible', none.entry.status === 'CANDIDATE' && !none.entry.routing.eligible && none.earned.length === 0 && none.entry.roles.length === 0)
  const proof = promoteFromEvidence(cand, many(cand.ref, 'FAST_REPAIR_WORKER', 20), 'sha256:abc', 4 * GiB)
  check('U08_clearing_one_gate_promotes_to_active_with_only_that_role_and_pins_the_digest', proof.entry.status === 'ACTIVE' && proof.entry.routing.eligible && proof.earned.join() === 'FAST_REPAIR_WORKER' && proof.entry.digest === 'sha256:abc' && proof.entry.artifactBytes === 4 * GiB)
  check('U09_a_promoted_model_is_still_no_evidence_for_every_other_role', rankForRole('ARCHITECT_REVIEWER', [proof.entry], many(cand.ref, 'FAST_REPAIR_WORKER', 20)).basis === 'NO_EVIDENCE' && rankForRole('PRIMARY_BUILDER', [proof.entry], many(cand.ref, 'FAST_REPAIR_WORKER', 20)).basis === 'NO_EVIDENCE')
  check('U10_failing_a_role_gate_is_recorded_as_not_qualified_with_the_counts', (() => { const e = earnedRoles(cand.ref, many(cand.ref, 'DEBUGGER_TEST_SPECIALIST', 6, 14)); return e.earned.length === 0 && /6\/20/.test(e.evidence.DEBUGGER_TEST_SPECIALIST ?? '') && /not qualified/.test(e.evidence.DEBUGGER_TEST_SPECIALIST ?? '') })())
  check('U11_the_candidate_list_names_the_five_planned_models_with_licence_statements_and_none_is_eligible', SPECIALIST_CANDIDATES.length === 5 && SPECIALIST_CANDIDATES.every((c) => c.status === 'CANDIDATE' && !c.routing.eligible && c.license.statement.length > 10))
  check('U12_a_promoted_specialist_does_not_displace_the_builder_route', (() => { const a = assignPool([BUILD, proof.entry], [...many(BUILD.ref, 'PRIMARY_BUILDER', 2), ...many(cand.ref, 'FAST_REPAIR_WORKER', 20)].map((b) => ({ ...b, taskClass: 'complete_feature' as const, role: undefined })).slice(0, 2)); return a.members[0].modelRef === BUILD.ref })())
}

// ------------------------------------------------------------------ stage 3: routing by role with explicit fallback
{
  const fastEv = many(FAST.ref, 'FAST_REPAIR_WORKER', 20)
  const w = (o: Partial<World> = {}): World => world({ benchmarks: [...evidence, ...fastEv], ...o })
  const bw = (o: Partial<World> = {}): World => world({ benchmarks: many(BUILD.ref, 'PRIMARY_BUILDER', 9), ...o }) // only the builder has evidence
  const syn = routeTask('syntax_import_repair', w())
  check('V01_a_qualified_fast_repair_model_gets_syntax_and_import_repair', syn.via === 'SPECIALIST' && syn.modelRef === FAST.ref && syn.role === 'FAST_REPAIR_WORKER')
  check('V02_feature_builds_go_to_the_primary_builder_not_the_specialist', routeTask('feature_build', w()).modelRef === BUILD.ref && routeTask('feature_build', w()).via === 'PRIMARY_BUILDER')
  check('V03_small_implementation_stays_with_the_builder_because_the_suite_measures_edits_not_new_code', INTENT_ROLE.small_implementation === 'PRIMARY_BUILDER' && routeTask('small_implementation', w()).modelRef === BUILD.ref)
  const noFast = routeTask('syntax_import_repair', bw())
  check('V04_without_a_qualified_repair_model_the_builder_does_the_repair_and_the_route_says_so', noFast.via === 'FALLBACK_BUILDER' && noFast.modelRef === BUILD.ref && /builder does it itself/.test(noFast.reason) && ROLE_FALLBACK.FAST_REPAIR_WORKER === 'BUILDER')
  const rev = routeTask('contract_review', bw())
  check('V05_an_independent_review_is_never_done_by_the_builder', rev.via === 'UNAVAILABLE' && rev.modelRef === null && ROLE_FALLBACK.ARCHITECT_REVIEWER === 'NONE' && /no substitute/.test(rev.reason))
  const sec = routeTask('security_review', bw())
  check('V06_security_review_has_no_substitute_when_no_model_is_qualified', sec.via === 'UNAVAILABLE' && ROLE_FALLBACK.SECURITY_REVIEWER === 'NONE')
  const ret = routeTask('repo_context_search', bw())
  check('V07_retrieval_and_rerank_fall_back_to_deterministic_methods', ret.via === 'FALLBACK_DETERMINISTIC' && routeTask('rerank_candidates', bw()).via === 'FALLBACK_DETERMINISTIC')
  check('V08_when_the_builder_cannot_be_placed_a_repair_is_unavailable_not_invented', routeTask('syntax_import_repair', bw({ nodes: [{ ...local, lastHeartbeat: ago(60_000).toISOString() }] })).via === 'UNAVAILABLE')
  const tbl = routingTable(w())
  check('V09_the_table_covers_every_intent_once_and_every_role_has_a_fallback_rule', tbl.length === Object.keys(INTENT_ROLE).length && new Set(tbl.map((r) => r.intent)).size === tbl.length && MODEL_ROLES.every((r) => r in ROLE_FALLBACK))
  const dbg = routeTask('failure_diagnosis', w({ benchmarks: [...evidence, ...fastEv] }))
  check('V10_a_model_qualified_only_for_repair_is_not_used_for_diagnosis', dbg.via === 'FALLBACK_BUILDER' && dbg.modelRef === BUILD.ref)
}
// workflow hook: opt-in, bounded to the first retry of a bounded problem, never fails the step
{
  const wf = readFileSync(path.join(process.cwd(), 'lib/agents/ops/engineering/workflow.ts'), 'utf8')
  check('V11_the_fast_repair_hook_is_opt_in_first_retry_only_and_excludes_tests_and_route_conflicts', /fastRepair\?: \{ label: string; model: ModelClient \}/.test(wf) && /const useFastRepair = !!deps\.fastRepair && rej === 0 && job\.role !== 'test' && !contractFile/.test(wf) && /!\/\^route conflict/.test(wf))
  check('V12_a_failed_specialist_call_falls_back_to_the_builder_in_the_same_retry', /if \(!reply\.ok\) \{ fastStats\.failedCalls \+= 1; fastPending = false; reply = await askFile\(rejNotes, rej \+ 1\) \}/.test(wf))
  check('V13_the_result_reports_fast_repair_usage_only_when_configured', /\.\.\.\(deps\.fastRepair \? \{ fastRepair: \{ \.\.\.fastStats \} \} : \{\}\)/.test(wf))
}

// ------------------------------------------------------------------ stage 3: the designated primary builder
{
  const history = [...many(BUILD.ref, 'PRIMARY_BUILDER', 9, 3)]
  const noDesignation = schedule({ jobId: 'd1', role: 'PRIMARY_BUILDER' }, world({ benchmarks: history }))
  check('W01_without_a_designation_a_builder_with_failures_in_its_history_is_not_qualified', !noDesignation.ok)
  const designated = schedule({ jobId: 'd2', role: 'PRIMARY_BUILDER' }, world({ benchmarks: history, designatedBuilder: BUILD.ref }))
  check('W02_the_designated_builder_is_placed_on_its_proven_history_and_the_decision_says_so', designated.ok && designated.modelRef === BUILD.ref && /designated primary builder/.test(designated.reason))
  const rival = mk('rival:30b', { artifactBytes: 6 * GiB }); const rivalNode = { ...local, installedModels: [...local.installedModels, { ref: rival.ref, digest: 'd', sizeBytes: 6 * GiB }] }
  const better = schedule({ jobId: 'd3', role: 'PRIMARY_BUILDER' }, world({ models: [BUILD, rival], nodes: [rivalNode], benchmarks: [...history, ...many(rival.ref, 'PRIMARY_BUILDER', 20)], designatedBuilder: BUILD.ref }))
  check('W03_a_better_scoring_rival_never_replaces_the_designated_builder_by_the_scheduler', better.ok && better.modelRef === BUILD.ref)
  const missing = schedule({ jobId: 'd4', role: 'PRIMARY_BUILDER' }, world({ benchmarks: history, designatedBuilder: 'ghost:1b' }))
  check('W04_a_designated_builder_that_is_not_registered_or_not_installed_is_not_placed_and_nothing_takes_its_place', !missing.ok)
  const other = schedule({ jobId: 'd5', role: 'FAST_REPAIR_WORKER' }, world({ benchmarks: [...history, ...many(FAST.ref, 'FAST_REPAIR_WORKER', 20)], designatedBuilder: BUILD.ref }))
  check('W05_the_designation_only_affects_the_builder_role', other.ok && other.modelRef === FAST.ref)
  const resident = { ...local, resident: [{ ref: BUILD.ref, sizeBytes: 14 * GiB, vramBytes: 12 * GiB }], load: { ...load, vramUsedMiB: 14800 } }
  const bothQualified = schedule({ jobId: 'd6', role: 'FAST_REPAIR_WORKER' }, world({ nodes: [resident], benchmarks: [...many(BUILD.ref, 'FAST_REPAIR_WORKER', 20), ...many(FAST.ref, 'FAST_REPAIR_WORKER', 20)], keep: [BUILD.ref], designatedBuilder: BUILD.ref }))
  check('W06_when_the_builder_is_resident_and_also_qualified_for_repair_the_repair_stays_on_it_avoiding_a_swap', bothQualified.ok && bothQualified.modelRef === BUILD.ref && bothQualified.evict.length === 0)
}

// ------------------------------------------------------------------ stage 3: residency recommendation from measured numbers
{
  const ctx = { builderVramMiB: 12329, gpuTotalMiB: 16311, desktopIdleMiB: 2339 }
  check('X01_the_designated_builder_is_resident_with_a_ten_minute_keep_alive', (() => { const r = recommendResidency({ isBuilder: true, vramMiB: 12329, cpuOffloadMiB: 2912, loadMs: 14477 }, ctx); return r.recommendation === 'RESIDENT' && r.keepAlive === '10m' })())
  check('X02_a_helper_that_does_not_fit_next_to_the_builder_is_transient_with_keep_alive_zero_even_a_small_embedder', (() => { const r = recommendResidency({ isBuilder: false, vramMiB: 2029, cpuOffloadMiB: 0, loadMs: 1900 }, ctx); return r.recommendation === 'TRANSIENT' && r.keepAlive === '0' && /does not fit next to the builder/.test(r.reason) })())
  check('X03_a_model_that_needs_cpu_offload_is_on_demand_only', (() => { const r = recommendResidency({ isBuilder: false, vramMiB: 12290, cpuOffloadMiB: 6409, loadMs: 16182 }, ctx); return r.recommendation === 'ON_DEMAND_ONLY' })())
  check('X04_coexistence_is_recommended_only_when_the_measured_sizes_fit_with_the_desktops_use', (() => { const r = recommendResidency({ isBuilder: false, vramMiB: 800, cpuOffloadMiB: 0, loadMs: 900 }, { ...ctx, builderVramMiB: 9000 }); return r.recommendation === 'COEXIST_OK' && r.keepAlive === '5m' })())
  check('X05_an_unmeasured_model_is_unknown_and_unloads_at_once', (() => { const r = recommendResidency({ isBuilder: false, vramMiB: 'UNKNOWN', cpuOffloadMiB: 'UNKNOWN', loadMs: 'UNKNOWN' }, ctx); return r.recommendation === 'UNKNOWN' && r.keepAlive === '0' })())
}

// ------------------------------------------------------------------ context-integration stage: phases and the price of switching
{
  const embedM = mk('embed:0.6b', { artifactBytes: 0.6 * GiB }); const resM = mk('research:7b', { artifactBytes: 4.7 * GiB })
  const nodeP = { ...local, installedModels: [...local.installedModels, { ref: embedM.ref, digest: 'e', sizeBytes: 0.6 * GiB }, { ref: resM.ref, digest: 'r', sizeBytes: 4.7 * GiB }] }
  const clsRuns = (ref: string, role: ModelRole, n: number) => many(ref, role, n)
  const ev = [...many(BUILD.ref, 'PRIMARY_BUILDER', 9), ...clsRuns(embedM.ref, 'CODE_RETRIEVAL', 24), ...clsRuns(resM.ref, 'RESEARCH_GENERALIST', 20).map((b, i) => ({ ...b, fixtureClass: i % 5 < 3 ? 'answerable' : 'unanswerable' }))]
  const profs2: ModelResourceProfile[] = [{ ...prof, modelRef: embedM.ref, nodeId: 'local', loadMs: 1900 }, { ...prof, modelRef: resM.ref, nodeId: 'local', loadMs: 2400 }, { ...prof, modelRef: BUILD.ref, nodeId: 'local', loadMs: 15000 }]
  const w2 = world({ models: [BUILD, embedM, resM], nodes: [nodeP], benchmarks: ev, profiles: profs2, designatedBuilder: BUILD.ref })
  const plan = planPhases(['feature_build', 'technical_research', 'repo_context_search', 'failure_diagnosis'], w2)
  check('Y01_helper_phases_run_before_the_builder_in_order_retrieval_research_build', plan.phases.map((p) => p.name).join() === 'RETRIEVAL,RESEARCH,BUILD', plan.phases.map((p) => p.name).join())
  check('Y02_the_plan_counts_each_model_switch_once_with_its_measured_load_time', plan.switches === 3 && plan.estimatedSwitchMs === 1900 + 2400 + 15000, JSON.stringify([plan.switches, plan.estimatedSwitchMs]))
  check('Y03_work_the_builder_must_do_itself_joins_the_build_phase', plan.phases.find((p) => p.name === 'BUILD')!.intents.includes('failure_diagnosis'))
  const noHelp = planPhases(['feature_build', 'repo_context_search'], world({ models: [BUILD], benchmarks: many(BUILD.ref, 'PRIMARY_BUILDER', 9), designatedBuilder: BUILD.ref }))
  check('Y04_without_a_qualified_helper_there_is_only_the_build_phase_and_a_note_says_why', noHelp.phases.length === 1 && noHelp.switches === 1 && noHelp.notes.some((n) => /repo_context_search/.test(n)))
  const resident = { ...local, resident: [{ ref: BUILD.ref, sizeBytes: 14 * GiB, vramBytes: 12 * GiB }], load: { ...load, vramUsedMiB: 14800 } }
  const cheap = mk('helperA:7b', { artifactBytes: 4 * GiB }), other = { ...local, nodeId: 'other', installedModels: [{ ref: 'helperA:7b', digest: 'h', sizeBytes: 4 * GiB }] }
  const pick = schedule({ jobId: 'e1', role: 'FAST_REPAIR_WORKER' }, world({ models: [BUILD, cheap], nodes: [resident, other], benchmarks: [...many(BUILD.ref, 'PRIMARY_BUILDER', 9), ...many(cheap.ref, 'FAST_REPAIR_WORKER', 20)], keep: [BUILD.ref], designatedBuilder: BUILD.ref, reloadMs: { [BUILD.ref]: 18000 } }))
  check('Y05_an_option_that_evicts_the_builder_is_priced_with_its_reload', pick.ok && pick.nodeId === 'other' && pick.evict.length === 0)
  const onlyEvict = schedule({ jobId: 'e2', role: 'FAST_REPAIR_WORKER' }, world({ models: [BUILD, cheap], nodes: [{ ...resident, installedModels: [...resident.installedModels, { ref: 'helperA:7b', digest: 'h', sizeBytes: 4 * GiB }] }], benchmarks: [...many(BUILD.ref, 'PRIMARY_BUILDER', 9), ...many(BUILD.ref, 'FAST_REPAIR_WORKER', 20), ...many(cheap.ref, 'FAST_REPAIR_WORKER', 20)], keep: [BUILD.ref], designatedBuilder: BUILD.ref, reloadMs: { [BUILD.ref]: 18000 } }))
  check('Y06_with_the_builder_resident_and_qualified_for_repair_the_repair_stays_on_the_builder_instead_of_paying_two_swaps', onlyEvict.ok && onlyEvict.modelRef === BUILD.ref && onlyEvict.evict.length === 0, JSON.stringify(onlyEvict.ok ? [onlyEvict.modelRef, onlyEvict.evict] : onlyEvict.reason))
}

console.log(`FORGE_COMPUTE_VALIDATION ${fails ? 'FAIL (' + fails + ')' : 'PASS'}`)
process.exit(fails ? 1 : 0)
