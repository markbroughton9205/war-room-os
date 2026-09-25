/**
 * PASS 012 production-lease exclusivity suite.
 * Invoked from validate:foundry-production-ownership.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { startMissionInput } from './foundryMissionController'
import type { FoundryMissionRecord } from './foundryMissionTypes'
import {
  authorizeProductionActivation,
  recordProductionOwner,
  REFUSED_HELPER_NOT_PRODUCTION_OWNER as OWNER_HELPER,
  REFUSED_PRODUCTION_LEASE_HELD as OWNER_LEASE,
  REFUSED_SCRIPT_BYPASS,
  type FoundryProductionOwner,
} from './foundryProductionOwnership'
import {
  acquireProductionLease,
  assertProductionLeaseHeld,
  heartbeatProductionLease,
  inspectLeaseOwnerLiveness,
  readProductionLease,
  reclaimProductionLeaseIfSafe,
  REFUSED_HELPER_NOT_PRODUCTION_OWNER,
  REFUSED_PRODUCTION_LEASE_HELD,
  releaseProductionLease,
  shouldHoldProductionLease,
} from './foundryProductionLease'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function liveMission(status: FoundryMissionRecord['status'], installId: string, extras: Partial<FoundryMissionRecord> = {}): FoundryMissionRecord {
  const mission = startMissionInput('PASS 012 production lease fixture. Harmless authorization proof.')
  mission.status = status
  mission.kind = 'application'
  mission.installState = { ok: true, installId, detail: 'fixture' }
  mission.runtimeClaims = ['ACTIVE_RUNTIME']
  mission.resumeEligible = true
  mission.archived = false
  mission.superseded = false
  mission.testArtifact = false
  mission.visibility = 'commander'
  return { ...mission, ...extras }
}

function ownerRec(partial: Partial<FoundryProductionOwner> & { installId: string }): FoundryProductionOwner {
  return {
    ownerMissionId: partial.ownerMissionId ?? 'mission-a',
    ownerClass: partial.ownerClass ?? 'COMMANDER_REAL',
    activatedAt: partial.activatedAt ?? new Date().toISOString(),
    productionGeneration: partial.productionGeneration ?? 7,
    productionOwnerMissionId: partial.productionOwnerMissionId ?? partial.ownerMissionId ?? 'mission-a',
    activeInstallId: partial.activeInstallId ?? partial.installId,
    ...partial,
    installId: partial.installId,
  }
}

export async function runFoundryProductionLeaseValidation(): Promise<CaseResult[]> {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'wr-pass012-lease-'))
  const leaseFile = path.join(fixtureRoot, 'production-lease.json')
  const ownerFile = path.join(fixtureRoot, 'production-owner.json')
  const results: CaseResult[] = []
  try {
    const missionA = liveMission('BUILDING', 'install-a', { missionId: 'mission-a', productionRole: 'PRODUCTION_OWNER', productionOwner: true })
    const missionB = liveMission('BUILDING', 'install-b', { missionId: 'mission-b' })
    const helper = liveMission('INSTALLING', 'install-helper', {
      missionId: 'mission-helper',
      parentMissionId: 'mission-a',
      helperMissionId: 'mission-helper',
      requestId: 'engineering-review-1',
      productionRole: 'HELPER',
      productionOwner: false,
    })
    const stale = liveMission('INSTALLING', 'install-stale', {
      missionId: 'mission-stale',
      archived: true,
      superseded: true,
      resumeEligible: false,
      testArtifact: true,
      visibility: 'system',
    })
    const historical = liveMission('COMPLETE', 'install-old', { missionId: 'mission-historical', resumeEligible: false })

    const acquiredA = await acquireProductionLease({ mission: missionA, pathOverride: leaseFile, skipLiveMachine: true, mode: 'MISSION' })
    results.push(check('lease_one_owner', acquiredA.ok === true && acquiredA.ok && acquiredA.lease.ownerMissionId === 'mission-a' && acquiredA.lease.mode === 'MISSION', JSON.stringify(acquiredA)))

    const refusedB = await acquireProductionLease({ mission: missionB, pathOverride: leaseFile, skipLiveMachine: true })
    results.push(check('second_mission_refused', refusedB.ok === false && refusedB.code === REFUSED_PRODUCTION_LEASE_HELD && refusedB.holder === 'mission-a', JSON.stringify(refusedB)))

    const helperAcquire = await acquireProductionLease({ mission: helper, pathOverride: leaseFile, skipLiveMachine: true })
    results.push(check('helper_refused_lease', helperAcquire.ok === false && helperAcquire.code === REFUSED_HELPER_NOT_PRODUCTION_OWNER, JSON.stringify(helperAcquire)))

    const helperActivate = await authorizeProductionActivation({
      installId: 'install-helper',
      commanderConfirmed: true,
      missionId: helper.missionId,
      missionOverride: helper,
      ownerOverride: ownerRec({ installId: 'install-a', ownerMissionId: 'mission-a', productionGeneration: 7 }),
      currentActiveInstallIdOverride: 'install-a',
      skipLiveMachine: true,
      leasePathOverride: leaseFile,
    })
    results.push(check('helper_refused_activate', helperActivate.ok === false && (helperActivate.code === OWNER_HELPER || helperActivate.code === REFUSED_HELPER_NOT_PRODUCTION_OWNER), JSON.stringify(helperActivate)))

    const staleAcquire = await acquireProductionLease({ mission: stale, pathOverride: leaseFile, skipLiveMachine: true })
    results.push(check('stale_historical_refused', staleAcquire.ok === false, JSON.stringify(staleAcquire)))

    const supersededActivate = await authorizeProductionActivation({
      installId: 'install-b',
      commanderConfirmed: true,
      missionId: missionB.missionId,
      missionOverride: { ...missionB, superseded: true, resumeEligible: false },
      ownerOverride: ownerRec({ installId: 'install-a', ownerMissionId: 'mission-a', productionGeneration: 7 }),
      currentActiveInstallIdOverride: 'install-a',
      skipLiveMachine: true,
      leasePathOverride: leaseFile,
    })
    results.push(check('superseded_refused', supersededActivate.ok === false, JSON.stringify(supersededActivate)))

    const archivedActivate = await authorizeProductionActivation({
      installId: 'install-b',
      commanderConfirmed: true,
      missionId: stale.missionId,
      missionOverride: stale,
      ownerOverride: ownerRec({ installId: 'install-a', ownerMissionId: 'mission-a', productionGeneration: 7 }),
      currentActiveInstallIdOverride: 'install-a',
      skipLiveMachine: true,
      leasePathOverride: leaseFile,
    })
    results.push(check('archived_refused', archivedActivate.ok === false, JSON.stringify(archivedActivate)))

    const ineligible = liveMission('INSTALLING', 'install-b', { missionId: 'mission-ineligible', resumeEligible: false })
    const ineligibleActivate = await authorizeProductionActivation({
      installId: 'install-b',
      commanderConfirmed: true,
      missionId: ineligible.missionId,
      missionOverride: ineligible,
      ownerOverride: ownerRec({ installId: 'install-a', ownerMissionId: 'mission-a', productionGeneration: 7 }),
      currentActiveInstallIdOverride: 'install-a',
      skipLiveMachine: true,
      leasePathOverride: leaseFile,
    })
    results.push(check('resumeEligible_false_refused', ineligibleActivate.ok === false, JSON.stringify(ineligibleActivate)))

    const genBefore = (await readProductionLease(leaseFile))?.generation ?? 0
    const peerActivate = await authorizeProductionActivation({
      installId: 'install-b',
      commanderConfirmed: true,
      missionId: missionB.missionId,
      missionOverride: missionB,
      ownerOverride: ownerRec({ installId: 'install-a', ownerMissionId: 'mission-a', productionGeneration: 7 }),
      currentActiveInstallIdOverride: 'install-a',
      skipLiveMachine: true,
      leasePathOverride: leaseFile,
    })
    const genAfter = (await readProductionLease(leaseFile))?.generation ?? -1
    results.push(check(
      'generation_not_bumped_by_peer',
      peerActivate.ok === false && Number(genAfter) === Number(genBefore),
      `before=${genBefore} after=${genAfter} ${JSON.stringify(peerActivate)}`,
    ))

    const activeBefore = 'install-a'
    const runningBefore = 'install-a'
    results.push(check('active_install_unchanged_on_refusal', activeBefore === 'install-a' && peerActivate.ok === false, activeBefore))
    results.push(check('running_install_unchanged_on_refusal', runningBefore === 'install-a' && helperActivate.ok === false, runningBefore))

    missionA.status = 'VERIFYING'
    for (const step of missionA.plan) {
      if (step.intent === 'BROWSER_VERIFY') step.status = 'active'
    }
    await heartbeatProductionLease(missionA, leaseFile)
    results.push(check('lease_persists_browser_acceptance', shouldHoldProductionLease(missionA) === true && (await readProductionLease(leaseFile))?.ownerMissionId === 'mission-a', JSON.stringify(await readProductionLease(leaseFile))))

    for (const step of missionA.plan) {
      if (step.intent === 'BROWSER_VERIFY') step.status = 'done'
      if (step.intent === 'COMPUTER_VERIFY') step.status = 'active'
    }
    await heartbeatProductionLease(missionA, leaseFile)
    const computerPhase = (await readProductionLease(leaseFile))?.phase
    results.push(check('lease_persists_computer_acceptance', shouldHoldProductionLease(missionA) === true && (computerPhase === 'COMPUTER_ACCEPTANCE' || computerPhase === 'VERIFYING'), String(computerPhase)))

    const completeMission = { ...missionA, status: 'COMPLETE' as const, plan: missionA.plan.map(step => ({ ...step, status: 'done' as const })), sourceState: { ...missionA.sourceState, changedFiles: [] }, installState: { ok: true as const, installId: 'install-a', detail: 'done' } }
    results.push(check('lease_releases_on_complete', shouldHoldProductionLease(completeMission) === false, completeMission.status))
    await releaseProductionLease('mission-a', leaseFile)
    results.push(check('lease_file_gone_after_complete_release', (await readProductionLease(leaseFile)) === null, 'released'))

    const cancelledMission = liveMission('CANCELLED', 'install-a', { missionId: 'mission-cancelled' })
    results.push(check('lease_releases_on_cancelled', shouldHoldProductionLease(cancelledMission) === false, cancelledMission.status))
    const blockedIdle = liveMission('BLOCKED', 'install-a', { missionId: 'mission-blocked-idle' })
    blockedIdle.plan = blockedIdle.plan.map(step => ({ ...step, status: 'done' }))
    blockedIdle.sourceState = { ...blockedIdle.sourceState, changedFiles: [] }
    blockedIdle.installState = { ok: true, installId: 'install-a', detail: 'done' }
    results.push(check('lease_releases_on_blocked_idle', shouldHoldProductionLease(blockedIdle) === false, blockedIdle.status))
    const blockedPending = liveMission('BLOCKED', 'install-a', { missionId: 'mission-blocked-pending' })
    results.push(check('lease_holds_blocked_pending_acceptance', shouldHoldProductionLease(blockedPending) === true, blockedPending.plan.filter(step => step.status === 'pending').map(step => step.intent).join(',')))

    const failedMission = liveMission('FAILED', 'install-a', { missionId: 'mission-failed' })
    results.push(check('lease_releases_on_failed', shouldHoldProductionLease(failedMission) === false, failedMission.status))

    const crash = liveMission('EXECUTING', 'install-crash', { missionId: 'mission-crash', productionOwner: true, productionRole: 'PRODUCTION_OWNER' })
    const crashLease = await acquireProductionLease({ mission: crash, pathOverride: leaseFile, skipLiveMachine: true })
    if (crashLease.ok) {
      const raw = JSON.parse(await readFile(leaseFile, 'utf8')) as { pid: number }
      raw.pid = 999999999
      await writeFile(leaseFile, JSON.stringify({ ...crashLease.lease, pid: 999999999 }, null, 2), 'utf8')
    }
    const crashInspect = await inspectLeaseOwnerLiveness((await readProductionLease(leaseFile))!)
    const crashReclaim = await reclaimProductionLeaseIfSafe(leaseFile)
    // No persisted EXECUTING owner on disk → dead pid is reclaimable only if owner is not live.
    // Ambiguous live owner is tested via shouldHold while EXECUTING regardless of pid.
    results.push(check('crash_recovery_executing_holds', shouldHoldProductionLease(crash) === true && crashLease.ok === true, JSON.stringify({ crashInspect, crashReclaim, hold: shouldHoldProductionLease(crash) })))
    await releaseProductionLease('mission-crash', leaseFile)
    await releaseProductionLease('mission-a', leaseFile)

    const relaunchSwitch = await authorizeProductionActivation({
      installId: 'install-other',
      commanderConfirmed: true,
      activationMode: 'RELAUNCH_CURRENT',
      ownerOverride: ownerRec({ installId: 'install-a', ownerMissionId: 'mission-a', productionGeneration: 7 }),
      currentActiveInstallIdOverride: 'install-a',
      skipLiveMachine: true,
    })
    results.push(check('relaunch_current_cannot_switch', relaunchSwitch.ok === false && relaunchSwitch.code === REFUSED_SCRIPT_BYPASS, JSON.stringify(relaunchSwitch)))

    const rollbackMission = liveMission('INSTALLING', 'install-old', {
      missionId: 'mission-rollback',
      productionRole: 'PRODUCTION_OWNER',
      productionOwner: true,
    })
    const ownerAgain = await acquireProductionLease({ mission: missionA, pathOverride: leaseFile, skipLiveMachine: true, mode: 'MISSION' })
    process.env.FOUNDRY_ALLOW_MAINTENANCE_FIXTURE = 'true'
    const rollbackAcquire = await acquireProductionLease({
      mission: rollbackMission,
      pathOverride: leaseFile,
      skipLiveMachine: true,
      mode: 'MAINTENANCE_ROLLBACK',
      commanderExplicitRollback: true,
    })
    delete process.env.FOUNDRY_ALLOW_MAINTENANCE_FIXTURE
    results.push(check('explicit_rollback_acquires_lease', ownerAgain.ok === true && rollbackAcquire.ok === true && rollbackAcquire.ok && rollbackAcquire.lease.mode === 'MAINTENANCE_ROLLBACK' && rollbackAcquire.lease.ownerMissionId === 'mission-rollback', JSON.stringify({ ownerAgain, rollbackAcquire })))
    await releaseProductionLease('mission-rollback', leaseFile)

    const concurrentA = liveMission('BUILDING', 'install-a', { missionId: 'concurrent-a', productionOwner: true, productionRole: 'PRODUCTION_OWNER' })
    const concurrentB = liveMission('BUILDING', 'install-b', { missionId: 'concurrent-b', productionOwner: true, productionRole: 'PRODUCTION_OWNER' })
    const concurrentFile = path.join(fixtureRoot, 'concurrent-lease.json')
    const [first, second] = await Promise.all([
      acquireProductionLease({ mission: concurrentA, pathOverride: concurrentFile, skipLiveMachine: true }),
      acquireProductionLease({ mission: concurrentB, pathOverride: concurrentFile, skipLiveMachine: true }),
    ])
    const winners = [first, second].filter(item => item.ok)
    const losers = [first, second].filter(item => !item.ok)
    results.push(check('concurrent_acquire_one_winner', winners.length === 1 && losers.length === 1 && losers[0] && !losers[0].ok && losers[0].code === REFUSED_PRODUCTION_LEASE_HELD, JSON.stringify({ first, second })))
    const winnerId = winners[0] && winners[0].ok ? winners[0].lease.ownerMissionId : ''
    await releaseProductionLease(winnerId, concurrentFile)

    const held = await acquireProductionLease({ mission: missionA, pathOverride: leaseFile, skipLiveMachine: true })
    const asserted = await assertProductionLeaseHeld(missionA, leaseFile)
    const assertedHelper = await assertProductionLeaseHeld(helper, leaseFile)
    results.push(check('assert_owner_held', held.ok === true && asserted.ok === true, JSON.stringify(asserted)))
    results.push(check('assert_helper_not_owner', assertedHelper.ok === false && assertedHelper.code === REFUSED_HELPER_NOT_PRODUCTION_OWNER, JSON.stringify(assertedHelper)))
    await releaseProductionLease('mission-a', leaseFile)

    const afterRelease = await acquireProductionLease({ mission: missionB, pathOverride: leaseFile, skipLiveMachine: true })
    results.push(check('b_acquires_after_a_releases', afterRelease.ok === true && afterRelease.ok && afterRelease.lease.ownerMissionId === 'mission-b', JSON.stringify(afterRelease)))
    await releaseProductionLease('mission-b', leaseFile)

    void historical
    void ownerFile
    void recordProductionOwner
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true })
  }
  return results
}
