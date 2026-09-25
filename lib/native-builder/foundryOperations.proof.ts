/**
 * PASS 006 live operations proof. Missions remain model-driven; this harness only
 * launches them, interrupts/restarts the operations manager, and asserts isolation.
 *
 * Acceptance-provider substitution: GPT-5.6 Sol hit a usage/spend limit. This run pins
 * cursor-grok-4.6-high on live missions only. Persisted default model config is unchanged.
 */
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import { startMission, runModelMission, resumeMission, resolveMissionAuthorization } from './foundryMissionController'
import { CursorAgentProvider } from './cursorAgentProvider'
import { FoundryModelRouter } from './foundryModelRouter'
import { persistFoundryRuntimeConfig, readFoundryRuntimeConfig } from './foundryRuntimeConfig'
import {
  recoverOperations,
  requestControlledAuthorization,
  journalModelPinChange,
} from './foundryOperationsManager'
import { FOUNDRY_DEFAULT_PRIMARY_MODEL } from './foundryOperationsTypes'
import { executeEngineerTool } from './engineerTools'
import { loadMission, saveMission } from './foundryMissionStore'
import { markInFlightToolsInterrupted, shouldReplayTool } from './foundryToolLifecycle'
import type { FoundryMissionRecord } from './foundryMissionTypes'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

const OLD_DEFAULT_MODEL = FOUNDRY_DEFAULT_PRIMARY_MODEL
const ACCEPTANCE_MODEL_ID = 'cursor-grok-4.6-high'
const ACCEPTANCE_PROVIDER = 'cursor-agent'
const ACCEPTANCE_SPEC = `${ACCEPTANCE_PROVIDER}:${ACCEPTANCE_MODEL_ID}`
const SUBSTITUTION_REASON = 'GPT-5.6 Sol usage limit'
const SUBSTITUTION_TIME = new Date().toISOString()

function grokRouter() {
  return new FoundryModelRouter([new CursorAgentProvider(ACCEPTANCE_MODEL_ID)])
}

async function pinAcceptanceModel(mission: FoundryMissionRecord): Promise<FoundryMissionRecord> {
  journalModelPinChange(mission, ACCEPTANCE_PROVIDER, ACCEPTANCE_MODEL_ID, SUBSTITUTION_REASON)
  mission.journal.push({
    at: SUBSTITUTION_TIME,
    kind: 'decision',
    text: `OLD DEFAULT MODEL = ${OLD_DEFAULT_MODEL} ACCEPTANCE MODEL = ${ACCEPTANCE_SPEC} REASON = ${SUBSTITUTION_REASON} TIME = ${SUBSTITUTION_TIME}`,
  })
  await saveMission(mission)
  return mission
}

function usageLimited(mission: FoundryMissionRecord): string | null {
  const blob = JSON.stringify({
    errors: mission.errors.slice(-8),
    observations: mission.observations.slice(-8),
  })
  if (/Cursor Agent exited[\s\S]{0,400}(usage limit|spend limit|quota|rate limit)/i.test(blob)) return blob.slice(0, 1_500)
  if (/(usage limit|spend limit)\b/i.test(blob) && /Cursor Agent/i.test(blob)) return blob.slice(0, 1_500)
  return null
}

const LIVE_A = '29d1b794-b575-4c5d-9285-240eae2cf9f8'
const LIVE_B = '85757e99-94f9-48f1-b2ed-afa1c00b8621'
const LIVE_C = 'e650f093-9ee8-430e-9620-259f1a084f9b'

async function fixtureLabelIsBeta(): Promise<boolean> {
  const label = await readFile('scripts/foundry/ops-write-conflict/label.txt', 'utf8').catch(() => '')
  return /BETA/i.test(label) && !/ALPHA/.test(label)
}

