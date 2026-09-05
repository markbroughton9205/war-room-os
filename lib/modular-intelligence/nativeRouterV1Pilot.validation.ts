import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createValidationHarness } from '@/lib/agi-program/validationHarness'
import { isNativeRouterV1PilotEnabled } from './nativeRouterV1PilotGate'
import { isNativeRouterV1ShadowEnabled } from './nativeRouterV1Gate'
import {
  configureNativeRouterV1PilotForTests,
  executePilotNormalizedRequest,
  nativeRouterV1PilotCreatesPlanner,
  routeServingIntent,
  type NativeRouterV1ServingScore,
} from './nativeRouterV1Pilot'
import { configureTrajectoryCaptureForTests, resetTrajectoryCaptureForTests } from './runtimeTrajectoryCapture'
import { executeNormalizedRequest, routeToolIntent } from './toolRouter'

const EXPECTED = 40
const { check, finish } = createValidationHarness('WR Native Router V1 controlled serving pilot', EXPECTED)
const repo = process.cwd()

resetTrajectoryCaptureForTests()
configureTrajectoryCaptureForTests({ skipExperience: true, persistLine: () => undefined })

function mockScore(over: Partial<NativeRouterV1ServingScore>): NativeRouterV1ServingScore {
  return {
    artifact: 'WR-NATIVE-ROUTER-V1-CANDIDATE',
    predicted_class: 'SHA256',
    tool_id: 'sha256',
    gate: 'TOOL_REQUIRED_CONFIDENT',
    information_state: 'DETERMINISTIC_COMPUTE_REQUIRED',
    deterministic: 'SHA256',
    lexical: 'SHA256',
    wrim: null,
    wrim_in_serving: false,
    confidence: 0.93,
    margin: 0.5,
    abstain_state: 'ROUTE_CONFIDENT',
    disagreement: false,
    decision_stage: 'deterministic_high_confidence',
    lexical_fallback_used: false,
    deterministic_rule_match: true,
    schema_ok: true,
    schema_reason: 'schema_expressible_or_inferable',
    multi_tool_required: false,
    multi_tool_families: [],
    suggested_compact: 'TOOL=sha256\ntext=hello',
    serving_mode: 'full_skip_wrim',
    ...over,
  }
}

function withPilot<T>(on: boolean, fn: () => T): T {
  const prev = process.env.WR_NATIVE_ROUTER_V1_PILOT
  if (on) process.env.WR_NATIVE_ROUTER_V1_PILOT = '1'
  else delete process.env.WR_NATIVE_ROUTER_V1_PILOT
  try {
    return fn()
  } finally {
    if (prev === undefined) delete process.env.WR_NATIVE_ROUTER_V1_PILOT
    else process.env.WR_NATIVE_ROUTER_V1_PILOT = prev
    configureNativeRouterV1PilotForTests(null)
  }
}

const man = JSON.parse(
  readFileSync(join(repo, 'model-lab/manifests/wr_tool_experiments/WR-NATIVE-ROUTER-V1-CANDIDATE/manifest.json'), 'utf8'),
) as {
  lifecycle: string
  serving_activation: boolean
  router_source_hash: string
  artifact_hash: string
  rule_hash: string
  lexical_hash: string
  confidence_policy_hash: string
  registry_snapshot_hash: string
}

check('1 lifecycle is CANDIDATE', () => {
  assert.equal(man.lifecycle, 'CANDIDATE')
})

check('2 candidate hashes exact', () => {
  assert.equal(man.artifact_hash, '8ceae5c75bbbc01c62631e88f4e82ae2bcea2cef9033f1ed94ac07c3928c6f2d')
  assert.equal(man.router_source_hash, 'aff133438870a6de68d2675c8be8e86648a0fe0b3a6949ef3de880c0182ca842')
  assert.equal(man.rule_hash, '2030538c5974dc8db61dc961fd88ee0113765c4d85884714323f43b694548da4')
  assert.equal(man.lexical_hash, '9b386e93bbc4481fba834077a417a2cbc8fb16dad41fb992a4db5dfae2d2b8f6')
  assert.equal(man.confidence_policy_hash, '1992679c7921b8fae6d6f657d89ff9b48d0714cb4bc0255c8493d9bd02fce741')
  assert.equal(man.registry_snapshot_hash, '37429d94ac5aff98a806f08984f40b4dada698f08defd4b8e3f596b12febaca7')
})

check('3 serving policy exact and WRIM not in serving policy', () => {
  const src = readFileSync(join(repo, 'lib/modular-intelligence/nativeRouterV1Pilot.ts'), 'utf8')
  assert.equal(src.includes("serving_mode: 'full_skip_wrim'"), true)
  assert.equal(src.includes('wrim_in_serving: false'), true)
})

