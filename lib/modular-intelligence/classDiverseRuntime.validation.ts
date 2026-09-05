import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isTrajectoryObservationEnabled } from './trajectoryObservationGate'
import { officialActiveCore } from './composedRuntime'
import { WRIM0_CHECKPOINT_SHA, WRIM0_ID } from './types'
import { qualityGateCapturedTrajectory } from './qualityGateRuntimeTrajectory'
import type { CapturedRuntimeTrajectory } from './runtimeTrajectoryCapture'

const LEDGER = join(process.cwd(), 'model-lab/manifests/wr_tool_trajectories/REAL-RUNTIME-CLASS-DIVERSITY-V1')
const EVAL3 = join(process.cwd(), 'model-lab/eval-only/WR-TOOL-EVAL-3/suite.json')

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

const raw = readFileSync(join(LEDGER, 'raw-trajectories.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as CapturedRuntimeTrajectory)
const summary = JSON.parse(readFileSync(join(LEDGER, 'session-summary.json'), 'utf8')) as Record<string, unknown>
const eval3 = JSON.parse(readFileSync(EVAL3, 'utf8')) as { items: { input: string }[]; item_count: number }

check('1 observer enabled outside production', () => {
  assert.equal(isTrajectoryObservationEnabled({ ...process.env, NODE_ENV: 'development' }), true)
  assert.equal(isTrajectoryObservationEnabled({ NODE_ENV: 'production' }), false)
})

check('2 WRIM-0 identity', () => {
  const core = officialActiveCore()
  assert.equal(core.activeCoreId, WRIM0_ID)
  assert.equal(core.activeCoreCheckpointSha, WRIM0_CHECKPOINT_SHA)
  assert.deepEqual(core.activeModuleIds, [])
})

check('3 every row REAL_RUNTIME RAW', () => {
  assert.equal(raw.length, summary.total_new_REAL_RUNTIME)
  for (const r of raw) {
    assert.equal(r.source_type, 'REAL_RUNTIME')
    assert.equal(r.review_state, 'RAW')
    assert.equal(r.auto_verified, false)
    assert.equal(r.auto_curriculum, false)
    assert.equal(r.training_invoked, false)
  }
})

check('4 quality gate matches labels', () => {
  const labels = raw.map(qualityGateCapturedTrajectory)
  const supported = labels.filter((q) => q.quality_label === 'SUPPORTED').length
  const partial = labels.filter((q) => q.quality_label === 'PARTIAL').length
  const counts = summary.quality_counts as { SUPPORTED: number; PARTIAL: number }
  assert.equal(supported, counts.SUPPORTED)
  assert.equal(partial, counts.PARTIAL)
  assert.equal(labels.every((q) => q.auto_verified === false), true)
})

check('5 WEB/RESEARCH/FILES/NO_TOOL present; MEMORY absent honestly', () => {
  const tools = new Set(raw.map((r) => r.selected_tool ?? 'NO_TOOL'))
  assert.equal(tools.has('web'), true)
  assert.equal(tools.has('research'), true)
  assert.equal(tools.has('files'), true)
  assert.equal(tools.has('NO_TOOL'), true)
  assert.equal(tools.has('memory'), false)
})

check('6 arguments and result status recovered', () => {
  for (const r of raw) {
    assert.equal(r.tool_result_status != null, true)
    if (r.decision === 'TOOL') assert.equal(Object.keys(r.arguments).length > 0, true)
  }
})

check('7 no EVAL-3 exact input leak', () => {
  const evalInputs = new Set(eval3.items.map((i) => i.input.trim().toLowerCase()))
  for (const r of raw) {
    assert.equal(evalInputs.has(r.request.trim().toLowerCase()), false)
  }
  assert.equal(eval3.item_count, 13)
})

check('8 no secrets in dump', () => {
  const dump = JSON.stringify(raw)
  assert.equal(dump.includes('Bearer '), false)
  assert.equal(/sk_live_/.test(dump), false)
})

check('9 original observer proof exists', () => {
  assert.equal(
    existsSync(join(process.cwd(), 'model-lab/manifests/wr_tool_trajectories/REAL-RUNTIME-OBSERVER-DEV-V1/session-summary.json')),
    true,
  )
})

check('10 V4 verdict is MORE EXPERIENCE', () => {
  assert.equal(summary.v4_readiness, 'WR-TOOL V4 — MORE REAL EXPERIENCE REQUIRED')
})

const failed = results.filter((r) => !r.ok)
writeFileSync(
  join(LEDGER, 'validator.json'),
  JSON.stringify(
    {
      validator: 'pnpm run validate:class-diverse-runtime',
      python_expected: 10,
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

console.log(`Class-diverse TS proofs: TOTAL=${results.length} EXPECTED=10 PASS=${passed} FAIL=${failed.length}`)
if (failed.length || results.length !== 10) process.exit(1)