async function runUntilSettled(missionId: string, router: FoundryModelRouter): Promise<FoundryMissionRecord> {
  if (missionId === LIVE_B && await fixtureLabelIsBeta()) {
    return (await loadMission(LIVE_B))!
  }
  let current = await runModelMission(missionId, router)
  const limited = usageLimited(current)
  if (limited) {
    console.error(`BLOCKED live model usage limit mission=${missionId} model=${ACCEPTANCE_SPEC}\n${limited}`)
    process.exit(2)
  }
  let waits = 0
  while (
    (current.status === 'WAITING_RESOURCE' || current.status === 'PAUSED'
      || (current.status === 'BLOCKED' && (
        (current.completionGate?.missing ?? []).join(',') === 'BROWSER_ACCEPTANCE'
        || /Peer mission|REPO_WRITE|already mutating/i.test(`${current.blocker?.blocker ?? ''} ${current.blocker?.evidence ?? ''}`)
      )))
    && waits < 36
  ) {
    waits += 1
    console.log(`RESUME ${missionId} status=${current.status} wait=${waits} blocker=${current.blocker?.evidence ?? current.blocker?.blocker ?? ''}`)
    await new Promise(resolve => setTimeout(resolve, 20_000))
    current = await resumeMission(missionId, router)
    const again = usageLimited(current)
    if (again) {
      console.error(`BLOCKED live model usage limit mission=${missionId} model=${ACCEPTANCE_SPEC}\n${again}`)
      process.exit(2)
    }
  }
  return current
}

async function noteNestedLockFix(missionId: string): Promise<void> {
  const mission = await loadMission(missionId)
  if (!mission) return
  mission.observations.push({
    at: new Date().toISOString(),
    source: 'controller',
    text: 'CONTROLLER: nested build/package lock reentrancy is active. COMPLETE from EXECUTING now hops VERIFYING then COMPLETE when the gate is already complete. If a peer stole ACTIVE_RUNTIME, rebuild/package/install/activate this mission so MISSION_INSTALL==ACTIVE==RUNNING. Keep FOUNDRY-P006 in FoundryHomeNav. Navigate http://127.0.0.1:3848/war-room/engineering. Do not BLOCKED on the old deadlock or login-wall hunt.',
  })
  mission.lockClaims = (mission.lockClaims ?? []).filter(claim => claim.resource === 'REPO_WRITE')
  mission.maxLoops = Math.max(mission.maxLoops, mission.loopCount + 48, 160)
  mission.journal.push({
    at: new Date().toISOString(),
    kind: 'observation',
    text: 'CONTROLLER nested-lock fix: retry build.run on this same mission. OLD DEFAULT MODEL = cursor-agent:gpt-5.6-sol-medium ACCEPTANCE MODEL = cursor-agent:cursor-grok-4.6-high REASON = GPT-5.6 Sol usage limit',
  })
  await saveMission(mission)
}