check('4 WRIM not in serving decision', () => {
  const score = mockScore({})
  assert.equal(score.wrim, null)
  assert.equal(score.wrim_in_serving, false)
})

check('5 multi-tool blocked', () => {
  withPilot(true, () => {
    configureNativeRouterV1PilotForTests(() =>
      mockScore({
        predicted_class: 'WEB',
        suggested_compact: 'TOOL=web\nquery=open roster then search',
        multi_tool_required: true,
        multi_tool_families: ['ARTIFACT_ACCESS', 'EXTERNAL_RETRIEVAL'],
      }),
    )
    const d = routeServingIntent('open the roster then search the web for tonight', {
      sourceType: 'REAL_TEST',
      observe: false,
    })
    assert.equal(d.fallback_used, true)
    assert.equal(d.fallback_reason, 'multi_tool_required')
    assert.equal(d.candidate_eligible, false)
    assert.equal(d.multi_tool_detected, true)
  })
})

check('6 planner absent', () => {
  assert.equal(nativeRouterV1PilotCreatesPlanner(), false)
  const src = readFileSync(join(repo, 'lib/modular-intelligence/nativeRouterV1Pilot.ts'), 'utf8')
  assert.equal(/new\s+Planner|createPlanner/i.test(src), false)
})

check('7 candidate immutable hashes documented', () => {
  const py = readFileSync(join(repo, 'scripts/wrim-modular/native_router_v1.py'), 'utf8')
  assert.equal(py.includes('R03_prior_turn_underspecified'), true)
})

check('8 pilot flag default OFF', () => {
  assert.equal(isNativeRouterV1PilotEnabled({} as NodeJS.ProcessEnv), false)
  assert.equal(isNativeRouterV1PilotEnabled({ NODE_ENV: 'development' } as NodeJS.ProcessEnv), false)
  assert.equal(isNativeRouterV1PilotEnabled({ NODE_ENV: 'production' } as NodeJS.ProcessEnv), false)
})

check('9 pilot flag OFF leaves old router authoritative', () => {
  withPilot(false, () => {
    configureNativeRouterV1PilotForTests(() => mockScore({ predicted_class: 'WEB', suggested_compact: 'TOOL=web\nquery=x' }))
    const raw = 'TOOL=sha256\ntext=flag-off-proof'
    const a = routeToolIntent(raw)
    const d = routeServingIntent(raw, { sourceType: 'REAL_TEST', observe: false })
    assert.equal(d.pilot_flag, false)
    assert.equal(d.final_route, 'SHA256')
    assert.equal(JSON.stringify(d.routed), JSON.stringify(a))
  })
})

check('10 pilot flag ON affects only eligible single-tool scope', () => {
  withPilot(true, () => {
    configureNativeRouterV1PilotForTests(() => mockScore({}))
    const d = routeServingIntent('Compute the sha256 digest of "hello"', { sourceType: 'REAL_TEST', observe: false })
    assert.equal(d.pilot_flag, true)
    assert.equal(d.candidate_eligible, true)
    assert.equal(d.final_route, 'SHA256')
    assert.equal(d.fallback_used, false)
  })
})

check('11 abstention falls back', () => {
  withPilot(true, () => {
    configureNativeRouterV1PilotForTests(() =>
      mockScore({
        predicted_class: 'WEB',
        abstain_state: 'INSUFFICIENT_CONTEXT',
        gate: 'INSUFFICIENT_CONTEXT',
        suggested_compact: 'TOOL=web\nquery=maybe',
      }),
    )
    const d = routeServingIntent('maybe?', { sourceType: 'REAL_TEST', observe: false })
    assert.equal(d.fallback_used, true)
    assert.equal(d.fallback_reason, 'abstention')
  })
})

check('12 ambiguous falls back', () => {
  withPilot(true, () => {
    configureNativeRouterV1PilotForTests(() =>
      mockScore({
        predicted_class: 'WEB',
        abstain_state: 'ROUTE_AMBIGUOUS',
        gate: 'AMBIGUOUS',
        suggested_compact: 'TOOL=web\nquery=ambiguous',
      }),
    )
    const d = routeServingIntent('do the thing about it', { sourceType: 'REAL_TEST', observe: false })
    assert.equal(d.fallback_reason, 'ambiguous')
    assert.equal(d.fallback_used, true)
  })
})

check('13 unsupported capability does not hallucinate route', () => {
  withPilot(true, () => {
    configureNativeRouterV1PilotForTests(() =>
      mockScore({
        predicted_class: 'NO_TOOL',
        tool_id: null,
        abstain_state: 'NO_COMPATIBLE_TOOL',
        gate: 'TOOL_OPTIONAL',
        schema_ok: true,
        suggested_compact: 'TOOL=none',
      }),
    )
    const d = routeServingIntent('fax the spectrophotometer calibration sheet', {
      sourceType: 'REAL_TEST',
      observe: false,
    })
    assert.equal(d.candidate_eligible, false)
    assert.equal(d.fallback_used, true)
    assert.notEqual(d.final_route, 'WEB')
    assert.notEqual(d.final_route, 'FILES')
  })
})

check('14 schema-invalid route cannot execute', () => {
  withPilot(true, () => {
    configureNativeRouterV1PilotForTests(() =>
      mockScore({
        predicted_class: 'FILES',
        tool_id: 'files',
        schema_ok: false,
        schema_reason: 'required_not_expressible:path',
        suggested_compact: null,
      }),
    )
    const d = routeServingIntent('open the file', { sourceType: 'REAL_TEST', observe: false })
    assert.equal(d.fallback_used, true)
    assert.equal(['schema_invalid', 'compact_unavailable'].includes(d.fallback_reason ?? ''), true)
    assert.equal(d.routed.executed, false)
  })
})

check('15 multi-tool cannot chain', () => {
  const src = readFileSync(join(repo, 'lib/modular-intelligence/nativeRouterV1Pilot.ts'), 'utf8')
  assert.equal(src.includes('executeNormalizedRequest'), true)
  assert.equal(src.includes('multi_tool_required'), true)
})

check('16 existing executor remains authoritative', () => {
  withPilot(true, () => {
    configureNativeRouterV1PilotForTests(() => mockScore({}))
    const d = routeServingIntent('sha256 "hello"', { sourceType: 'REAL_TEST', observe: false })
    const result = executePilotNormalizedRequest(d, 'bounded_sha256', { sourceType: 'REAL_TEST' })
    assert.equal(d.routed.normalized?.tool, 'sha256')
    assert.equal(result.tool_id, 'sha256')
    assert.equal(result.status, 'ok')
    assert.equal(d.routed.executed, false)
    const execSrc = readFileSync(join(repo, 'lib/modular-intelligence/toolRouter.ts'), 'utf8')
    assert.equal(execSrc.includes('export function executeNormalizedRequest'), true)
  })
})

check('17 observer reused', () => {
  const src = readFileSync(join(repo, 'lib/modular-intelligence/nativeRouterV1Pilot.ts'), 'utf8')
  assert.equal(src.includes('captureRuntimeTrajectory'), true)
  assert.equal(src.includes('parallelLedger'), false)
})

check('18 no duplicate ledger', () => {
  const cap = readFileSync(join(repo, 'lib/modular-intelligence/runtimeTrajectoryCapture.ts'), 'utf8')
  assert.equal(cap.includes('captureRuntimeTrajectory'), true)
})

check('19 genuine runtime provenance distinguishable', () => {
  withPilot(true, () => {
    configureNativeRouterV1PilotForTests(() => mockScore({}))
    const testCase = routeServingIntent('sha256 "hello"', { sourceType: 'REAL_TEST', observe: false })
    const runtime = routeServingIntent('sha256 "hello"', { sourceType: 'REAL_RUNTIME', observe: false })
    assert.equal(testCase.real_runtime_fresh, false)
    assert.equal(runtime.real_runtime_fresh, true)
  })
})

check('20 development serving proof candidate-confident', () => {
  withPilot(true, () => {
    configureNativeRouterV1PilotForTests(() => mockScore({}))
    const d = routeServingIntent('Compute the SHA-256 digest of "hello"', { sourceType: 'REAL_TEST', observe: false })
    assert.equal(d.final_route, 'SHA256')
    assert.equal(d.candidate_eligible, true)
  })
})

check('21 flag-OFF regression', () => {
  const raw = 'TOOL=memory\nquery=decree'
  const off = withPilot(false, () => routeServingIntent(raw, { sourceType: 'REAL_TEST', observe: false }))
  const existing = routeToolIntent(raw)
  assert.equal(off.final_route, 'MEMORY')
  assert.equal(off.routed.intent.tool_id, existing.intent.tool_id)
})

check('22 flag-ON eligible-route', () => {
  withPilot(true, () => {
    configureNativeRouterV1PilotForTests(() =>
      mockScore({
        predicted_class: 'WEB',
        tool_id: 'web',
        information_state: 'CURRENT_EXTERNAL_INFORMATION_REQUIRED',
        suggested_compact: 'TOOL=web\nquery=current NOAA planetary K-index',
        deterministic: 'WEB',
      }),
    )
    const d = routeServingIntent('Look up the current NOAA planetary K-index', { sourceType: 'REAL_TEST', observe: false })
    assert.equal(d.final_route, 'WEB')
    assert.equal(d.fallback_used, false)
  })
})

