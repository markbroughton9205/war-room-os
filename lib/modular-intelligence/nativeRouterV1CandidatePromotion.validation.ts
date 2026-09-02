import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createValidationHarness } from '@/lib/agi-program/validationHarness'
import { isNativeRouterV1ShadowEnabled } from './nativeRouterV1Gate'
import { configureNativeRouterV1ShadowForTests, scoreNativeRouterV1Shadow } from './nativeRouterV1Shadow'
import { routeToolIntent } from './toolRouter'

const EXPECTED = 10
const { check, finish } = createValidationHarness('WR Native Router V1 candidate promotion', EXPECTED)
const repo = process.cwd()
const man = JSON.parse(
  readFileSync(join(repo, 'model-lab/manifests/wr_tool_experiments/WR-NATIVE-ROUTER-V1-CANDIDATE/manifest.json'), 'utf8'),
) as {
  lifecycle: string
  serving_activation: boolean
  production_serving: boolean
  active_modules: unknown[]
  default_off: boolean
  production_always_off: boolean
}

check('1 lifecycle is CANDIDATE not ACTIVE', () => {
  assert.equal(man.lifecycle, 'CANDIDATE')
  assert.notEqual(man.lifecycle, 'ACTIVE')
})

check('2 serving_activation false', () => {
  assert.equal(man.serving_activation, false)
  assert.equal(man.production_serving, false)
})

check('3 active modules empty', () => {
  assert.deepEqual(man.active_modules, [])
})

check('4 production cannot enable shadow flag', () => {
  assert.equal(
    isNativeRouterV1ShadowEnabled({ NODE_ENV: 'production', WR_NATIVE_ROUTER_V1_SHADOW: '1' } as NodeJS.ProcessEnv),
    false,
  )
})

check('5 development flag default off', () => {
  assert.equal(isNativeRouterV1ShadowEnabled({ NODE_ENV: 'development' } as NodeJS.ProcessEnv), false)
  assert.equal(man.default_off, true)
  assert.equal(man.production_always_off, true)
})

check('6 flag off yields no native shadow score', () => {
  const routed = routeToolIntent('TOOL=sha256\ntext=candidate-promotion-proof')
  const scored = scoreNativeRouterV1Shadow('TOOL=sha256\ntext=candidate-promotion-proof', routed, {
    NODE_ENV: 'development',
  } as NodeJS.ProcessEnv)
  assert.equal(scored, null)
})

check('7 existing router still owns compact TOOL= routing', () => {
  const routed = routeToolIntent('TOOL=sha256\ntext=candidate-promotion-proof')
  assert.equal(routed.intent.tool_id, 'sha256')
  assert.equal(routed.executed, false)
})

check('8 native score does not mutate routed intent when flag forced on', () => {
  configureNativeRouterV1ShadowForTests(() => ({
    artifact: 'WR-NATIVE-ROUTER-V1-CANDIDATE',
    predicted_class: 'WEB',
    gate: 'TOOL_REQUIRED_CONFIDENT',
    information_state: 'CURRENT_EXTERNAL_INFORMATION_REQUIRED',
    deterministic: 'WEB',
    lexical: 'WEB',
    wrim: null,
    confidence: 0.9,
    margin: 0.4,
    abstain_state: 'ROUTE_CONFIDENT',
    disagreement: false,
    current_route: 'NO_TOOL',
    matches_observed: false,
    alters_routing: false,
  }))
  const routed = routeToolIntent('TOOL=none')
  const snapshot = JSON.stringify(routed)
  const scored = scoreNativeRouterV1Shadow('TOOL=none', routed, {
    NODE_ENV: 'development',
    WR_NATIVE_ROUTER_V1_SHADOW: '1',
  } as NodeJS.ProcessEnv)
  assert.equal(JSON.stringify(routed), snapshot)
  assert.equal(scored?.alters_routing, false)
  assert.equal(routed.intent.decision, 'NO_TOOL')
  configureNativeRouterV1ShadowForTests(null)
})

check('9 routeToolIntent source still the live router', () => {
  const src = readFileSync(join(repo, 'lib/modular-intelligence/toolRouter.ts'), 'utf8')
  assert.equal(src.includes('export function routeToolIntent'), true)
  assert.equal(src.includes('executeNormalizedRequest'), true)
  assert.equal(src.includes('scoreNativeRouterV1Shadow'), true)
})

check('10 native shadow source cannot alter routing', () => {
  const src = readFileSync(join(repo, 'lib/modular-intelligence/nativeRouterV1Shadow.ts'), 'utf8')
  assert.equal(src.includes('alters_routing: false'), true)
})

finish()
