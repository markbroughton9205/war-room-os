import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isTrajectoryObservationEnabled } from './trajectoryObservationGate'
import { officialActiveCore } from './composedRuntime'
import { WRIM0_CHECKPOINT_SHA, WRIM0_ID } from './types'
import { qualityGateCapturedTrajectory } from './qualityGateRuntimeTrajectory'
import type { CapturedRuntimeTrajectory } from './runtimeTrajectoryCapture'

const LEDGER = join(process.cwd(), 'model-lab/manifests/wr_tool_trajectories/REAL-RUNTIME-MEMORY-V1')
const OBSERVER = join(process.cwd(), 'model-lab/manifests/wr_tool_trajectories/REAL-RUNTIME-OBSERVER-DEV-V1/session-summary.json')
const CLASS_DIV = join(process.cwd(), 'model-lab/manifests/wr_tool_trajectories/REAL-RUNTIME-CLASS-DIVERSITY-V1/session-summary.json')
const CAPTURE = join(process.cwd(), 'lib/modular-intelligence/runtimeTrajectoryCapture.ts')

let passed = 0
const results: { name: string; ok: boolean; detail?: string }[] = []

function check(name: string, fn: () => void) {
  try {
    fn()
    passed += 1
    results.push({ name, ok: true })
    console.log(`PASS ${name}`)
  } catch (err) {
    results.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err) })
    console.log(`FAIL ${name}: ${err instanceof Error ? err.message : err}`)
  }
}

const summary = JSON.parse(readFileSync(join(LEDGER, 'session-summary.json'), 'utf8')) as Record<string, unknown>
const cred = JSON.parse(readFileSync(join(LEDGER, 'credential-check.json'), 'utf8')) as {
  SUPABASE_SERVICE_ROLE_KEY: string
  value_not_recorded: boolean
}
const rawText = readFileSync(join(LEDGER, 'raw-trajectories.jsonl'), 'utf8')
const raw = rawText
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as CapturedRuntimeTrajectory)

check('1 observer enabled in development; production off', () => {
  assert.equal(isTrajectoryObservationEnabled({ ...process.env, NODE_ENV: 'development' }), true)
  assert.equal(isTrajectoryObservationEnabled({ NODE_ENV: 'production' }), false)
})

check('2 WRIM-0 identity and empty modules', () => {
  const core = officialActiveCore()
  assert.equal(core.activeCoreId, WRIM0_ID)
  assert.equal(core.activeCoreCheckpointSha, WRIM0_CHECKPOINT_SHA)
  assert.deepEqual(core.activeModuleIds, [])
  assert.equal(summary.wrim0_unchanged, true)
})

check('3 credential status is AVAILABLE or MISSING only', () => {
  assert.ok(cred.SUPABASE_SERVICE_ROLE_KEY === 'AVAILABLE' || cred.SUPABASE_SERVICE_ROLE_KEY === 'MISSING')
  assert.equal(cred.value_not_recorded, true)
  assert.equal(summary.supabase_service_role, cred.SUPABASE_SERVICE_ROLE_KEY)
})

check('4 no fabricated MEMORY when key missing', () => {
  if (cred.SUPABASE_SERVICE_ROLE_KEY === 'MISSING') {
    assert.equal(summary.MEMORY_REAL_RUNTIME, 0)
    assert.equal(summary.live_memory_executed, false)
    assert.equal(raw.some((r) => r.selected_tool === 'memory'), false)
  }
})

check('5 captured rows REAL_RUNTIME RAW; no auto curriculum', () => {
  assert.equal(raw.length, summary.total_new_REAL_RUNTIME)
  for (const r of raw) {
    assert.equal(r.source_type, 'REAL_RUNTIME')
    assert.equal(r.review_state, 'RAW')
    assert.equal(r.auto_verified, false)
    assert.equal(r.auto_curriculum, false)
    assert.equal(r.training_invoked, false)
    assert.equal(r.optimizer_invoked, false)
    assert.equal(r.promotion_invoked, false)
  }
})

check('6 quality gate not auto-VERIFIED', () => {
  const labels = raw.map(qualityGateCapturedTrajectory)
  assert.equal(labels.every((q) => q.auto_verified === false && q.review_state_unchanged === 'RAW'), true)
  const counts = summary.quality_counts as { SUPPORTED: number; PARTIAL: number }
  assert.equal(labels.filter((q) => q.quality_label === 'SUPPORTED').length, counts.SUPPORTED)
})

check('7 arguments and result status recovered on captured rows', () => {
  for (const r of raw) {
    assert.equal(r.tool_result_status != null, true)
    if (r.decision === 'TOOL') assert.equal(Object.keys(r.arguments).length > 0, true)
    assert.equal(Boolean(r.request?.trim()), true)
  }
})

check('8 prior ledgers intact', () => {
  assert.equal(existsSync(OBSERVER), true)
  const obs = JSON.parse(readFileSync(OBSERVER, 'utf8')) as { REAL_RUNTIME: number }
  assert.equal(obs.REAL_RUNTIME, 11)
  const div = JSON.parse(readFileSync(CLASS_DIV, 'utf8')) as { total_new_REAL_RUNTIME: number }
  assert.equal(div.total_new_REAL_RUNTIME, 17)
})

check('9 observer capture stays passive (no training invocation)', () => {
  const collector = readFileSync(join(process.cwd(), 'scripts/wrim-modular/collect_memory_runtime.ts'), 'utf8')
  assert.equal(collector.includes('run_lora'), false)
  assert.equal(collector.includes('ModelLabOptimizer'), false)
  assert.equal(collector.includes('skipExperience: true'), true)
  assert.equal((summary.observer_non_interference as { skipExperience: boolean }).skipExperience, true)
  const cap = readFileSync(CAPTURE, 'utf8')
  assert.equal(cap.includes('training_invoked: false'), true)
})

check('10 Experiment 004 not started; V4 not silently materialized', () => {
  const opt = summary.optimizer_training as { experiment_004: boolean; training_invoked: boolean }
  assert.equal(opt.experiment_004, false)
  assert.equal(opt.training_invoked, false)
  if ((summary.post_mission_MEMORY_gold as number) < 2) {
    assert.equal(summary.v4_readiness, 'WR-TOOL V4 — MORE REAL EXPERIENCE REQUIRED')
  }
})

const failed = results.filter((r) => !r.ok)
writeFileSync(
  join(LEDGER, 'validator.json'),
  JSON.stringify(
    {
      validator: 'pnpm run validate:memory-runtime',
      python_expected: 12,
      ts_expected: 10,
      ts_passed: passed,
      ts_failed: failed,
      results,
      experiment_004_started: false,
      training_started: false,
    },
    null,
    2,
  ) + '\n',
  'utf8',
)

console.log(`MEMORY runtime TS proofs: TOTAL=${results.length} EXPECTED=10 PASS=${passed} FAIL=${failed.length}`)
if (failed.length || results.length !== 10) process.exit(1)
