/** RELAUNCH_CURRENT_ONLY — may relaunch the current active install only. */
import { runtimeTransitionToActive, runtimeVerify } from '@/lib/native-builder/runtimeControl'
import { reclaimStaleResources } from '@/lib/native-builder/foundryResourceLocks'
import { archiveConfirmedSystemTestMissions } from '@/lib/native-builder/foundryMissionVisibility'
import { REFUSED_SCRIPT_BYPASS } from '@/lib/native-builder/foundryProductionOwnership'

const archive = await archiveConfirmedSystemTestMissions()
const reclaimed = await reclaimStaleResources()
console.log('ARCHIVE', JSON.stringify({
  counts: archive.counts,
  archived: archive.archived.length,
  preserved: archive.preserved.length,
  releasedClaims: archive.releasedClaims.map(claim => ({ resource: claim.resource, missionId: claim.missionId, pid: claim.pid })),
  leftoverLiveClaims: archive.leftoverLiveClaims.map(claim => ({ resource: claim.resource, missionId: claim.missionId, pid: claim.pid })),
  reclaimedAfter: reclaimed.map(claim => ({ resource: claim.resource, missionId: claim.missionId, pid: claim.pid })),
}, null, 2))

if (process.env.FOUNDRY_COMMANDER_EXPLICIT_ROLLBACK === 'true') {
  console.error(`${REFUSED_SCRIPT_BYPASS}: foundry-relaunch-active.ts is RELAUNCH_CURRENT_ONLY and cannot perform maintenance rollback.`)
  process.exit(1)
}

const before = await runtimeVerify()
const requested = process.env.FOUNDRY_RELAUNCH_INSTALL_ID?.trim()
if (requested && before.activeInstallId && requested !== before.activeInstallId) {
  console.error(`${REFUSED_SCRIPT_BYPASS}: RELAUNCH_CURRENT may only relaunch live current ${before.activeInstallId}, not ${requested}.`)
  process.exit(1)
}
console.log('BEFORE', JSON.stringify({
  ownership: before.ownership,
  activeInstallId: before.activeInstallId,
  runningInstallId: before.runningInstallId,
  identityMatch: before.identityMatch,
  health: before.health,
  detail: before.detail,
}, null, 2))

const transition = await runtimeTransitionToActive({
  commanderConfirmed: true,
  graceMs: 20_000,
  bootTimeoutMs: 120_000,
  activationMode: 'RELAUNCH_CURRENT',
})
if (!transition.ok) {
  console.error('FAIL runtime.transition_to_active', transition)
  process.exit(1)
}

const verify = await runtimeVerify()
const identityMatch =
  verify.identityMatch === true
  && Boolean(verify.activeInstallId)
  && verify.activeInstallId === verify.runningInstallId

console.log('AFTER', JSON.stringify({
  steps: transition.steps,
  MISSION_INSTALL_ID: verify.activeInstallId,
  ACTIVE_INSTALL_ID: verify.activeInstallId,
  RUNNING_INSTALL_ID: verify.runningInstallId,
  identityMatch,
  ownership: verify.ownership,
  health: verify.health,
  corePort: verify.corePort,
  detail: verify.detail,
}, null, 2))

if (!identityMatch || verify.ownership !== 'INSTALLED_RUNTIME') process.exit(1)
