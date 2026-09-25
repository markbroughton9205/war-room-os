import { archiveConfirmedSystemTestMissions } from '@/lib/native-builder/foundryMissionVisibility'

const result = await archiveConfirmedSystemTestMissions()
console.log(JSON.stringify({
  counts: result.counts,
  archived: result.archived.length,
  preserved: result.preserved.length,
  releasedClaims: result.releasedClaims.map(claim => ({ resource: claim.resource, missionId: claim.missionId, pid: claim.pid })),
  leftoverLiveClaims: result.leftoverLiveClaims.map(claim => ({ resource: claim.resource, missionId: claim.missionId, pid: claim.pid })),
  preservedMissions: result.preserved,
}, null, 2))
