/**
 * PASS 013 production-lease watchdog + historical activation lockdown suite.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { startMissionInput } from './foundryMissionController'
import type { FoundryMissionRecord, FoundryMissionState } from './foundryMissionTypes'
import type { FoundryProductionLease } from './foundryProductionLease'
import {
  LEASE_RECOVERY_DEFERRED_AMBIGUOUS,
  LEASE_RECOVERY_DEFERRED_LIVE_OWNER,
  LEASE_RECOVERY_DEFERRED_ORPHAN,
  LEASE_RECOVERY_RELEASED,
  LEASE_RECOVERY_SCAN,
  runProductionLeaseWatchdog,
} from './foundryProductionLeaseWatchdog'
import {
  authorizeProductionActivation,
  HISTORICAL_PROOF_INSTALL_IDS,
  isHistoricalProofInstall,
  productionActivationFromEnv,
  readProductionOwner,
  REFUSED_HISTORICAL_INSTALL,
  REFUSED_MAINTENANCE_REQUIRED,
  REFUSED_SCRIPT_BYPASS,
  type FoundryProductionOwner,
} from './foundryProductionOwnership'
import {
  CURRENT_AUTHORIZED_PRODUCTION_INSTALL_ID,
  FOUNDRY_ACTIVATION_SCRIPT_INVENTORY,
  PASS013_HISTORICAL_INSTALL_IDS,
} from './foundryActivationScriptInventory'
import { acquireResource, listResourceClaims, setResourceLockRootForTests } from './foundryResourceLocks'
import { STALE_PASS009_QUEUED_FIXTURE_IDS } from './foundryMissionVisibility'
import { loadMission } from './foundryMissionStore'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

const DEAD_PID = 999_999_001
const CURRENT = CURRENT_AUTHORIZED_PRODUCTION_INSTALL_ID

function mission(status: FoundryMissionState, id: string): FoundryMissionRecord {
  const record = startMissionInput(`PASS 013 ${status} lease-watchdog fixture. Not a production install.`)
  record.missionId = id
  record.status = status
  record.phase = status
  record.kind = 'fixture'
  record.testArtifact = true
  record.visibility = 'system'
  record.resumeEligible = false
  record.productionRole = 'PRODUCTION_OWNER'
  record.productionOwner = true
  return record
}

function ownerRec(): FoundryProductionOwner {
  return {
    installId: CURRENT,
    ownerMissionId: 'ee08ab02-ebb8-41ce-a104-34ef3cb7ee78',
    ownerClass: 'COMMANDER_REAL',
    activatedAt: '2026-09-20T00:00:00.000Z',
    productionGeneration: 10,
    productionOwnerMissionId: 'ee08ab02-ebb8-41ce-a104-34ef3cb7ee78',
    activeInstallId: CURRENT,
  }
}

function leaseFor(ownerMissionId: string, extras: Partial<FoundryProductionLease> = {}): FoundryProductionLease {
  const now = new Date().toISOString()
  return {
    ownerMissionId,
    ownerClass: 'COMMANDER_REAL',
    productionGeneration: 10,
    missionId: ownerMissionId,
    generation: 10,
    targetInstallId: CURRENT,
    installTarget: CURRENT,
    acquiredAt: now,
    updatedAt: now,
    heartbeatAt: now,
    leaseUpdatedAt: now,
    phase: extras.phase ?? 'BUILDING',
    mode: 'MISSION',
    pid: extras.pid ?? DEAD_PID,
    ...extras,
  }
}

async function runWatchdogCases(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'wr-pass013-watchdog-'))
  const leaseFile = path.join(fixtureRoot, 'production-lease.json')
  const ownerFile = path.join(fixtureRoot, 'production-owner.json')
  const lockRoot = path.join(fixtureRoot, 'locks')
  setResourceLockRootForTests(lockRoot)
  const owner = ownerRec()
  await writeFile(ownerFile, JSON.stringify(owner, null, 2), 'utf8')
  const runtime = { activeInstallId: CURRENT, runningInstallId: CURRENT }

  const run = async (
    record: FoundryProductionLease,
    extras: Parameters<typeof runProductionLeaseWatchdog>[0],
  ) => {
    await writeFile(leaseFile, JSON.stringify(record, null, 2), 'utf8')
    return runProductionLeaseWatchdog({
      pathOverride: leaseFile,
      ownerPathOverride: ownerFile,
      skipLiveMachine: true,
      runtimeIdentityOverride: runtime,
      ...extras,
    })
  }

  try {
    const complete = await run(leaseFor('wd-complete', { phase: 'COMPLETE' }), {
      missionOverride: mission('COMPLETE', 'wd-complete'),
      processAliveOverride: false,
      productionProcessesOverride: false,
    })
    results.push(check('watchdog_complete_dead_pid_reclaim', complete.code === LEASE_RECOVERY_RELEASED && complete.released, JSON.stringify(complete)))

    await writeFile(ownerFile, JSON.stringify(owner, null, 2), 'utf8')
    const failed = await run(leaseFor('wd-failed', { phase: 'FAILED' }), {
      missionOverride: mission('FAILED', 'wd-failed'),
      processAliveOverride: false,
      productionProcessesOverride: false,
    })
    results.push(check('watchdog_failed_dead_pid_reclaim', failed.code === LEASE_RECOVERY_RELEASED && failed.released, JSON.stringify(failed)))

    await writeFile(ownerFile, JSON.stringify(owner, null, 2), 'utf8')
    const blocked = await run(leaseFor('wd-blocked', { phase: 'BLOCKED' }), {
      missionOverride: mission('BLOCKED', 'wd-blocked'),
      processAliveOverride: false,
      productionProcessesOverride: false,
    })
    results.push(check('watchdog_blocked_dead_pid_reclaim', blocked.code === LEASE_RECOVERY_RELEASED && blocked.released, JSON.stringify(blocked)))

    await writeFile(ownerFile, JSON.stringify(owner, null, 2), 'utf8')
    const cancelled = await run(leaseFor('wd-cancelled', { phase: 'CANCELLED' }), {
      missionOverride: mission('CANCELLED', 'wd-cancelled'),
      processAliveOverride: false,
      productionProcessesOverride: false,
    })
    results.push(check('watchdog_cancelled_dead_pid_reclaim', cancelled.code === LEASE_RECOVERY_RELEASED && cancelled.released, JSON.stringify(cancelled)))

    await writeFile(ownerFile, JSON.stringify(owner, null, 2), 'utf8')
    const building = await run(leaseFor('wd-building', { phase: 'BUILDING', pid: process.pid }), {
      missionOverride: mission('BUILDING', 'wd-building'),
      processAliveOverride: true,
      productionProcessesOverride: false,
    })
    results.push(check('watchdog_building_live_pid_retain', building.code === LEASE_RECOVERY_DEFERRED_LIVE_OWNER && building.released === false, JSON.stringify(building)))

    const packaging = await run(leaseFor('wd-packaging', { phase: 'PACKAGING', pid: process.pid }), {
      missionOverride: mission('PACKAGING', 'wd-packaging'),
      processAliveOverride: true,
      productionProcessesOverride: false,
    })
    results.push(check('watchdog_packaging_live_pid_retain', packaging.code === LEASE_RECOVERY_DEFERRED_LIVE_OWNER && packaging.released === false, JSON.stringify(packaging)))

    const terminalChild = await run(leaseFor('wd-terminal-child', { phase: 'COMPLETE' }), {
      missionOverride: mission('COMPLETE', 'wd-terminal-child'),
      processAliveOverride: false,
      productionProcessesOverride: true,
    })
    results.push(check('watchdog_terminal_live_child_retain', terminalChild.code === LEASE_RECOVERY_DEFERRED_AMBIGUOUS && terminalChild.released === false, JSON.stringify(terminalChild)))

    const ambiguous = await run(leaseFor('wd-ambiguous', { phase: 'BUILDING' }), {
      missionOverride: mission('BUILDING', 'wd-ambiguous'),
      processAliveOverride: false,
      productionProcessesOverride: true,
    })
    results.push(check('watchdog_nonterminal_dead_pid_ambiguous_defer', ambiguous.code === LEASE_RECOVERY_DEFERRED_AMBIGUOUS && ambiguous.released === false, JSON.stringify(ambiguous)))

    const orphanLive = await run(leaseFor('wd-orphan-live', { pid: process.pid }), {
      missionOverride: null,
      processAliveOverride: true,
      productionProcessesOverride: false,
    })
    results.push(check('watchdog_missing_mission_live_pid_retain', orphanLive.code === LEASE_RECOVERY_DEFERRED_ORPHAN && orphanLive.released === false, JSON.stringify(orphanLive)))

    const orphanSafe = await run(leaseFor('wd-orphan-safe'), {
      missionOverride: null,
      processAliveOverride: false,
      productionProcessesOverride: false,
    })
    results.push(check('watchdog_missing_mission_dead_pid_safe_reclaim', orphanSafe.code === LEASE_RECOVERY_RELEASED && orphanSafe.released, JSON.stringify(orphanSafe)))

    await writeFile(ownerFile, JSON.stringify(owner, null, 2), 'utf8')
    const staleBeat = leaseFor('wd-heartbeat', { phase: 'BUILDING', pid: process.pid, heartbeatAt: new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString() })
    const heartbeat = await run(staleBeat, {
      missionOverride: mission('BUILDING', 'wd-heartbeat'),
      processAliveOverride: true,
      productionProcessesOverride: false,
    })
    results.push(check(
      'watchdog_heartbeat_stale_alone_no_reclaim',
      heartbeat.code === LEASE_RECOVERY_DEFERRED_LIVE_OWNER && heartbeat.released === false && (heartbeat.heartbeatAgeMs ?? 0) > 24 * 60 * 60 * 1000,
      JSON.stringify(heartbeat),
    ))

    await writeFile(leaseFile, JSON.stringify(leaseFor('wd-claims', { phase: 'COMPLETE' }), null, 2), 'utf8')
    const claimMission = 'wd-claims'
    const peerMission = 'wd-peer-live'
    await acquireResource({ resource: 'PRODUCTION_LEASE', missionId: claimMission, operation: 'watchdog', waitMs: 0 })
    await acquireResource({ resource: 'BUILD_PIPELINE', missionId: claimMission, operation: 'watchdog', waitMs: 0 })
    await acquireResource({ resource: 'PACKAGE_PIPELINE', missionId: claimMission, operation: 'watchdog', waitMs: 0 })
    await acquireResource({ resource: 'INSTALL_PIPELINE', missionId: claimMission, operation: 'watchdog', waitMs: 0 })
    await acquireResource({ resource: 'ACTIVE_RUNTIME', missionId: claimMission, operation: 'watchdog', waitMs: 0 })
    const peer = await acquireResource({ resource: 'PROVIDER_SLOT', missionId: peerMission, operation: 'watchdog', waitMs: 0 })
    const reclaimedClaims = await runProductionLeaseWatchdog({
      pathOverride: leaseFile,
      ownerPathOverride: ownerFile,
      skipLiveMachine: true,
      runtimeIdentityOverride: runtime,
      missionOverride: mission('COMPLETE', claimMission),
      processAliveOverride: false,
      productionProcessesOverride: false,
    })
    const leftover = await listResourceClaims()
    results.push(check(
      'watchdog_stale_resource_claims_cleaned',
      reclaimedClaims.released
        && !leftover.some(claim => claim.missionId === claimMission)
        && leftover.some(claim => claim.missionId === peerMission && claim.resource === 'PROVIDER_SLOT')
        && peer.state === 'ACQUIRED',
      JSON.stringify({ released: reclaimedClaims.claimsReleased, leftover: leftover.map(claim => `${claim.resource}:${claim.missionId}`) }),
    ))

    const ownerAfter = JSON.parse(await readFile(ownerFile, 'utf8')) as FoundryProductionOwner
    results.push(check('watchdog_generation_unchanged', ownerAfter.productionGeneration === 10 && reclaimedClaims.generationAfter === 10, JSON.stringify({ before: 10, after: ownerAfter.productionGeneration })))
    results.push(check('watchdog_active_install_unchanged', reclaimedClaims.activeInstallId === CURRENT, String(reclaimedClaims.activeInstallId)))
    results.push(check('watchdog_running_install_unchanged', reclaimedClaims.runningInstallId === CURRENT, String(reclaimedClaims.runningInstallId)))
    results.push(check(
      'watchdog_production_owner_unchanged',
      ownerAfter.productionOwnerMissionId === owner.productionOwnerMissionId
        && ownerAfter.installId === owner.installId
        && ownerAfter.productionGeneration === owner.productionGeneration,
      JSON.stringify(ownerAfter),
    ))
    results.push(check(
      'watchdog_audit_codes_exported',
      [LEASE_RECOVERY_SCAN, LEASE_RECOVERY_RELEASED, LEASE_RECOVERY_DEFERRED_LIVE_OWNER, LEASE_RECOVERY_DEFERRED_AMBIGUOUS, LEASE_RECOVERY_DEFERRED_ORPHAN].every(Boolean),
      'five recovery codes',
    ))
  } finally {
    setResourceLockRootForTests(null)
    await rm(fixtureRoot, { recursive: true, force: true }).catch(() => undefined)
  }
  return results
}

async function runHistoricalCases(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const historicalId = PASS013_HISTORICAL_INSTALL_IDS[0]
  const owner = ownerRec()
  const proofStyle = await authorizeProductionActivation({
    installId: historicalId,
    commanderConfirmed: true,
    skipLiveMachine: true,
  })
  results.push(check(
    'historical_proof_no_activate',
    proofStyle.ok === false && (proofStyle.code === REFUSED_HISTORICAL_INSTALL || proofStyle.code === REFUSED_SCRIPT_BYPASS),
    JSON.stringify(proofStyle),
  ))
  results.push(check(
    'historical_ids_locked',
    PASS013_HISTORICAL_INSTALL_IDS.every(id => isHistoricalProofInstall(id))
      && HISTORICAL_PROOF_INSTALL_IDS.includes('war-room-os-0.1.0-75f49a0-foundry-5d4b64e1'),
    HISTORICAL_PROOF_INSTALL_IDS.join(','),
  ))

  delete process.env.FOUNDRY_PRODUCTION_MISSION_ID
  delete process.env.FOUNDRY_COMMANDER_EXPLICIT_ROLLBACK
  delete process.env.FOUNDRY_ROLLBACK_INSTALL_ID
  let bypass = 'not-thrown'
  try {
    productionActivationFromEnv(historicalId)
  } catch (error) {
    bypass = error instanceof Error ? error.message : String(error)
  }
  results.push(check('script_bypass_fail_closed', /REFUSED_SCRIPT_BYPASS/.test(bypass), bypass))

  const relaunchCurrent = await authorizeProductionActivation({
    installId: CURRENT,
    commanderConfirmed: true,
    activationMode: 'RELAUNCH_CURRENT',
    ownerOverride: owner,
    currentActiveInstallIdOverride: CURRENT,
    skipLiveMachine: true,
  })
  results.push(check('relaunch_current_only_current', relaunchCurrent.ok === true && relaunchCurrent.mode === 'RELAUNCH_CURRENT' && relaunchCurrent.generation === 10, JSON.stringify(relaunchCurrent)))

  const relaunchHistorical = await authorizeProductionActivation({
    installId: historicalId,
    commanderConfirmed: true,
    activationMode: 'RELAUNCH_CURRENT',
    ownerOverride: owner,
    currentActiveInstallIdOverride: CURRENT,
    skipLiveMachine: true,
  })
  results.push(check(
    'relaunch_current_refuses_historical',
    relaunchHistorical.ok === false && (relaunchHistorical.code === REFUSED_HISTORICAL_INSTALL || relaunchHistorical.code === REFUSED_SCRIPT_BYPASS),
    JSON.stringify(relaunchHistorical),
  ))

  process.env.FOUNDRY_ALLOW_MAINTENANCE_FIXTURE = 'true'
  const rollback = await authorizeProductionActivation({
    installId: historicalId,
    commanderConfirmed: true,
    commanderExplicitRollback: true,
    activationMode: 'MAINTENANCE_ROLLBACK',
    ownerOverride: owner,
    currentActiveInstallIdOverride: CURRENT,
    skipLiveMachine: true,
  })
  delete process.env.FOUNDRY_ALLOW_MAINTENANCE_FIXTURE
  results.push(check('maintenance_rollback_auth_only', rollback.ok === true && rollback.mode === 'MAINTENANCE_ROLLBACK', JSON.stringify(rollback)))

  const rollbackWithoutFlag = await authorizeProductionActivation({
    installId: historicalId,
    commanderConfirmed: true,
    activationMode: 'MAINTENANCE_ROLLBACK',
    ownerOverride: owner,
    currentActiveInstallIdOverride: CURRENT,
    skipLiveMachine: true,
  })
  results.push(check(
    'maintenance_rollback_without_flag_refused',
    rollbackWithoutFlag.ok === false && (rollbackWithoutFlag.code === REFUSED_HISTORICAL_INSTALL || rollbackWithoutFlag.code === REFUSED_MAINTENANCE_REQUIRED || rollbackWithoutFlag.code === REFUSED_SCRIPT_BYPASS),
    JSON.stringify(rollbackWithoutFlag),
  ))

  const classified = new Set(FOUNDRY_ACTIVATION_SCRIPT_INVENTORY.map(item => item.classification))
  results.push(check(
    'activation_script_inventory',
    FOUNDRY_ACTIVATION_SCRIPT_INVENTORY.length >= 10
      && classified.has('CURRENT_PRODUCTION_SAFE')
      && classified.has('RELAUNCH_CURRENT_ONLY')
      && classified.has('HISTORICAL_PROOF_NO_ACTIVATE')
      && classified.has('DEPRECATED_ACTIVATION_PATH')
      && FOUNDRY_ACTIVATION_SCRIPT_INVENTORY.some(item => item.path === 'scripts/foundry-relaunch-active.ts' && item.classification === 'RELAUNCH_CURRENT_ONLY'),
    FOUNDRY_ACTIVATION_SCRIPT_INVENTORY.map(item => `${item.path}:${item.classification}`).join(' | '),
  ))
  return results
}

async function runPass009Sanity(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const live = ['QUEUED', 'WAITING_RESOURCE', 'EXECUTING', 'RECOVERING']
  const snapshots = await Promise.all(STALE_PASS009_QUEUED_FIXTURE_IDS.map(async id => {
    const record = await loadMission(id)
    return { id, status: record?.status ?? 'missing', archived: record?.archived === true, resumeEligible: record?.resumeEligible }
  }))
  results.push(check(
    'pass009_fixtures_not_resurrected',
    snapshots.every(item => !live.includes(item.status) && item.resumeEligible !== true),
    JSON.stringify(snapshots),
  ))
  return results
}

export async function runFoundryProductionLeaseWatchdogValidation(): Promise<CaseResult[]> {
  const watchdog = await runWatchdogCases()
  const historical = await runHistoricalCases()
  const pass009 = await runPass009Sanity()
  return [...watchdog, ...historical, ...pass009]
}

async function run(): Promise<void> {
  const results = await runFoundryProductionLeaseWatchdogValidation()
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
  const failed = results.filter(item => !item.pass)
  console.log(`Foundry PASS 013 watchdog: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
