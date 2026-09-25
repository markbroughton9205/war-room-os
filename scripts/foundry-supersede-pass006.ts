/** HISTORICAL_PROOF_NO_ACTIVATE — installer.activate of pass006 must refuse. */
import { supersedeHistoricalProofMissions } from '@/lib/native-builder/foundryMissionVisibility'
import { STALE_PASS006_MISSION_IDS, readProductionOwner } from '@/lib/native-builder/foundryProductionOwnership'
import { recoverOperations, scheduleReady } from '@/lib/native-builder/foundryOperationsManager'
import { loadRegistry } from '@/lib/native-builder/foundryMissionRegistry'
import { listResourceClaims, reclaimStaleResources } from '@/lib/native-builder/foundryResourceLocks'
import { installerActiveStatus } from '@/lib/native-builder/installerTool'
import { resumeMission } from '@/lib/native-builder/foundryMissionController'
import { installerActivate } from '@/lib/native-builder/installerTool'
import { readFile } from 'node:fs/promises'

const CURRENT_PRODUCTION = 'war-room-os-0.1.0-10a3d34-foundry-local-model-20260919t2245'

const superseded = await supersedeHistoricalProofMissions(
  STALE_PASS006_MISSION_IDS,
  'Commander: stale PASS 006 resume jobs (ALPHA→BETA / write-isolation restart / SOURCE_DONE stall) are historical proof. Keep foundry-local-model-20260919t2245 as current production. Do not restore pass006-e650f093.',
)

const reclaimed = await reclaimStaleResources()
const claims = await listResourceClaims()
const staleClaims = claims.filter(claim => (STALE_PASS006_MISSION_IDS as readonly string[]).includes(claim.missionId))
for (const id of STALE_PASS006_MISSION_IDS) {
  const resumed = await resumeMission(id)
  console.log('RESUME_REFUSED', JSON.stringify({
    missionId: id,
    status: resumed.status,
    archived: resumed.archived,
    superseded: resumed.superseded,
    resumeEligible: resumed.resumeEligible,
  }))
}

const p006Activate = await installerActivate({
  installId: 'war-room-os-0.1.0-10a3d34-pass006-e650f093',
  commanderConfirmed: true,
})
console.log('P006_ACTIVATE_REFUSED', JSON.stringify(p006Activate))

const owner = await readProductionOwner()
const recovered = await recoverOperations()
const recoveredStale = recovered.recovered.filter(entry => (STALE_PASS006_MISSION_IDS as readonly string[]).includes(entry.missionId))
const ready = scheduleReady(await loadRegistry())
const scheduledStale = ready.filter(entry => (STALE_PASS006_MISSION_IDS as readonly string[]).includes(entry.missionId))
const active = await installerActiveStatus()
const label = await readFile('scripts/foundry/ops-write-conflict/label.txt', 'utf8')

console.log('SUPERSEDED', JSON.stringify(superseded, null, 2))
console.log('RECLAIMED', JSON.stringify(reclaimed.map(item => ({ resource: item.resource, missionId: item.missionId, pid: item.pid }))))
console.log('LIVE_CLAIMS', JSON.stringify(claims.map(item => ({ resource: item.resource, missionId: item.missionId, pid: item.pid }))))
console.log('STALE_LIVE_CLAIMS', JSON.stringify(staleClaims))
console.log('OWNER', JSON.stringify(owner))
console.log('RECOVERY_STALE', recoveredStale.length, 'scheduled_stale', scheduledStale.length)
console.log('ACTIVE', JSON.stringify({
  activeInstallId: active.activeInstallId,
  valid: active.valid,
}))
console.log('LABEL', label.trim())
