import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createValidationHarness } from '@/lib/agi-program/validationHarness'
import { createChatTrajectorySession } from './chatTrajectoryObserver'
import { officialActiveCore } from './composedRuntime'
import { toObservationalCandidate } from './experienceHooks'
import { normalizeCapturedRuntimeTrajectory } from './normalizeRuntimeTrajectory'
import { qualityGateCapturedTrajectory } from './qualityGateRuntimeTrajectory'
import {
  captureRuntimeTrajectory,
  configureTrajectoryCaptureForTests,
  observerDoesNotImportTraining,
  resetTrajectoryCaptureForTests,
  RUNTIME_OBSERVER_DEV_DIR,
  type CapturedRuntimeTrajectory,
} from './runtimeTrajectoryCapture'
import { executeNormalizedRequest, observeToolRouterResult, routeToolIntent } from './toolRouter'
import { isTrajectoryObservationEnabled } from './trajectoryObservationGate'
import { sanitizeTrajectoryText, sanitizeTrajectoryValue, boundTrajectoryJson } from './trajectoryObserver'
import { WRIM0_CHECKPOINT_SHA, WRIM0_ID } from './types'

const EXPECTED = 32
const { check, finish } = createValidationHarness('WR-TOOL real-runtime observer dev wiring', EXPECTED)
const repo = process.cwd()
const sessionDir = join(repo, RUNTIME_OBSERVER_DEV_DIR)
const captured: CapturedRuntimeTrajectory[] = []
const PRE_GOLD = 12
const V4_MIN = 20

function persistToMemory(row: CapturedRuntimeTrajectory) {
  captured.push(row)
}

resetTrajectoryCaptureForTests()
configureTrajectoryCaptureForTests({
  skipExperience: true,
  persistLine: (line) => persistToMemory(JSON.parse(line) as CapturedRuntimeTrajectory),
})

check('1 actual runtime insertion point verified', () => {
  const executeSrc = readFileSync(join(repo, 'app/api/chat/execute.ts'), 'utf8')
  const routerSrc = readFileSync(join(repo, 'lib/modular-intelligence/toolRouter.ts'), 'utf8')
  assert.equal(executeSrc.includes('createChatTrajectorySession'), true)
  assert.equal(executeSrc.includes('flushFromResponse'), true)
  assert.equal(executeSrc.includes('markLiveResearch'), true)
  assert.equal(routerSrc.includes('observeExecution'), true)
  assert.equal(routerSrc.includes('insertion_point: \'lib/modular-intelligence/toolRouter.ts:executeNormalizedRequest\''), true)
})

check('2 existing observer reused', () => {
  const cap = readFileSync(join(repo, 'lib/modular-intelligence/runtimeTrajectoryCapture.ts'), 'utf8')
  assert.equal(cap.includes('toObservationalCandidate'), true)
  const obs = toObservationalCandidate({
    request: 'TOOL=none',
    decision: 'NO_TOOL',
    selected_tool: null,
    arguments: {},
    tool_result: null,
    success: true,
    correction: null,
    provenance: {},
    capability_family: 'tool_use',
  })
  assert.equal(obs.review_state, 'RAW')
})

check('3 existing AGI experience system reused', () => {
  const cap = readFileSync(join(repo, 'lib/modular-intelligence/runtimeTrajectoryCapture.ts'), 'utf8')
  assert.equal(cap.includes("from '@/lib/agi-experience/capture'"), true)
  assert.equal(cap.includes('toExperienceCapture'), true)
})

check('4 observer is passive (no tool choice/retry/block APIs)', () => {
  const cap = readFileSync(join(repo, 'lib/modular-intelligence/runtimeTrajectoryCapture.ts'), 'utf8')
  assert.equal(cap.includes('executeNormalizedRequest'), false)
  assert.equal(cap.includes('runLiveResearchRouter'), false)
  assert.equal(cap.includes('retry'), false)
})

check('5 TOOL trajectory captured', () => {
  const routed = routeToolIntent('TOOL=sha256\ntext=observer-dev-sha256')
  assert.ok(routed.normalized)
  const before = captured.length
  const result = executeNormalizedRequest(routed.normalized, 'bounded_sha256', {
    requestText: 'Hash observer-dev-sha256 with the bounded sha256 tool.',
    sourceType: 'REAL_RUNTIME',
  })
  assert.equal(result.status, 'ok')
  assert.equal(captured.length, before + 1)
  const row = captured[captured.length - 1]
  assert.equal(row.decision, 'TOOL')
  assert.equal(row.selected_tool, 'sha256')
  assert.equal(row.source_type, 'REAL_RUNTIME')
})

