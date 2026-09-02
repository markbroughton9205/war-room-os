import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createValidationHarness } from '@/lib/agi-program/validationHarness'
import { configureNativeRouterV1ShadowForTests, scoreNativeRouterV1Shadow } from './nativeRouterV1Shadow'
import { isNativeRouterV1ShadowEnabled } from './nativeRouterV1Gate'
import { configureTrajectoryCaptureForTests, resetTrajectoryCaptureForTests } from './runtimeTrajectoryCapture'
import { observeToolRouterResult, routeToolIntent } from './toolRouter'

const EXPECTED = 8
const { check, finish } = createValidationHarness('WR Native Router V1 shadow wiring', EXPECTED)
const repo = process.cwd()

resetTrajectoryCaptureForTests()
configureTrajectoryCaptureForTests({ skipExperience: true, persistLine: () => undefined })

check('1 production NODE_ENV cannot enable native router shadow', () => {
  assert.equal(
    isNativeRouterV1ShadowEnabled({ NODE_ENV: 'production', WR_NATIVE_ROUTER_V1_SHADOW: '1' } as NodeJS.ProcessEnv),
    false,
  )
})

check('2 default development is off', () => {
  assert.equal(isNativeRouterV1ShadowEnabled({ NODE_ENV: 'development' } as NodeJS.ProcessEnv), false)
})

check('3 explicit flag enables only in non-production', () => {
  assert.equal(
    isNativeRouterV1ShadowEnabled({ NODE_ENV: 'development', WR_NATIVE_ROUTER_V1_SHADOW: '1' } as NodeJS.ProcessEnv),
    true,
  )
})

check('4 routeToolIntent is unchanged by native router shadow scoring', () => {
  const prev = process.env.WR_NATIVE_ROUTER_V1_SHADOW
  process.env.WR_NATIVE_ROUTER_V1_SHADOW = '1'
  configureNativeRouterV1ShadowForTests(() => ({
    artifact: 'WR-NATIVE-ROUTER-V1-CANDIDATE',
    predicted_class: 'WEB',
    gate: 'TOOL_REQUIRED_CONFIDENT',
    information_state: 'CURRENT_EXTERNAL_INFORMATION_REQUIRED',
    deterministic: 'WEB',
    lexical: 'RESEARCH',
    wrim: 'WEB',
    confidence: 0.9,
    margin: 0.4,
    abstain_state: 'ROUTE_CONFIDENT',
    disagreement: true,
    current_route: 'SHA256',
    matches_observed: false,
    alters_routing: false,
  }))
  const a = routeToolIntent('TOOL=sha256\ntext=native-shadow-proof')
  const b = routeToolIntent('TOOL=sha256\ntext=native-shadow-proof')
  assert.equal(a.intent.tool_id, 'sha256')
  assert.equal(b.intent.tool_id, 'sha256')
  assert.equal(a.intent.decision, b.intent.decision)
  assert.deepEqual(a.normalized?.arguments, b.normalized?.arguments)
  configureNativeRouterV1ShadowForTests(null)
  if (prev === undefined) delete process.env.WR_NATIVE_ROUTER_V1_SHADOW
  else process.env.WR_NATIVE_ROUTER_V1_SHADOW = prev
})

check('5 shadow score does not mutate routed intent', () => {
  const routed = routeToolIntent('TOOL=sha256\ntext=immutable-native-shadow')
  const snapshot = JSON.stringify(routed)
  const scored = scoreNativeRouterV1Shadow('TOOL=sha256\ntext=immutable-native-shadow', routed, {
    NODE_ENV: 'development',
    WR_NATIVE_ROUTER_V1_SHADOW: '1',
  } as NodeJS.ProcessEnv)
  assert.equal(JSON.stringify(routed), snapshot)
  assert.equal(scored?.alters_routing, false)
})

check('6 observer reused; no parallel ledger; registry not duplicated', () => {
  const src = readFileSync(join(repo, 'lib/modular-intelligence/toolRouter.ts'), 'utf8')
  assert.equal(src.includes('scoreNativeRouterV1Shadow'), true)
  assert.equal(src.includes('captureRuntimeTrajectory'), true)
  assert.equal(src.includes('parallelLedger'), false)
  const registry = readFileSync(join(repo, 'lib/tools/toolRegistry.ts'), 'utf8')
  assert.equal(registry.includes('export const TOOL_REGISTRY'), true)
})

check('7 flag off records no native_router_v1_predicted provenance', () => {
  const captured: string[] = []
  configureTrajectoryCaptureForTests({
    skipExperience: true,
    persistLine: (line) => captured.push(line),
  })
  const prev = process.env.WR_NATIVE_ROUTER_V1_SHADOW
  delete process.env.WR_NATIVE_ROUTER_V1_SHADOW
  observeToolRouterResult('TOOL=none', routeToolIntent('TOOL=none'), { sourceType: 'REAL_TEST' })
  assert.equal(captured.some((l) => l.includes('native_router_v1_predicted')), false)
  if (prev === undefined) delete process.env.WR_NATIVE_ROUTER_V1_SHADOW
  else process.env.WR_NATIVE_ROUTER_V1_SHADOW = prev
})

check('8 flag on attaches shadow provenance without changing route', () => {
  const captured: string[] = []
  configureTrajectoryCaptureForTests({
    skipExperience: true,
    persistLine: (line) => captured.push(line),
  })
  const prev = process.env.WR_NATIVE_ROUTER_V1_SHADOW
  process.env.WR_NATIVE_ROUTER_V1_SHADOW = '1'
  configureNativeRouterV1ShadowForTests(() => ({
    artifact: 'WR-NATIVE-ROUTER-V1-CANDIDATE',
    predicted_class: 'NO_TOOL',
    gate: 'NO_TOOL_CONFIDENT',
    information_state: 'ANSWERABLE_FROM_CONTEXT',
    deterministic: 'NO_TOOL',
    lexical: 'MEMORY',
    wrim: 'NO_TOOL',
    confidence: 0.8,
    margin: 0.2,
    abstain_state: 'NO_TOOL_CONFIDENT',
    disagreement: true,
    current_route: 'NO_TOOL',
    matches_observed: true,
    alters_routing: false,
  }))
  const routed = routeToolIntent('TOOL=none')
  observeToolRouterResult('TOOL=none', routed, { sourceType: 'REAL_TEST' })
  assert.equal(routed.intent.decision, 'NO_TOOL')
  assert.equal(captured.some((l) => l.includes('native_router_v1_predicted')), true)
  assert.equal(captured.some((l) => l.includes('"native_router_v1_alters_routing":"0"')), true)
  configureNativeRouterV1ShadowForTests(null)
  if (prev === undefined) delete process.env.WR_NATIVE_ROUTER_V1_SHADOW
  else process.env.WR_NATIVE_ROUTER_V1_SHADOW = prev
  resetTrajectoryCaptureForTests()
})

finish()
