import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createValidationHarness } from '@/lib/agi-program/validationHarness'
import { configureFrozenRouterShadowForTests, scoreFrozenRouterShadow } from './frozenRouterShadow'
import { isFrozenRouterShadowEnabled } from './frozenRouterShadowGate'
import { configureTrajectoryCaptureForTests, resetTrajectoryCaptureForTests } from './runtimeTrajectoryCapture'
import { observeToolRouterResult, routeToolIntent } from './toolRouter'

const EXPECTED = 8
const { check, finish } = createValidationHarness('WR-TOOL frozen router shadow wiring', EXPECTED)
const repo = process.cwd()

resetTrajectoryCaptureForTests()
configureTrajectoryCaptureForTests({ skipExperience: true, persistLine: () => undefined })

check('1 production NODE_ENV cannot enable shadow', () => {
  assert.equal(isFrozenRouterShadowEnabled({ NODE_ENV: 'production', WR_TOOL_FROZEN_ROUTER_SHADOW: '1' } as NodeJS.ProcessEnv), false)
})

check('2 default development is off', () => {
  assert.equal(isFrozenRouterShadowEnabled({ NODE_ENV: 'development' } as NodeJS.ProcessEnv), false)
})

check('3 explicit flag enables only in non-production', () => {
  assert.equal(isFrozenRouterShadowEnabled({ NODE_ENV: 'development', WR_TOOL_FROZEN_ROUTER_SHADOW: '1' } as NodeJS.ProcessEnv), true)
})

check('4 routeToolIntent is unchanged by shadow scoring', () => {
  const prev = process.env.WR_TOOL_FROZEN_ROUTER_SHADOW
  process.env.WR_TOOL_FROZEN_ROUTER_SHADOW = '1'
  configureFrozenRouterShadowForTests(() => ({
    artifact: 'WR-TOOL-FROZEN-ROUTER-L10-MEAN-V1',
    predicted_class: 'WEB',
    probability: 0.9,
    top2_class: 'RESEARCH',
    margin: 0.4,
    current_route: 'SHA256',
    matches_observed: false,
    alters_routing: false,
  }))
  const a = routeToolIntent('TOOL=sha256\ntext=shadow-proof')
  const b = routeToolIntent('TOOL=sha256\ntext=shadow-proof')
  assert.equal(a.intent.tool_id, 'sha256')
  assert.equal(b.intent.tool_id, 'sha256')
  assert.equal(a.intent.decision, b.intent.decision)
  assert.deepEqual(a.normalized?.arguments, b.normalized?.arguments)
  configureFrozenRouterShadowForTests(null)
  if (prev === undefined) delete process.env.WR_TOOL_FROZEN_ROUTER_SHADOW
  else process.env.WR_TOOL_FROZEN_ROUTER_SHADOW = prev
})

check('5 shadow score does not mutate routed intent', () => {
  const routed = routeToolIntent('TOOL=sha256\ntext=immutable-shadow')
  const snapshot = JSON.stringify(routed)
  const scored = scoreFrozenRouterShadow('TOOL=sha256\ntext=immutable-shadow', routed, {
    NODE_ENV: 'development',
    WR_TOOL_FROZEN_ROUTER_SHADOW: '1',
  } as NodeJS.ProcessEnv)
  assert.equal(JSON.stringify(routed), snapshot)
  assert.equal(scored?.alters_routing, false)
})

check('6 observer reused; no parallel ledger import in toolRouter', () => {
  const src = readFileSync(join(repo, 'lib/modular-intelligence/toolRouter.ts'), 'utf8')
  assert.equal(src.includes('scoreFrozenRouterShadow'), true)
  assert.equal(src.includes('captureRuntimeTrajectory'), true)
  assert.equal(src.includes('parallelLedger'), false)
})

check('7 flag off records no frozen_router_predicted provenance', () => {
  const captured: string[] = []
  configureTrajectoryCaptureForTests({
    skipExperience: true,
    persistLine: (line) => captured.push(line),
  })
  const prev = process.env.WR_TOOL_FROZEN_ROUTER_SHADOW
  delete process.env.WR_TOOL_FROZEN_ROUTER_SHADOW
  observeToolRouterResult('TOOL=none', routeToolIntent('TOOL=none'), { sourceType: 'REAL_TEST' })
  assert.equal(captured.some((l) => l.includes('frozen_router_predicted')), false)
  if (prev === undefined) delete process.env.WR_TOOL_FROZEN_ROUTER_SHADOW
  else process.env.WR_TOOL_FROZEN_ROUTER_SHADOW = prev
})

check('8 flag on attaches shadow provenance without changing route', () => {
  const captured: string[] = []
  configureTrajectoryCaptureForTests({
    skipExperience: true,
    persistLine: (line) => captured.push(line),
  })
  const prev = process.env.WR_TOOL_FROZEN_ROUTER_SHADOW
  process.env.WR_TOOL_FROZEN_ROUTER_SHADOW = '1'
  configureFrozenRouterShadowForTests(() => ({
    artifact: 'WR-TOOL-FROZEN-ROUTER-L10-MEAN-V1',
    predicted_class: 'NO_TOOL',
    probability: 0.55,
    top2_class: 'MEMORY',
    margin: 0.1,
    current_route: 'NO_TOOL',
    matches_observed: true,
    alters_routing: false,
  }))
  const routed = routeToolIntent('TOOL=none')
  observeToolRouterResult('TOOL=none', routed, { sourceType: 'REAL_TEST' })
  assert.equal(routed.intent.decision, 'NO_TOOL')
  assert.equal(captured.some((l) => l.includes('frozen_router_predicted')), true)
  assert.equal(captured.some((l) => l.includes('"frozen_router_alters_routing":"0"')), true)
  configureFrozenRouterShadowForTests(null)
  if (prev === undefined) delete process.env.WR_TOOL_FROZEN_ROUTER_SHADOW
  else process.env.WR_TOOL_FROZEN_ROUTER_SHADOW = prev
  resetTrajectoryCaptureForTests()
})

finish()
