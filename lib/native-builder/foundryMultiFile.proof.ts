/**
 * PASS 008 live A–D proofs against the local 14B.
 * Fixtures are archived after proof; journals remain.
 */
import { pathToFileURL } from 'node:url'
import { startMission, runModelMission } from './foundryMissionController'
import { persistFoundryRuntimeConfig } from './foundryRuntimeConfig'
import { resolveLocalModelHealth } from './localModelHealth'
import { listResourceClaims, releaseMissionResources } from './foundryResourceLocks'
import { FOUNDRY_DEFAULT_FALLBACK_MODEL, FOUNDRY_DEFAULT_PRIMARY_MODEL } from './foundryOperationsTypes'
import { archiveConfirmedSystemTestMission } from './foundryMissionVisibility'
import { loadMission } from './foundryMissionStore'
import type { FoundryMissionRecord } from './foundryMissionTypes'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function tools(mission: FoundryMissionRecord): string[] {
  return [...new Set(mission.toolCalls.map(call => call.tool))]
}

async function archiveIfTest(mission: FoundryMissionRecord) {
  const loaded = await loadMission(mission.missionId) ?? mission
  loaded.testArtifact = true
  loaded.visibility = 'system'
  loaded.resumeEligible = false
  await archiveConfirmedSystemTestMission(loaded)
}

async function run() {
  persistFoundryRuntimeConfig({
    primaryModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    fallbackModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    providerPolicy: 'LOCAL',
  })
  process.env.FOUNDRY_PROVIDER_POLICY = 'LOCAL'
  process.env.FOUNDRY_PRIMARY_MODEL = FOUNDRY_DEFAULT_FALLBACK_MODEL
  const results: CaseResult[] = []
  const leftover = await listResourceClaims()
  for (const missionId of [...new Set(leftover.map(claim => claim.missionId))]) {
    await releaseMissionResources(missionId)
  }
  const health = await resolveLocalModelHealth({ tryStart: true })
  results.push(check('health_ready', health.state === 'READY' && /qwen2.5-coder:14b/.test(health.model ?? ''), JSON.stringify({ state: health.state, model: health.model })))
  if (health.state !== 'READY') {
    for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
    process.exit(1)
  }

  const missionA = await startMission('Map the complete ownership path for Foundry session creation, including UI, API, state/persistence, workspace inheritance, and tests. Do not change files.')
  const runA = await runModelMission(missionA.missionId)
  const toolsA = tools(runA)
  results.push(check(
    'acceptance_a_ownership',
    runA.status === 'COMPLETE'
      && toolsA.includes('code.symbol')
      && (toolsA.includes('code.refs') || toolsA.includes('code.dependents'))
      && toolsA.includes('code.owners')
      && runA.sourceState.changedFiles.length === 0,
    JSON.stringify({ status: runA.status, tools: toolsA, missing: runA.completionGate.missing, provider: runA.modelState?.activeProvider, model: runA.modelState?.activeModel }),
  ))
  await archiveIfTest(runA)

  const missionB = await startMission('Identify duplicated greet() behavior across scripts/foundry/multi-file/duplication alpha/beta/gamma. Classify BEHAVIOR_PRESERVING_REFACTOR, extract a shared helper, update all callers, self-review, run tests, and COMPLETE. Do not change observable READY behavior. This is a test application fixture, not a production install.')
  const runB = await runModelMission(missionB.missionId)
  results.push(check(
    'acceptance_b_refactor',
    runB.status === 'COMPLETE'
      && runB.testState.ok === true
      && runB.sourceState.changedFiles.some(file => file.includes('shared.mjs'))
      && runB.sourceState.changedFiles.some(file => /alpha|beta|gamma/.test(file)),
    JSON.stringify({ status: runB.status, files: runB.sourceState.changedFiles, tests: runB.testState, review: runB.engineering?.selfReview?.status, missing: runB.completionGate.missing }),
  ))
  await archiveIfTest(runB)

  const missionC = await startMission('The scripts/foundry/multi-file/gap fixture source already handles empty/null. Discover the missing edge-case coverage, generate a focused test, run it, review test quality, and COMPLETE. This is a test application fixture, not a production install.')
  const runC = await runModelMission(missionC.missionId)
  results.push(check(
    'acceptance_c_generated_test',
    runC.status === 'COMPLETE'
      && runC.testState.ok === true
      && (runC.engineering?.testReview?.status === 'PASS' || runC.engineering?.selfReview?.status === 'PASS')
      && runC.sourceState.changedFiles.some(file => file.includes('gap/app.test.mjs')),
    JSON.stringify({ status: runC.status, files: runC.sourceState.changedFiles, testReview: runC.engineering?.testReview, missing: runC.completionGate.missing }),
  ))
  await archiveIfTest(runC)

  const missionD = await startMission('Change the formatLabel contract in scripts/foundry/multi-file/contract from a string argument to {name,suffix}. Find all references, update every caller and the test, verify no stale caller remains, and COMPLETE. This is a test application fixture, not a production install.')
  const runD = await runModelMission(missionD.missionId)
  results.push(check(
    'acceptance_d_contract',
    runD.status === 'COMPLETE'
      && runD.testState.ok === true
      && runD.sourceState.changedFiles.some(file => file.includes('format.mjs'))
      && runD.sourceState.changedFiles.some(file => file.includes('caller-')),
    JSON.stringify({ status: runD.status, files: runD.sourceState.changedFiles, contract: runD.engineering?.contractMigration, missing: runD.completionGate.missing }),
  ))
  await archiveIfTest(runD)

  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  if (results.some(result => !result.pass)) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