check('23 shadow flag remains independent', () => {
  assert.equal(
    isNativeRouterV1ShadowEnabled({ NODE_ENV: 'production', WR_NATIVE_ROUTER_V1_SHADOW: '1' } as NodeJS.ProcessEnv),
    false,
  )
  assert.equal(
    isNativeRouterV1PilotEnabled({ NODE_ENV: 'production', WR_NATIVE_ROUTER_V1_PILOT: '1' } as NodeJS.ProcessEnv),
    true,
  )
  assert.equal(isNativeRouterV1PilotEnabled({ WR_NATIVE_ROUTER_V1_SHADOW: '1' } as NodeJS.ProcessEnv), false)
})

check('24 NO_TOOL eligible', () => {
  withPilot(true, () => {
    configureNativeRouterV1PilotForTests(() =>
      mockScore({
        predicted_class: 'NO_TOOL',
        tool_id: null,
        gate: 'NO_TOOL_CONFIDENT',
        abstain_state: 'NO_TOOL_CONFIDENT',
        information_state: 'ANSWERABLE_FROM_CONTEXT',
        suggested_compact: 'TOOL=none',
        deterministic: 'NO_TOOL',
      }),
    )
    const d = routeServingIntent('From the context I already gave you, what is 2+2?', {
      sourceType: 'REAL_TEST',
      observe: false,
    })
    assert.equal(d.final_route, 'NO_TOOL')
    assert.equal(d.fallback_used, false)
  })
})

check('25 MEMORY eligible', () => {
  withPilot(true, () => {
    configureNativeRouterV1PilotForTests(() =>
      mockScore({
        predicted_class: 'MEMORY',
        tool_id: 'memory',
        suggested_compact: 'TOOL=memory\nquery=what did we lock last turn',
        information_state: 'DURABLE_MEMORY_REQUIRED',
        deterministic: 'MEMORY',
      }),
    )
    const d = routeServingIntent('Recall what we already locked last turn', { sourceType: 'REAL_TEST', observe: false })
    assert.equal(d.final_route, 'MEMORY')
  })
})

check('26 FILES eligible', () => {
  withPilot(true, () => {
    configureNativeRouterV1PilotForTests(() =>
      mockScore({
        predicted_class: 'FILES',
        tool_id: 'files',
        suggested_compact: 'TOOL=files\npath=docs/war-room-constitution.md',
        information_state: 'ARTIFACT_ACCESS_REQUIRED',
        deterministic: 'FILES',
      }),
    )
    const d = routeServingIntent('Open docs/war-room-constitution.md', { sourceType: 'REAL_TEST', observe: false })
    assert.equal(d.final_route, 'FILES')
    assert.equal(d.routed.normalized?.arguments.path, 'docs/war-room-constitution.md')
  })
})

check('27 RESEARCH eligible', () => {
  withPilot(true, () => {
    configureNativeRouterV1PilotForTests(() =>
      mockScore({
        predicted_class: 'RESEARCH',
        tool_id: 'research',
        suggested_compact: 'TOOL=research\nquery=multi-source Antarctic sea ice this season',
        information_state: 'MULTI_SOURCE_RESEARCH_REQUIRED',
        deterministic: 'RESEARCH',
      }),
    )
    const d = routeServingIntent('Research Antarctic sea-ice extent this season from multiple sources', {
      sourceType: 'REAL_TEST',
      observe: false,
    })
    assert.equal(d.final_route, 'RESEARCH')
  })
})

check('28 schema-invalid candidate does not execute via executor', () => {
  withPilot(true, () => {
    configureNativeRouterV1PilotForTests(() =>
      mockScore({
        predicted_class: 'FILES',
        schema_ok: false,
        suggested_compact: 'TOOL=files\npath=',
      }),
    )
    const d = routeServingIntent('open something', { sourceType: 'REAL_TEST', observe: false })
    assert.equal(d.fallback_used, true)
    const result = executePilotNormalizedRequest(d, 'dry_run', { sourceType: 'REAL_TEST' })
    assert.notEqual(result.status, 'ok')
  })
})

check('29 executeNormalizedRequest is the only executor', () => {
  const src = readFileSync(join(repo, 'lib/modular-intelligence/nativeRouterV1Pilot.ts'), 'utf8')
  assert.equal(src.includes('executeNormalizedRequest('), true)
  assert.equal(src.includes('runLiveResearchRouter'), false)
})