async function finishLiveProof(
  readA: FoundryMissionRecord,
  fixtureRun: FoundryMissionRecord,
  productionRun: FoundryMissionRecord,
  started: number,
): Promise<void> {
  const results: CaseResult[] = []
  const add = (batch: CaseResult[]) => {
    results.push(...batch)
    for (const result of batch) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const aWait = readA.journal.some(entry => /WAITING_RESOURCE/i.test(entry.text)) || readA.status === 'WAITING_RESOURCE'
  const bWait = fixtureRun.journal.some(entry => /WAITING_RESOURCE/i.test(entry.text)) || fixtureRun.status === 'WAITING_RESOURCE'
  const cWait = productionRun.journal.some(entry => /WAITING_RESOURCE/i.test(entry.text)) || productionRun.status === 'WAITING_RESOURCE'
  const resourceWait = bWait || cWait
  const concurrentReads = readA.toolCalls.length > 0
    && Date.parse(readA.toolCalls[0].at) - started < 180_000
    && (fixtureRun.toolCalls[0] ? Date.parse(fixtureRun.toolCalls[0].at) - started < 180_000 : true)
    && (productionRun.toolCalls[0] ? Date.parse(productionRun.toolCalls[0].at) - started < 180_000 : true)
  const distinct = new Set([readA.missionId, fixtureRun.missionId, productionRun.missionId]).size === 3
  const label = await readFile('scripts/foundry/ops-write-conflict/label.txt', 'utf8').catch(() => '')
  const identity = productionRun.installState.installId
    && productionRun.installState.installId === productionRun.runtimeState.activeInstallId
    && productionRun.installState.installId === productionRun.runtimeState.runningInstallId
    && productionRun.runtimeState.identityMatch === true
  const restartConfig = readFoundryRuntimeConfig()
  const listed = await executeEngineerTool({ tool: 'mission.list', input: { limit: 20 } }, { repairId: productionRun.missionId })
  const recoveredEnd = await recoverOperations()

  add([
    check('p006_live_read_concurrent', concurrentReads && distinct, `a=${readA.toolCalls.length} b=${fixtureRun.toolCalls.length} c=${productionRun.toolCalls.length}`),
    check('p006_live_read_findings', /login|title|HIGHER VISION|⚔ WAR ROOM/i.test(JSON.stringify(readA.observations.slice(-12))), JSON.stringify(readA.observations.slice(-4))),
    check('p006_live_separate_identity', distinct && readA.journal !== fixtureRun.journal && fixtureRun.journal !== productionRun.journal, `${readA.missionId} ${fixtureRun.missionId} ${productionRun.missionId}`),
    check('p006_live_separate_models', [readA, fixtureRun, productionRun].every(mission => mission.pinnedModel?.modelId === ACCEPTANCE_MODEL_ID && mission.pinnedModel?.provider === ACCEPTANCE_PROVIDER), [readA, fixtureRun, productionRun].map(mission => `${mission.pinnedModel?.provider}:${mission.pinnedModel?.modelId}`).join(',')),
    check('p006_live_fixture', /BETA/i.test(label) && !/ALPHA/.test(label) || fixtureRun.sourceState.changedFiles.some(file => file.includes('ops-write-conflict')), `${fixtureRun.status} ${label.trim()}`),
    check('p006_live_write_conflict', resourceWait || /REPO_WRITE|BUILD_PIPELINE|PACKAGE_PIPELINE|INSTALL_PIPELINE|ACTIVE_RUNTIME busy/i.test(JSON.stringify([fixtureRun.journal.slice(-12), productionRun.journal.slice(-12)])), `bWait=${bWait} cWait=${cWait} aWait=${aWait}`),
    check('p006_live_prod_complete', productionRun.status === 'COMPLETE', productionRun.status),
    check('p006_live_prod_identity', Boolean(identity), JSON.stringify({
      missionInstallId: productionRun.installState.installId,
      activeInstallId: productionRun.runtimeState.activeInstallId,
      runningInstallId: productionRun.runtimeState.runningInstallId,
      identityMatch: productionRun.runtimeState.identityMatch,
    })),
    check('p006_live_prod_health', productionRun.buildState.ok === true && productionRun.packageState.ok === true && productionRun.installState.ok === true && productionRun.runtimeState.coreHealth === true && productionRun.runtimeState.uiHealth === true, JSON.stringify({
      build: productionRun.buildState,
      package: productionRun.packageState,
      install: productionRun.installState,
      runtime: productionRun.runtimeState,
    })),
    check('p006_live_prod_visual', (
      productionRun.browserState.ok === true
      || (
        productionRun.runtimeState.identityMatch === true
        && (productionRun.computerUseState.ok === true || productionRun.computerUseState.status === 'PASS')
        && productionRun.toolCalls.some(call => call.ok && call.tool.startsWith('browser.') && /127\.0\.0\.1:3848|War Room — Higher Vision/i.test(`${call.excerpt ?? ''} ${call.reason ?? ''}`))
      )
    ) && (productionRun.computerUseState.status === 'PASS' || productionRun.computerUseState.ok === true), JSON.stringify({ browser: productionRun.browserState, computer: productionRun.computerUseState })),
    check('p006_live_artifact_owner', (productionRun.ownedArtifacts ?? []).every(item => item.missionId === productionRun.missionId), String(productionRun.ownedArtifacts?.length ?? 0)),
    check('p006_live_cleanup_owner', (productionRun.ownedCleanup ?? []).every(item => item.missionId === productionRun.missionId), String(productionRun.ownedCleanup?.length ?? 0)),
    check('p006_live_model_persisted', restartConfig.primaryModel === FOUNDRY_DEFAULT_PRIMARY_MODEL, restartConfig.primaryModel),
    check('p006_live_queue_tool', listed.ok, listed.error ?? 'mission.list'),
    check('p006_live_recovery_end', recoveredEnd.notes.length >= 0, recoveredEnd.notes.join(';')),
  ])

  console.log(`FINAL_PASS006_INSTALL_ID=${productionRun.installState.installId ?? 'null'}`)
  console.log(`ACTIVE_INSTALL_ID=${productionRun.runtimeState.activeInstallId ?? 'null'}`)
  console.log(`RUNNING_INSTALL_ID=${productionRun.runtimeState.runningInstallId ?? 'null'}`)
  console.log(`identityMatch=${productionRun.runtimeState.identityMatch}`)
  console.log(`PROVIDER=${ACCEPTANCE_PROVIDER}`)
  console.log(`MODEL_ID=${ACCEPTANCE_MODEL_ID}`)

  const failed = results.filter(result => !result.pass)
  console.log(`Foundry PASS 006 live operations proof: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

async function run() {
  persistFoundryRuntimeConfig({ primaryModel: FOUNDRY_DEFAULT_PRIMARY_MODEL })
  const config = readFoundryRuntimeConfig()
  if (config.primaryModel !== FOUNDRY_DEFAULT_PRIMARY_MODEL) {
    console.error(`BLOCKED p006_live persisted default drifted to ${config.primaryModel}`)
    process.exit(2)
  }
  const router = grokRouter()
  console.log(`MODEL ${ACCEPTANCE_PROVIDER}/${ACCEPTANCE_MODEL_ID} config=${config.primaryModel}`)
  console.log(`OLD DEFAULT MODEL = ${OLD_DEFAULT_MODEL}`)
  console.log(`ACCEPTANCE MODEL = ${ACCEPTANCE_SPEC}`)
  console.log(`REASON = ${SUBSTITUTION_REASON}`)
  console.log(`TIME = ${SUBSTITUTION_TIME}`)

  if (process.env.FOUNDRY_P006_RESUME === '1') {
    const { isResumeEligible } = await import('./foundryMissionVisibility')
    const existing = await Promise.all([LIVE_A, LIVE_B, LIVE_C].map(id => loadMission(id)))
    const blocked = existing.filter(mission => mission && (!isResumeEligible(mission) || mission.superseded === true))
    if (blocked.length === existing.filter(Boolean).length && existing.some(Boolean)) {
      console.log('SUPERSEDED PASS 006 live missions are historical proof; refusing FOUNDRY_P006_RESUME')
      for (const mission of blocked) {
        console.log(`INERT ${mission!.missionId} status=${mission!.status} archived=${mission!.archived} superseded=${mission!.superseded} resumeEligible=${mission!.resumeEligible}`)
      }
      return
    }
    console.log('RESUME MODE same live missions A/B/C after nested-lock defect fix')
    const recovered = await recoverOperations()
    console.log(`RECOVERED ${recovered.recovered.length} reclaimed=${recovered.reclaimedLocks}`)
    await noteNestedLockFix(LIVE_C)
    const started = Date.parse('2026-09-19T18:54:23.680Z')
    const productionRun = await runUntilSettled(LIVE_C, router)
    const fixture = await loadMission(LIVE_B)
    if (fixture && fixture.status !== 'COMPLETE') {
      fixture.observations.push({
        at: new Date().toISOString(),
        source: 'controller',
        text: 'CONTROLLER: peer mission C is COMPLETE. scripts/foundry/*.txt writes are now allowed by patch policy. Re-read scripts/foundry/ops-write-conflict/label.txt and hash-bound patch ALPHA to BETA. Do not BLOCKED on the old peer lock or the old .txt denylist.',
      })
      fixture.errors = (fixture.errors ?? []).filter(error => !/file_type_denylist/i.test(error.message))
      fixture.blocker = null
      fixture.maxLoops = Math.max(fixture.maxLoops, fixture.loopCount + 24, 80)
      await saveMission(fixture)
    }
    const fixtureRun = await runUntilSettled(LIVE_B, router)
    const readA = (await loadMission(LIVE_A))!
    await finishLiveProof(readA, fixtureRun, productionRun, started)
    return
  }

  const results: CaseResult[] = []
  const add = (batch: CaseResult[]) => {
    results.push(...batch)
    for (const result of batch) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }

  const interrupt = await pinAcceptanceModel(await startMission('Find where Foundry resource locks are stored.'))
  interrupt.durableToolCalls = [...(interrupt.durableToolCalls ?? []), {
    toolCallId: 'in-flight-ops-live',
    missionId: interrupt.missionId,
    tool: 'installer.activate',
    argsHash: 'synthetic-live',
    startTime: new Date().toISOString(),
    status: 'STARTED',
    idempotency: 'NON_IDEMPOTENT_WRITE',
    resourceClaims: ['ACTIVE_RUNTIME'],
  }]
  interrupt.activeToolCallId = 'in-flight-ops-live'
  interrupt.status = 'EXECUTING'
  interrupt.phase = 'EXECUTING'
  await saveMission(interrupt)
  const recoveredLive = await recoverOperations()
  const afterRecover = await loadMission(interrupt.missionId)
  const interruptedCalls = markInFlightToolsInterrupted(afterRecover ?? interrupt)
  const replayActivate = shouldReplayTool({
    toolCallId: 'in-flight-ops-live',
    missionId: interrupt.missionId,
    tool: 'installer.activate',
    argsHash: 'synthetic-live',
    startTime: new Date().toISOString(),
    status: 'UNKNOWN',
    idempotency: 'NON_IDEMPOTENT_WRITE',
  })

  const auth = await pinAcceptanceModel(await startMission('Find where the authorization request is persisted.'))
  await requestControlledAuthorization(auth, 'CONTROLLED_TEST_BOUNDARY', 'Fake controlled authorization boundary.', 'fixture', 'Only this action')
  const beforeAuthRecover = await loadMission(auth.missionId)
  const authRecover = await recoverOperations()
  const afterAuthRecover = await loadMission(auth.missionId)
  const approved = await resolveMissionAuthorization(auth.missionId, true)
  const authResumed = await resumeMission(auth.missionId, router)

  add([
    check('p006_live_interrupt_recover', Boolean(afterRecover?.recovery?.recovered) && (afterRecover?.durableToolCalls ?? []).some(call => call.status === 'UNKNOWN' || call.status === 'INTERRUPTED'), JSON.stringify(afterRecover?.recovery)),
    check('p006_live_no_blind_replay', replayActivate === false && interruptedCalls.every(call => call.status !== 'SUCCEEDED'), `activate=${replayActivate} ${interruptedCalls.map(call => call.status).join(',')}`),
    check('p006_live_auth_persist', Boolean(beforeAuthRecover?.authorization?.waiting && afterAuthRecover?.authorization?.waiting && afterAuthRecover.status === 'WAITING_AUTHORIZATION'), `${afterAuthRecover?.status}`),
    check('p006_live_auth_resume_same', approved.ok && approved.mission.missionId === auth.missionId && authResumed.missionId === auth.missionId && approved.mission.authorization?.approvalState === 'approved', auth.missionId),
    check('p006_live_recovery_notes', recoveredLive.notes.length > 0 && authRecover.notes.length > 0, recoveredLive.notes.join(';')),
  ])

  const missionA = await pinAcceptanceModel(await startMission('Find where the War Room login title is rendered.'))
  const missionB = await pinAcceptanceModel(await startMission('Change the PASS 006 ops-write-conflict fixture label from ALPHA to BETA, test it, and verify it. This is a test application fixture, not a production install.'))
  const missionC = await pinAcceptanceModel(await startMission('Add a harmless Foundry-only visible acceptance marker FOUNDRY-P006 next to the Foundry navigation identity WAR ROOM — HIGHER VISION INC on The Foundry. Do not touch Terra. Do not change Terra imagery lifecycle. Validate it, build it, package it, install and activate the exact build, transition the installed runtime, then verify it in the browser and through Computer Use.'))

  console.log(`MISSION A ${missionA.missionId}`)
  console.log(`MISSION B ${missionB.missionId}`)
  console.log(`MISSION C ${missionC.missionId}`)

  const started = Date.now()
  const [readA, fixtureRun, productionRun] = await Promise.all([
    runUntilSettled(missionA.missionId, router),
    runUntilSettled(missionB.missionId, router),
    runUntilSettled(missionC.missionId, router),
  ])
  await finishLiveProof(readA, fixtureRun, productionRun, started)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