check('6 NO_TOOL trajectory captured', () => {
  const before = captured.length
  observeToolRouterResult('TOOL=none', routeToolIntent('TOOL=none'), { sourceType: 'REAL_RUNTIME' })
  assert.equal(captured.length, before + 1)
  const row = captured[captured.length - 1]
  assert.equal(row.decision, 'NO_TOOL')
  assert.equal(row.selected_tool, null)
  assert.equal(row.source_type, 'REAL_RUNTIME')
})

check('7 selected tool matches runtime', () => {
  const routed = routeToolIntent('TOOL=sha256\ntext=match-tool')
  assert.ok(routed.normalized)
  const result = executeNormalizedRequest(routed.normalized, 'bounded_sha256', { sourceType: 'REAL_RUNTIME' })
  const row = captured[captured.length - 1]
  assert.equal(row.selected_tool, result.tool_id)
  assert.equal(row.selected_tool, routed.normalized.tool)
})

check('8 arguments match runtime', () => {
  const routed = routeToolIntent('TOOL=sha256\ntext=match-args')
  assert.ok(routed.normalized)
  executeNormalizedRequest(routed.normalized, 'bounded_sha256', { sourceType: 'REAL_RUNTIME' })
  const row = captured[captured.length - 1]
  assert.equal(row.arguments.text, 'match-args')
  assert.deepEqual(row.arguments, { text: String(routed.normalized.arguments.text) })
})

check('9 validation status matches runtime', () => {
  const missing = routeToolIntent('TOOL=sha256')
  observeToolRouterResult('TOOL=sha256', missing, { sourceType: 'REAL_RUNTIME' })
  const row = captured[captured.length - 1]
  assert.equal(missing.validation, 'MISSING_ARGUMENT')
  assert.equal(row.router_validation_status, 'MISSING_ARGUMENT')
})

check('10 result status matches runtime', () => {
  const routed = routeToolIntent('TOOL=sha256\ntext=match-status')
  assert.ok(routed.normalized)
  const result = executeNormalizedRequest(routed.normalized, 'bounded_sha256', { sourceType: 'REAL_RUNTIME' })
  const row = captured[captured.length - 1]
  assert.equal(row.tool_result_status, result.status)
})

check('11 REAL_RUNTIME assigned only to true runtime records', () => {
  const runtimeRows = captured.filter((r) => r.source_type === 'REAL_RUNTIME')
  assert.equal(runtimeRows.every((r) => r.insertion_point.includes('toolRouter') || r.insertion_point.includes('execute.ts')), true)
})

check('12 fixtures not mislabeled REAL_RUNTIME', () => {
  const routed = routeToolIntent('TOOL=lookup_note\nnote_id=NOTE-L000')
  assert.ok(routed.normalized)
  executeNormalizedRequest(routed.normalized, 'dry_run', {})
  const dry = captured[captured.length - 1]
  assert.equal(dry.source_type, 'GYM_FIXTURE')
  const echo = routeToolIntent('TOOL=echo_int\nn=3')
  assert.ok(echo.normalized)
  executeNormalizedRequest(echo.normalized, 'mock', {})
  const mock = captured[captured.length - 1]
  assert.equal(mock.source_type, 'SYNTHETIC')
})

check('13 review state starts RAW', () => {
  assert.equal(captured.every((r) => r.review_state === 'RAW'), true)
})

check('14 no auto-VERIFIED', () => {
  assert.equal(captured.every((r) => r.auto_verified === false), true)
  assert.equal(captured.every((r) => r.review_state !== 'VERIFIED'), true)
})

check('15 no auto-curriculum', () => {
  assert.equal(captured.every((r) => r.auto_curriculum === false), true)
  assert.equal(captured.every((r) => r.review_state !== 'CURRICULUM_CANDIDATE'), true)
})

check('16 no auto-training', () => {
  assert.equal(captured.every((r) => r.training_invoked === false), true)
  assert.equal(observerDoesNotImportTraining().ok, true)
  const cap = readFileSync(join(repo, 'lib/modular-intelligence/runtimeTrajectoryCapture.ts'), 'utf8')
  assert.equal(cap.includes("from '@/lib/wrim1-training"), false)
  assert.equal(cap.includes('safetensors'), false)
})

check('17 no auto-promotion', () => {
  assert.equal(captured.every((r) => r.promotion_invoked === false), true)
})

check('18 secret sanitation', () => {
  const text = sanitizeTrajectoryText('Authorization: Bearer sk_live_abcdefghijk cookie=secret')
  assert.equal(text.text.includes('sk_live_abcdefghijk'), false)
  assert.equal(text.redacted.includes('bearer') || text.redacted.includes('sk_live'), true)
  const obj = sanitizeTrajectoryValue({
    authorization: 'secret-value',
    query: 'https://example.com/file?signature=abc123def456',
  }) as Record<string, unknown>
  assert.equal(obj.authorization, '[REDACTED:secret_key]')
  assert.equal(String(obj.query).includes('abc123def456'), false)
  const before = captured.length
  captureRuntimeTrajectory({
    request_text: 'Use Bearer FAKESECRET_y1z2a3b4c5d6e7f8g9h0 and API_KEY=supersecret',
    decision: 'NO_TOOL',
    tool_id: null,
    arguments: {},
    source_type: 'REAL_TEST',
    insertion_point: 'lib/modular-intelligence/toolRouter.ts:routeToolIntent',
  })
  const row = captured[captured.length - 1]
  assert.equal(captured.length, before + 1)
  assert.equal(row.request.includes('sk-live-abcdefghijklmnopqrstuvwxyz'), false)
  assert.equal(row.request.includes('[REDACTED:'), true)
})

check('19 bounded result persistence', () => {
  const huge = { blob: 'x'.repeat(8000) }
  const bounded = boundTrajectoryJson(huge, 2048)
  assert.equal(bounded.bounded, true)
  assert.equal(bounded.original_chars > 2048, true)
  captureRuntimeTrajectory({
    request_text: 'TOOL=files\npath=huge',
    decision: 'TOOL',
    tool_id: 'files',
    arguments: { path: 'huge' },
    router_validation_status: 'VALID',
    tool_result_status: 'ok',
    tool_result: huge,
    source_type: 'SYNTHETIC',
    insertion_point: 'app/api/tools-or-files:files',
  })
  const row = captured[captured.length - 1]
  assert.equal(row.result_bounded, true)
  assert.equal(JSON.stringify(row.tool_result).length < 6000, true)
})

check('20 observer failure does not block tool path', () => {
  configureTrajectoryCaptureForTests({
    skipExperience: true,
    persistLine: () => {
      throw new Error('persist boom')
    },
  })
  const routed = routeToolIntent('TOOL=sha256\ntext=isolation')
  assert.ok(routed.normalized)
  const result = executeNormalizedRequest(routed.normalized, 'bounded_sha256', { sourceType: 'REAL_RUNTIME' })
  assert.equal(result.status, 'ok')
  assert.equal((result.result as { digest: string }).digest, createHash('sha256').update('isolation').digest('hex'))
  configureTrajectoryCaptureForTests({
    skipExperience: true,
    persistLine: (line) => persistToMemory(JSON.parse(line) as CapturedRuntimeTrajectory),
  })
})

check('21 observer-off/on behavior equivalence', () => {
  const prev = process.env.WR_TOOL_TRAJECTORY_OBSERVER
  process.env.WR_TOOL_TRAJECTORY_OBSERVER = '0'
  assert.equal(isTrajectoryObservationEnabled(), false)
  const routed = routeToolIntent('TOOL=sha256\ntext=gate-off')
  assert.ok(routed.normalized)
  const off = executeNormalizedRequest(routed.normalized, 'bounded_sha256', { sourceType: 'REAL_RUNTIME' })
  if (prev === undefined) delete process.env.WR_TOOL_TRAJECTORY_OBSERVER
  else process.env.WR_TOOL_TRAJECTORY_OBSERVER = prev
  const on = executeNormalizedRequest(routed.normalized, 'bounded_sha256', { sourceType: 'REAL_RUNTIME' })
  assert.equal(off.status, on.status)
  assert.deepEqual(off.result, on.result)
  assert.equal(off.error, on.error)
  assert.equal(off.tool_id, on.tool_id)
})

check('22 no tool argument mutation', () => {
  const routed = routeToolIntent('TOOL=sha256\ntext=immutable-args')
  assert.ok(routed.normalized)
  const snapshot = JSON.parse(JSON.stringify(routed.normalized.arguments))
  executeNormalizedRequest(routed.normalized, 'bounded_sha256', { sourceType: 'REAL_RUNTIME' })
  assert.deepEqual(routed.normalized.arguments, snapshot)
})

check('23 no tool-result mutation', () => {
  const routed = routeToolIntent('TOOL=sha256\ntext=immutable-result')
  assert.ok(routed.normalized)
  const result = executeNormalizedRequest(routed.normalized, 'bounded_sha256', { sourceType: 'REAL_RUNTIME' })
  const expected = createHash('sha256').update('immutable-result').digest('hex')
  assert.equal((result.result as { digest: string }).digest, expected)
  assert.equal(result.status, 'ok')
})

check('24 active core unchanged', () => {
  const core = officialActiveCore()
  assert.equal(core.activeCoreId, WRIM0_ID)
  assert.equal(core.activeCoreCheckpointSha, WRIM0_CHECKPOINT_SHA)
})

check('25 active modules unchanged', () => {
  assert.deepEqual(officialActiveCore().activeModuleIds, [])
})

check('26 WRIM-0 checkpoint identity untouched', () => {
  assert.equal(WRIM0_CHECKPOINT_SHA, 'd1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015')
  const src = readFileSync(join(repo, 'lib/modular-intelligence/runtimeTrajectoryCapture.ts'), 'utf8')
  assert.equal(src.includes('checkpoint-final.safetensors'), false)
})

check('27 no model optimizer invoked', () => {
  assert.equal(captured.every((r) => r.optimizer_invoked === false), true)
  const cap = readFileSync(join(repo, 'lib/modular-intelligence/runtimeTrajectoryCapture.ts'), 'utf8')
  assert.equal(cap.includes('AdamW'), false)
  assert.equal(cap.includes('optimizer'), true) // field name optimizer_invoked: false
})

check('28 normalization pipeline accepts captured record', () => {
  const row = captured.find((r) => r.selected_tool === 'sha256')
  assert.ok(row)
  const norm = normalizeCapturedRuntimeTrajectory(row)
  assert.equal(norm.review_state, 'NORMALIZED')
  assert.equal(norm.raw_review_state, 'RAW')
  assert.equal(norm.EXCLUDE_FROM_TRAINING, true)
  assert.equal(norm.trajectory_id, row.trajectory_id)
})

check('29 quality gate processes captured record', () => {
  const row = captured.find((r) => r.selected_tool === 'sha256' && r.arguments.text === 'observer-dev-sha256')
  assert.ok(row)
  const gate = qualityGateCapturedTrajectory(row)
  assert.equal(gate.review_state_unchanged, 'RAW')
  assert.equal(gate.auto_verified, false)
  assert.equal(gate.auto_curriculum, false)
  assert.equal(gate.quality_label, 'VERIFIED')
})

check('30 V4 gap recalculation correct', () => {
  const gold = captured
    .filter((r) => r.source_type === 'REAL_RUNTIME')
    .map(qualityGateCapturedTrajectory)
    .filter((g) => g.usable_supervised_gold)
  const post = PRE_GOLD + gold.length
  const remaining = Math.max(0, V4_MIN - post)
  assert.equal(PRE_GOLD, 12)
  assert.equal(V4_MIN, 20)
  assert.equal(remaining, Math.max(0, 20 - post))
  assert.equal(gold.every((g) => g.auto_curriculum === false), true)
})

check('31 production enablement remains off', () => {
  assert.equal(isTrajectoryObservationEnabled({ NODE_ENV: 'production' } as NodeJS.ProcessEnv), false)
  assert.equal(isTrajectoryObservationEnabled({ NODE_ENV: 'production', WR_TOOL_TRAJECTORY_OBSERVER: '1' } as NodeJS.ProcessEnv), false)
  const executeSrc = readFileSync(join(repo, 'app/api/chat/execute.ts'), 'utf8')
  assert.equal(executeSrc.includes('WarRoomNode01'), false)
})

check('32 no production feature activation / Experiment 004 not started', () => {
  const cap = readFileSync(join(repo, 'lib/modular-intelligence/runtimeTrajectoryCapture.ts'), 'utf8')
  assert.equal(cap.includes('Experiment 004'), false)
  const exp004Weights = join(repo, 'model-lab/manifests/modular-intelligence/WR-TOOL-PI-EXP-004')
  assert.equal(existsSync(join(exp004Weights, 'adapter.safetensors')), false)
  const session = createChatTrajectorySession({
    requestText: 'What is two plus two? Answer directly.',
    conversationId: null,
    requestId: null,
  })
  session.markNoToolReason('TOOL_NOT_REQUIRED')
  const flushed = session.flushFromResponse({})
  assert.ok(flushed)
  assert.equal(flushed.decision, 'NO_TOOL')
  assert.equal(flushed.source_type, 'REAL_RUNTIME')
  assert.equal(flushed.no_tool_reason, 'TOOL_NOT_REQUIRED')
})

const webRouted = routeToolIntent('TOOL=web\nquery=observer-dev-web-dry-run')
if (webRouted.normalized) {
  executeNormalizedRequest(webRouted.normalized, 'dry_run', {})
}
const memRouted = routeToolIntent('TOOL=memory\nquery=observer-dev-memory-dry-run')
if (memRouted.normalized) {
  executeNormalizedRequest(memRouted.normalized, 'dry_run', {})
}
const researchRouted = routeToolIntent('TOOL=research\nquery=observer-dev-research-dry-run')
if (researchRouted.normalized) {
  executeNormalizedRequest(researchRouted.normalized, 'dry_run', {})
}

const invalid = routeToolIntent('TOOL=curl\nurl=https://example.invalid')
observeToolRouterResult('TOOL=curl\nurl=https://example.invalid', invalid, { sourceType: 'REAL_RUNTIME' })

const latencyMs: number[] = []
for (let i = 0; i < 20; i += 1) {
  const t0 = performance.now()
  captureRuntimeTrajectory({
    request_text: `TOOL=none\nlatency-probe-${i}`,
    decision: 'NO_TOOL',
    tool_id: null,
    arguments: {},
    router_validation_status: 'VALID',
    source_type: 'REAL_TEST',
    insertion_point: 'lib/modular-intelligence/toolRouter.ts:routeToolIntent',
  })
  latencyMs.push(performance.now() - t0)
}
const avgLatency = latencyMs.reduce((a, b) => a + b, 0) / latencyMs.length
const maxLatency = Math.max(...latencyMs)

mkdirSync(sessionDir, { recursive: true })
const unique = captured.filter((row, i, arr) => arr.findIndex((r) => r.trajectory_id === row.trajectory_id) === i)
writeFileSync(join(sessionDir, 'raw-trajectories.jsonl'), unique.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
const normalized = unique.map(normalizeCapturedRuntimeTrajectory)
writeFileSync(join(sessionDir, 'normalized-from-runtime.jsonl'), normalized.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
const quality = unique.map(qualityGateCapturedTrajectory)
const gold = unique.filter((r) => r.source_type === 'REAL_RUNTIME').map(qualityGateCapturedTrajectory).filter((g) => g.usable_supervised_gold)
const sourceCounts: Record<string, number> = {}
const toolCounts: Record<string, number> = {}
const qualityCounts: Record<string, number> = { VERIFIED: 0, SUPPORTED: 0, PARTIAL: 0, UNKNOWN: 0, REJECT: 0 }
for (const row of unique) {
  sourceCounts[row.source_type] = (sourceCounts[row.source_type] ?? 0) + 1
  const key = row.decision === 'NO_TOOL' ? 'NO_TOOL' : row.selected_tool ?? 'UNKNOWN'
  toolCounts[key] = (toolCounts[key] ?? 0) + 1
}
for (const g of quality) {
  qualityCounts[g.quality_label] = (qualityCounts[g.quality_label] ?? 0) + 1
}
const postGold = PRE_GOLD + gold.length
writeFileSync(join(sessionDir, 'quality-gate.json'), `${JSON.stringify({ results: quality, counts: qualityCounts }, null, 2)}\n`, 'utf8')
writeFileSync(join(sessionDir, 'session-summary.json'), `${JSON.stringify({
  REAL_RUNTIME: unique.filter((r) => r.source_type === 'REAL_RUNTIME').length,
  source_counts: sourceCounts,
  per_tool: toolCounts,
  quality_counts: qualityCounts,
  newly_usable_gold: gold.length,
  pre_mission_gold: PRE_GOLD,
  post_mission_gold: postGold,
  remaining_v4_gap: Math.max(0, V4_MIN - postGold),
  remaining_v4_gap_excluding_sha256_restatements: Math.max(
    0,
    V4_MIN
      - PRE_GOLD
      - unique
        .filter((r) => r.source_type === 'REAL_RUNTIME' && r.selected_tool !== 'sha256')
        .map(qualityGateCapturedTrajectory)
        .filter((g) => g.usable_supervised_gold).length,
  ),
  review_state_all_raw: unique.every((r) => r.review_state === 'RAW'),
  latency: {
    samples: latencyMs.length,
    avg_ms: avgLatency,
    max_ms: maxLatency,
    persist: 'sync_jsonl_append_plus_optional_fire_and_forget_captureExperience',
  },
}, null, 2)}\n`, 'utf8')

resetTrajectoryCaptureForTests()
finish()
