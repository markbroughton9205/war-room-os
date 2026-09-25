/**
 * Re-run PASS 007 C/D after post-review tool gating.
 */
import { pathToFileURL } from 'node:url'
import { readFile, writeFile } from 'node:fs/promises'
import { startMission, runModelMission, cancelMission } from './foundryMissionController'
import { resolveLocalModelHealth } from './localModelHealth'
import { listResourceClaims, releaseMissionResources } from './foundryResourceLocks'
import { FOUNDRY_DEFAULT_FALLBACK_MODEL } from './foundryOperationsTypes'
import { archiveConfirmedSystemTestMission } from './foundryMissionVisibility'
import { listAllMissions, loadMission } from './foundryMissionStore'
import type { FoundryMissionRecord } from './foundryMissionTypes'

const IMPL = 'scripts/foundry/engineering-depth/impl-bug/greeting.txt'
const STALE_TEST = 'scripts/foundry/engineering-depth/stale-expect/app.test.mjs'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

async function restore() {
  await writeFile(IMPL, 'SYSTEM RDY\n', 'utf8')
  await writeFile('scripts/foundry/engineering-depth/stale-expect/greeting.txt', 'SYSTEM READY\n', 'utf8')
  await writeFile(STALE_TEST, `import assert from 'node:assert/strict'
import test from 'node:test'
import { STATUS } from './app.mjs'

test('stale-expect fixture still asserts the old greeting', () => {
  assert.equal(STATUS, 'SYSTEM RDY')
})
`, 'utf8')
}

async function archiveIfTest(mission: FoundryMissionRecord) {
  const loaded = await loadMission(mission.missionId) ?? mission
  loaded.testArtifact = true
  loaded.visibility = 'system'
  await archiveConfirmedSystemTestMission(loaded)
}

async function run() {
  process.env.FOUNDRY_PROVIDER_POLICY = 'LOCAL'
  process.env.FOUNDRY_PRIMARY_MODEL = FOUNDRY_DEFAULT_FALLBACK_MODEL
  await restore()
  const leftover = await listResourceClaims()
  for (const missionId of [...new Set(leftover.map(claim => claim.missionId))]) {
    await releaseMissionResources(missionId).catch(() => undefined)
  }
  const live = await listAllMissions()
  for (const mission of live) {
    if (['WAITING_RESOURCE', 'EXECUTING', 'REPLANNING', 'INSPECTING'].includes(mission.status) && /engineering-depth|data-foundry-pass/i.test(`${mission.title}\n${mission.userRequest}`)) {
      await cancelMission(mission.missionId).catch(() => undefined)
      await releaseMissionResources(mission.missionId).catch(() => undefined)
    }
  }
  const health = await resolveLocalModelHealth({ tryStart: false })
  const results: CaseResult[] = [
    check('health_ready', health.state === 'READY', JSON.stringify(health)),
  ]
  if (health.state !== 'READY') {
    console.log('BLOCKED', health)
    process.exit(1)
  }

  const missionB = await startMission('Fix the engineering-depth impl-bug fixture at scripts/foundry/engineering-depth/impl-bug. Expected visible text SYSTEM READY. Implementation currently outputs SYSTEM RDY. The TEST is correct. Map ownership, baseline, diagnose IMPLEMENTATION_BUG, fix implementation only, self-review, run targeted tests, and COMPLETE. This is a test application fixture, not a production install.')
  const runB = await runModelMission(missionB.missionId)
  const bSource = await readFile(IMPL, 'utf8')
  results.push(check(
    'acceptance_b_impl_bug',
    runB.status === 'COMPLETE'
      && bSource.includes('SYSTEM READY')
      && !bSource.includes('SYSTEM RDY')
      && (runB.engineering?.diagnosis?.classification === 'IMPLEMENTATION_BUG' || /IMPLEMENTATION_BUG/.test(runB.journal.map(item => item.text).join('\n')))
      && (runB.engineering?.selfReview?.status === 'PASS' || runB.engineering?.selfReview?.status === 'FAIL')
      && runB.testState.ok === true,
    JSON.stringify({ status: runB.status, greeting: bSource.trim(), diagnosis: runB.engineering?.diagnosis, review: runB.engineering?.selfReview?.status, test: runB.testState.ok, tools: runB.toolCalls.map(call => call.tool), missing: runB.completionGate.missing }),
  ))
  await archiveIfTest(runB)
  if (process.argv.includes('--b-only')) {
    for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
    if (results.some(result => !result.pass)) process.exit(1)
    return
  }

  const missionC = await startMission('The engineering-depth stale-expect fixture at scripts/foundry/engineering-depth/stale-expect already presents SYSTEM READY. The existing test still expects SYSTEM RDY. Classify TEST_EXPECTATION_OUTDATED, update ONLY the test expectation, self-review, validate, and COMPLETE. Do not change production source. This is a test application fixture, not a production install.')
  const runC = await runModelMission(missionC.missionId)
  const cImpl = await readFile('scripts/foundry/engineering-depth/stale-expect/greeting.txt', 'utf8')
  const cTest = await readFile(STALE_TEST, 'utf8')
  results.push(check(
    'acceptance_c_stale_test',
    runC.status === 'COMPLETE'
      && cImpl.includes('SYSTEM READY')
      && cTest.includes('SYSTEM READY')
      && !cTest.includes("'SYSTEM RDY'")
      && (runC.engineering?.diagnosis?.classification === 'TEST_EXPECTATION_OUTDATED' || /TEST_EXPECTATION_OUTDATED/.test(runC.journal.map(item => item.text).join('\n')))
      && runC.sourceState.changedFiles.every(file => /\.test\.|app\.test/.test(file)),
    JSON.stringify({ status: runC.status, impl: cImpl.trim(), test: cTest, diagnosis: runC.engineering?.diagnosis, changed: runC.sourceState.changedFiles, tools: runC.toolCalls.map(call => call.tool), missing: runC.completionGate.missing }),
  ))
  await archiveIfTest(runC)

  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  if (results.some(result => !result.pass)) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
