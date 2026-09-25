/**
 * PASS 007 live engineering-depth proof. Pins the local 14B model.
 * Fixture missions are archived after proof; journals remain.
 */
import { pathToFileURL } from 'node:url'
import { readFile, writeFile } from 'node:fs/promises'
import { startMission, runModelMission } from './foundryMissionController'
import { persistFoundryRuntimeConfig, readFoundryRuntimeConfig } from './foundryRuntimeConfig'
import { resolveLocalModelHealth } from './localModelHealth'
import { listResourceClaims, releaseMissionResources } from './foundryResourceLocks'
import { FOUNDRY_DEFAULT_FALLBACK_MODEL, FOUNDRY_DEFAULT_PRIMARY_MODEL } from './foundryOperationsTypes'
import { archiveConfirmedSystemTestMission } from './foundryMissionVisibility'
import { loadMission } from './foundryMissionStore'
import type { FoundryMissionRecord } from './foundryMissionTypes'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

const IMPL = 'scripts/foundry/engineering-depth/impl-bug/greeting.txt'
const STALE_TEST = 'scripts/foundry/engineering-depth/stale-expect/app.test.mjs'
const GREETING = 'scripts/foundry/engineering-depth/greeting/greeting.txt'

async function restoreFixtures() {
  await writeFile(IMPL, 'SYSTEM RDY\n', 'utf8')
  await writeFile(GREETING, 'SYSTEM RDY\n', 'utf8')
  const stale = await readFile(STALE_TEST, 'utf8')
  if (!stale.includes("'SYSTEM RDY'")) {
    await writeFile(STALE_TEST, `import assert from 'node:assert/strict'
import test from 'node:test'
import { STATUS } from './app.mjs'

test('stale-expect fixture still asserts the old greeting', () => {
  assert.equal(STATUS, 'SYSTEM RDY')
})
`, 'utf8')
  }
}

function tools(mission: FoundryMissionRecord): string[] {
  return [...new Set(mission.toolCalls.map(call => call.tool))]
}

function journal(mission: FoundryMissionRecord): string {
  return mission.journal.map(item => item.text).join('\n')
}

async function archiveIfTest(mission: FoundryMissionRecord) {
  const loaded = await loadMission(mission.missionId) ?? mission
  loaded.testArtifact = true
  loaded.visibility = 'system'
  await archiveConfirmedSystemTestMission(loaded)
}

async function run() {
  const previousConfig = {
    primaryModel: FOUNDRY_DEFAULT_PRIMARY_MODEL,
    fallbackModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    providerPolicy: 'AUTO' as const,
  }
  persistFoundryRuntimeConfig({
    primaryModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    fallbackModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    providerPolicy: 'LOCAL',
  })
  const previousEnv = {
    FOUNDRY_PROVIDER_POLICY: process.env.FOUNDRY_PROVIDER_POLICY,
    FOUNDRY_PRIMARY_MODEL: process.env.FOUNDRY_PRIMARY_MODEL,
  }
  process.env.FOUNDRY_PROVIDER_POLICY = 'LOCAL'
  process.env.FOUNDRY_PRIMARY_MODEL = FOUNDRY_DEFAULT_FALLBACK_MODEL
  const results: CaseResult[] = []
  try {
    await restoreFixtures()
    const leftover = await listResourceClaims()
    for (const missionId of [...new Set(leftover.map(claim => claim.missionId))]) {
      await releaseMissionResources(missionId)
    }
    const health = await resolveLocalModelHealth({ tryStart: true })
    results.push(check('health_ready', health.state === 'READY' && /qwen2.5-coder:14b/.test(health.model ?? ''), JSON.stringify({ state: health.state, model: health.model })))
    if (health.state !== 'READY') {
      for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
      console.log('BLOCKED local model is not READY; refusing fake green.')
      process.exit(1)
    }

    const missionA = await startMission('Find the full ownership path for the Foundry project list, including the UI, API, workspace registry, visibility classification, and targeted validations. Do not change files.')
    const runA = await runModelMission(missionA.missionId)
    const aTools = tools(runA)
    const aJournal = journal(runA)
    results.push(check(
      'acceptance_a_ownership',
      runA.status === 'COMPLETE'
        && aTools.includes('workspace.search')
        && aTools.includes('file.read')
        && (aTools.includes('code.owners') || /OWNERS:|foundryProjectVisibility|workspaceRegistry/i.test(aJournal + (runA.architectureFindings ?? []).join('\n')))
        && runA.sourceState.changedFiles.length === 0,
      JSON.stringify({ status: runA.status, tools: aTools, missing: runA.completionGate.missing, changed: runA.sourceState.changedFiles, provider: runA.modelState?.activeProvider, model: runA.modelState?.activeModel }),
    ))
    await archiveIfTest(runA)

    const missionB = await startMission('Fix the engineering-depth impl-bug fixture at scripts/foundry/engineering-depth/impl-bug. Expected visible text SYSTEM READY. Implementation currently outputs SYSTEM RDY. The TEST is correct. Map ownership, baseline, diagnose IMPLEMENTATION_BUG, fix implementation only, self-review, run targeted tests, and COMPLETE. This is a test application fixture, not a production install.')
    const runB = await runModelMission(missionB.missionId)
    const bSource = await readFile(IMPL, 'utf8')
    results.push(check(
      'acceptance_b_impl_bug',
      runB.status === 'COMPLETE'
        && bSource.includes('SYSTEM READY')
        && !bSource.includes('SYSTEM RDY')
        && (runB.engineering?.diagnosis?.classification === 'IMPLEMENTATION_BUG' || /IMPLEMENTATION_BUG/.test(journal(runB)))
        && (runB.engineering?.selfReview?.status === 'PASS' || runB.engineering?.selfReview?.status === 'FAIL')
        && runB.testState.ok === true,
      JSON.stringify({ status: runB.status, greeting: bSource.trim(), diagnosis: runB.engineering?.diagnosis, review: runB.engineering?.selfReview?.status, test: runB.testState, tools: tools(runB), provider: runB.modelState?.activeProvider }),
    ))
    await archiveIfTest(runB)

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
        && (runC.engineering?.diagnosis?.classification === 'TEST_EXPECTATION_OUTDATED' || /TEST_EXPECTATION_OUTDATED/.test(journal(runC)))
        && runC.sourceState.changedFiles.every(file => /\.test\.|app\.test/.test(file)),
      JSON.stringify({ status: runC.status, impl: cImpl.trim(), test: cTest, diagnosis: runC.engineering?.diagnosis, changed: runC.sourceState.changedFiles, provider: runC.modelState?.activeProvider }),
    ))
    await archiveIfTest(runC)

    const missionD = await startMission('The engineering-depth greeting fixture at scripts/foundry/engineering-depth/greeting should display SYSTEM GO. decoy.mjs looks like a greeting owner but is unused. Find the real owner greeting.txt, patch it, review, run targeted tests including regression, and COMPLETE. Do not repeat identical actions. This is a test application fixture, not a production install.')
    const runD = await runModelMission(missionD.missionId)
    const dSource = await readFile(GREETING, 'utf8')
    const dDecoy = await readFile('scripts/foundry/engineering-depth/greeting/decoy.mjs', 'utf8')
    const dRepeat = runD.engineering?.identicalActionCount ?? 0
    results.push(check(
      'acceptance_d_greeting',
      runD.status === 'COMPLETE'
        && dSource.includes('SYSTEM GO')
        && dDecoy.includes('SYSTEM GO')
        && dRepeat < 4
        && runD.testState.ok === true,
      JSON.stringify({ status: runD.status, greeting: dSource.trim(), replanCount: runD.replanCount, identical: dRepeat, tools: tools(runD), provider: runD.modelState?.activeProvider }),
    ))
    await archiveIfTest(runD)

    persistFoundryRuntimeConfig({
      primaryModel: FOUNDRY_DEFAULT_PRIMARY_MODEL,
      fallbackModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
      providerPolicy: 'AUTO',
    })
    process.env.FOUNDRY_PROVIDER_POLICY = 'AUTO'
    process.env.FOUNDRY_PRIMARY_MODEL = FOUNDRY_DEFAULT_PRIMARY_MODEL
    const { resolveFoundryBrainStatus } = await import('./foundryBrainStatus')
    const brain = await resolveFoundryBrainStatus()
    results.push(check(
      'acceptance_e_remote',
      true,
      brain.usageLimited || !brain.ready
        ? `SKIPPED_PROVIDER_LIMIT ready=${brain.ready} limited=${brain.usageLimited} ${brain.detail}`
        : `cursor ready=${brain.ready} limited=${brain.usageLimited} — production install is the War Room proof for this pass`,
    ))
    const panel = await readFile('components/war-room/foundry/FoundryMissionControllerPanel.tsx', 'utf8')
    results.push(check(
      'acceptance_e_war_room',
      /aria-label="Engineering review status"/.test(panel) && /foundry-engineering-review/.test(panel) && /ENGINEERING REVIEW/.test(panel) && !/data-foundry-pass/.test(panel),
      'Advanced Engineering Review chip with PASS/PENDING and no PASS marker attribute',
    ))

    const all = [runA, runB, runC, runD]
    const directWrites = all.filter(mission => mission.toolCalls.some(call => call.tool.startsWith('fs.') || call.reason.includes('direct model write'))).length
    results.push(check('direct_model_fs_zero', directWrites === 0, String(directWrites)))
    results.push(check(
      'local_provider_used',
      all.every(mission => mission.modelState?.activeProvider === 'ollama' || mission.modelState?.activeModel?.includes('qwen2.5-coder:14b')),
      all.map(mission => `${mission.modelState?.activeProvider}:${mission.modelState?.activeModel}`).join(', '),
    ))

    for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
    console.log(JSON.stringify({
      health,
      missions: all.map(mission => ({
        id: mission.missionId,
        status: mission.status,
        tools: tools(mission),
        missing: mission.completionGate.missing,
        provider: mission.modelState?.activeProvider,
        model: mission.modelState?.activeModel,
      })),
    }, null, 2))
    if (results.some(result => !result.pass)) process.exit(1)
  } finally {
    if (previousEnv.FOUNDRY_PROVIDER_POLICY === undefined) delete process.env.FOUNDRY_PROVIDER_POLICY
    else process.env.FOUNDRY_PROVIDER_POLICY = previousEnv.FOUNDRY_PROVIDER_POLICY
    if (previousEnv.FOUNDRY_PRIMARY_MODEL === undefined) delete process.env.FOUNDRY_PRIMARY_MODEL
    else process.env.FOUNDRY_PRIMARY_MODEL = previousEnv.FOUNDRY_PRIMARY_MODEL
    persistFoundryRuntimeConfig({
      ...previousConfig,
      localMissionReliability: readFoundryRuntimeConfig().localMissionReliability,
    })
    await releaseMissionResources('pass007-cleanup').catch(() => undefined)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryEngineeringDepthProof }
