import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  HISTORICAL_PROOF_INSTALL_IDS,
  REFUSED_HISTORICAL_INSTALL,
  REFUSED_MAINTENANCE_REQUIRED,
  REFUSED_SCRIPT_BYPASS,
  REFUSED_STALE_PRODUCTION_OWNER,
  STALE_PASS006_MISSION_IDS,
  authorizeProductionActivation,
  isHistoricalProofInstall,
  productionActivationFromEnv,
  recordProductionOwner,
} from './foundryProductionOwnership'
import { isResumeEligible } from './foundryMissionVisibility'
import { startMissionInput } from './foundryMissionController'
import type { FoundryMissionRecord } from './foundryMissionTypes'
import type { FoundryProductionOwner } from './foundryProductionOwnership'
import { runFoundryProductionLeaseValidation } from './foundryProductionLease.validation'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function liveMission(status: FoundryMissionRecord['status'], installId: string, extras: Partial<FoundryMissionRecord> = {}): FoundryMissionRecord {
  const mission = startMissionInput('PASS 009 production ownership fixture. Harmless authorization proof.')
  mission.status = status
  mission.kind = 'application'
  mission.installState = { ok: true, installId, detail: 'fixture' }
  mission.runtimeClaims = ['ACTIVE_RUNTIME']
  mission.resumeEligible = true
  mission.archived = false
  mission.superseded = false
  mission.testArtifact = false
  return { ...mission, ...extras }
}

function owner(partial: Partial<FoundryProductionOwner> & { installId: string }): FoundryProductionOwner {
  return {
    ownerMissionId: partial.ownerMissionId ?? 'mission-b',
    ownerClass: partial.ownerClass ?? 'COMMANDER_REAL',
    activatedAt: partial.activatedAt ?? new Date().toISOString(),
    productionGeneration: partial.productionGeneration ?? 2,
    productionOwnerMissionId: partial.productionOwnerMissionId ?? partial.ownerMissionId ?? 'mission-b',
    activeInstallId: partial.activeInstallId ?? partial.installId,
    ...partial,
    installId: partial.installId,
  }
}