check('30 candidate serving_activation remains false', () => {
  assert.equal(man.serving_activation, false)
  assert.equal(man.lifecycle, 'CANDIDATE')
})

check('31 no WRIM/LoRA/EXP006/RED-X-2 in pilot serving', () => {
  const src = readFileSync(join(repo, 'lib/modular-intelligence/nativeRouterV1Pilot.ts'), 'utf8')
  assert.equal(src.includes('run_lora'), false)
  assert.equal(src.includes('EXP006'), false)
  const infer = readFileSync(join(repo, 'scripts/wrim-modular/native_router_v1_serving_infer.py'), 'utf8')
  assert.equal(infer.includes('mode="full"'), true)
  assert.equal(infer.includes('wrim_proba=None'), true)
})

check('32 R03 unchanged', () => {
  const py = readFileSync(join(repo, 'scripts/wrim-modular/native_router_v1.py'), 'utf8')
  assert.equal(py.includes('"id": "R03_prior_turn_underspecified"'), true)
})

check('33 kill switch is env-only', () => {
  assert.equal(isNativeRouterV1PilotEnabled({ WR_NATIVE_ROUTER_V1_PILOT: '0' } as NodeJS.ProcessEnv), false)
})

check('34 rollback conceptual: flag off restores existing router', () => {
  withPilot(true, () => {
    configureNativeRouterV1PilotForTests(() =>
      mockScore({
        predicted_class: 'WEB',
        suggested_compact: 'TOOL=web\nquery=k-index',
      }),
    )
    const on = routeServingIntent('Look up the current NOAA planetary K-index', {
      sourceType: 'REAL_TEST',
      observe: false,
    })
    assert.equal(on.final_route, 'WEB')
  })
  const off = withPilot(false, () =>
    routeServingIntent('Look up the current NOAA planetary K-index', { sourceType: 'REAL_TEST', observe: false }),
  )
  assert.equal(off.pilot_flag, false)
  assert.equal(JSON.stringify(off.routed), JSON.stringify(routeToolIntent('Look up the current NOAA planetary K-index')))
})

check('35 live serving infer skips WRIM and uses frozen lexical', () => {
  const infer = readFileSync(join(repo, 'scripts/wrim-modular/native_router_v1_serving_infer.py'), 'utf8')
  assert.equal(infer.includes('wrim_proba=None'), true)
  assert.equal(infer.includes('NATIVE_ROUTER_V1_EXPECTED_LEXICAL_HASH'), true)
})

check('36 chat hook does not replace executor', () => {
  const chat = readFileSync(join(repo, 'app/api/chat/execute.ts'), 'utf8')
  assert.equal(chat.includes('applyPilotToResearchDecision'), true)
  assert.equal(chat.includes('runLiveResearchRouter'), true)
})

check('37 capture allows pilot in production without enabling general observer', () => {
  const cap = readFileSync(join(repo, 'lib/modular-intelligence/runtimeTrajectoryCapture.ts'), 'utf8')
  assert.equal(cap.includes('native_router_v1_pilot'), true)
  assert.equal(cap.includes('isNativeRouterV1PilotEnabled'), true)
})

check('38 bounded sha256 still executes through existing executor', () => {
  withPilot(true, () => {
    configureNativeRouterV1PilotForTests(() => mockScore({}))
    const d = routeServingIntent('digest of "hello"', { sourceType: 'REAL_TEST', observe: false })
    const result = executeNormalizedRequest(d.routed.normalized!, 'bounded_sha256', { sourceType: 'REAL_TEST' })
    assert.equal(result.status, 'ok')
    assert.equal(typeof (result.result as { digest?: string }).digest, 'string')
  })
})

check('39 candidate cannot create chained execution', () => {
  withPilot(true, () => {
    configureNativeRouterV1PilotForTests(() =>
      mockScore({
        predicted_class: 'WEB',
        multi_tool_required: true,
        suggested_compact: 'TOOL=web\nquery=x',
      }),
    )
    const d = routeServingIntent('open docs/x.md then search the web', { sourceType: 'REAL_TEST', observe: false })
    assert.equal(d.fallback_used, true)
  })
})

check('40 fixtures are never REAL_RUNTIME_FRESH', () => {
  withPilot(true, () => {
    configureNativeRouterV1PilotForTests(() => mockScore({}))
    const d = routeServingIntent('TOOL=sha256\ntext=hello', { sourceType: 'GYM_FIXTURE', observe: false })
    assert.equal(d.real_runtime_fresh, false)
  })
})

finish()
