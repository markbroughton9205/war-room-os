import { cancelMission } from '@/lib/native-builder/foundryMissionController'
import { listAllMissions } from '@/lib/native-builder/foundryMissionStore'
import { archiveConfirmedSystemTestMission } from '@/lib/native-builder/foundryMissionVisibility'
import { listResourceClaims, releaseMissionResources } from '@/lib/native-builder/foundryResourceLocks'

const live = await listAllMissions()
let archived = 0
let released = 0
for (const mission of live) {
  const harness = /engineering-depth|ownership path for the Foundry project list|stale-expect|impl-bug|data-foundry-pass|Engineering review status|display FAIL instead of PENDING/i.test(`${mission.title}\n${mission.userRequest}`)
  if (!harness) continue
  if (['WAITING_RESOURCE', 'EXECUTING', 'REPLANNING', 'INSPECTING', 'QUEUED', 'PLANNING'].includes(mission.status)) {
    await cancelMission(mission.missionId).catch(() => undefined)
  }
  await releaseMissionResources(mission.missionId).catch(() => undefined)
  released += 1
  if (!mission.archived) {
    mission.testArtifact = true
    mission.visibility = 'system'
    await archiveConfirmedSystemTestMission(mission)
    archived += 1
  }
}
const leftover = await listResourceClaims()
console.log(JSON.stringify({ archived, released, remainingClaims: leftover.map(claim => ({ resource: claim.resource, missionId: claim.missionId })) }))