async function run() {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'wr-pass009-owner-'))
  const ownerFile = path.join(fixtureRoot, 'production-owner.json')
  try {
    const missionA = liveMission('INSTALLING', 'install-a-old', { missionId: 'mission-a' })
    const missionB = liveMission('INSTALLING', 'install-b-new', { missionId: 'mission-b' })
    const ownerB = owner({
      installId: 'install-b-new',
      ownerMissionId: missionB.missionId,
      productionOwnerMissionId: missionB.missionId,
      productionGeneration: 4,
    })
    await mkdir(path.dirname(ownerFile), { recursive: true })
    await writeFile(ownerFile, JSON.stringify(ownerB, null, 2), 'utf8')

    const historical = await authorizeProductionActivation({
      installId: HISTORICAL_PROOF_INSTALL_IDS[0],
      commanderConfirmed: true,
      ownerOverride: ownerB,
      currentActiveInstallIdOverride: ownerB.installId,
      skipLiveMachine: true,
    })
    const noConfirm = await authorizeProductionActivation({
      installId: 'install-b-new',
      commanderConfirmed: false,
      ownerOverride: ownerB,
      skipLiveMachine: true,
    })
    const scriptBypass = await authorizeProductionActivation({
      installId: 'install-a-old',
      commanderConfirmed: true,
      ownerOverride: ownerB,
      currentActiveInstallIdOverride: ownerB.installId,
      skipLiveMachine: true,
    })
    const stale = await authorizeProductionActivation({
      installId: 'install-a-old',
      commanderConfirmed: true,
      missionId: missionA.missionId,
      missionOverride: missionA,
      ownerOverride: ownerB,
      currentActiveInstallIdOverride: ownerB.installId,
      skipLiveMachine: true,
    })
    const completed = await authorizeProductionActivation({
      installId: 'install-a-old',
      commanderConfirmed: true,
      missionId: missionA.missionId,
      missionOverride: { ...missionA, status: 'COMPLETE' },
      ownerOverride: ownerB,
      currentActiveInstallIdOverride: ownerB.installId,
      skipLiveMachine: true,
    })
    const archived = await authorizeProductionActivation({
      installId: 'install-a-old',
      commanderConfirmed: true,
      missionId: missionA.missionId,
      missionOverride: { ...missionA, archived: true, resumeEligible: false, status: 'INSTALLING' },
      ownerOverride: ownerB,
      currentActiveInstallIdOverride: ownerB.installId,
      skipLiveMachine: true,
    })
    const historicalFlag = await authorizeProductionActivation({
      installId: HISTORICAL_PROOF_INSTALL_IDS[0],
      commanderConfirmed: true,
      allowHistoricalRollback: true,
      ownerOverride: ownerB,
      currentActiveInstallIdOverride: ownerB.installId,
      skipLiveMachine: true,
    })
    process.env.FOUNDRY_ALLOW_MAINTENANCE_FIXTURE = 'true'
    const rollback = await authorizeProductionActivation({
      installId: 'install-a-old',
      commanderConfirmed: true,
      commanderExplicitRollback: true,
      activationMode: 'MAINTENANCE_ROLLBACK',
      ownerOverride: ownerB,
      currentActiveInstallIdOverride: ownerB.installId,
      skipLiveMachine: true,
    })
    delete process.env.FOUNDRY_ALLOW_MAINTENANCE_FIXTURE
    process.env.FOUNDRY_VALIDATION = '1'
    const validationRollback = await authorizeProductionActivation({
      installId: 'install-a-old',
      commanderConfirmed: true,
      commanderExplicitRollback: true,
      activationMode: 'MAINTENANCE_ROLLBACK',
      ownerOverride: ownerB,
      currentActiveInstallIdOverride: ownerB.installId,
      skipLiveMachine: true,
    })
    delete process.env.FOUNDRY_VALIDATION
    const liveB = await authorizeProductionActivation({
      installId: 'install-b-new',
      commanderConfirmed: true,
      missionId: missionB.missionId,
      missionOverride: missionB,
      ownerOverride: ownerB,
      currentActiveInstallIdOverride: ownerB.installId,
      skipLiveMachine: true,
    })
    const relaunch = await authorizeProductionActivation({
      installId: 'install-b-new',
      commanderConfirmed: true,
      activationMode: 'RELAUNCH_CURRENT',
      ownerOverride: ownerB,
      currentActiveInstallIdOverride: ownerB.installId,
      skipLiveMachine: true,
    })
    delete process.env.FOUNDRY_PRODUCTION_MISSION_ID
    delete process.env.FOUNDRY_COMMANDER_EXPLICIT_ROLLBACK
    delete process.env.FOUNDRY_ROLLBACK_INSTALL_ID
    let envBypass = 'not-thrown'
    try {
      productionActivationFromEnv('install-a-old')
    } catch (error) {
      envBypass = error instanceof Error ? error.message : String(error)
    }
    process.env.FOUNDRY_PRODUCTION_MISSION_ID = missionB.missionId
    const envMission = productionActivationFromEnv('install-b-new')
    delete process.env.FOUNDRY_PRODUCTION_MISSION_ID
    process.env.FOUNDRY_COMMANDER_EXPLICIT_ROLLBACK = 'true'
    process.env.FOUNDRY_ROLLBACK_INSTALL_ID = 'install-a-old'
    const envRollback = productionActivationFromEnv('install-a-old')
    delete process.env.FOUNDRY_COMMANDER_EXPLICIT_ROLLBACK
    delete process.env.FOUNDRY_ROLLBACK_INSTALL_ID

    const recorded = await recordProductionOwner({
      installId: 'install-b-new',
      mission: missionB,
      mode: 'MISSION',
      authorized: true,
      ownerPathOverride: ownerFile,
    })

    const staleMission = startMissionInput('Change the PASS 006 ops-write-conflict fixture label from ALPHA to BETA, test it, and verify it.')
    staleMission.archived = true
    staleMission.superseded = true
    staleMission.resumeEligible = false
    staleMission.testArtifact = true
    staleMission.visibility = 'system'

    const leaseCases = await runFoundryProductionLeaseValidation()
    const results = [
      check('stale_ids_three', STALE_PASS006_MISSION_IDS.length === 3, STALE_PASS006_MISSION_IDS.join(',')),
      check('historical_p006', isHistoricalProofInstall('war-room-os-0.1.0-10a3d34-pass006-e650f093'), 'e650f093'),
      check('refuse_historical_without_rollback', historical.ok === false && /historical/i.test(historical.ok === false ? historical.error : ''), JSON.stringify(historical)),
      check('refuse_unconfirmed', noConfirm.ok === false, JSON.stringify(noConfirm)),
      check('script_bypass_without_mission', scriptBypass.ok === false && scriptBypass.code === REFUSED_SCRIPT_BYPASS, JSON.stringify(scriptBypass)),
      check('stale_generation_refused', stale.ok === false && stale.code === REFUSED_STALE_PRODUCTION_OWNER, JSON.stringify(stale)),
      check('completed_mission_refused', completed.ok === false && completed.code === REFUSED_STALE_PRODUCTION_OWNER, JSON.stringify(completed)),
      check('archived_mission_refused', archived.ok === false, JSON.stringify(archived)),
      check('allow_historical_flag_insufficient', historicalFlag.ok === false && (historicalFlag.code === REFUSED_HISTORICAL_INSTALL || historicalFlag.code === REFUSED_MAINTENANCE_REQUIRED), JSON.stringify(historicalFlag)),
      check('explicit_rollback_allowed', rollback.ok === true && rollback.mode === 'MAINTENANCE_ROLLBACK', JSON.stringify(rollback)),
      check('validation_cannot_use_maintenance', validationRollback.ok === false && validationRollback.code === REFUSED_MAINTENANCE_REQUIRED, JSON.stringify(validationRollback)),
      check('live_owner_mission_allowed', liveB.ok === true && liveB.mode === 'MISSION', JSON.stringify(liveB)),
      check('relaunch_current_allowed', relaunch.ok === true && relaunch.mode === 'RELAUNCH_CURRENT', JSON.stringify(relaunch)),
      check('env_script_bypass', /REFUSED_SCRIPT_BYPASS/.test(envBypass), envBypass),
      check('env_mission_routes_authority', envMission.missionId === missionB.missionId && envMission.activationMode === 'MISSION', JSON.stringify(envMission)),
      check('env_explicit_rollback', envRollback.commanderExplicitRollback === true && envRollback.activationMode === 'MAINTENANCE_ROLLBACK', JSON.stringify(envRollback)),
      check('generation_monotonic', recorded.productionGeneration === 5, JSON.stringify(recorded)),
      check('stale_not_resume_eligible', isResumeEligible(staleMission) === false, `resumeEligible=${staleMission.resumeEligible}`),
      ...leaseCases,
    ]
    for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
    const failed = results.filter(result => !result.pass)
    console.log(`Foundry production ownership: ${results.length - failed.length}/${results.length} PASS`)
    if (failed.length) process.exit(1)
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryProductionOwnershipValidation }
