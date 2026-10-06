/**
 * Durable runner for one child (authoring) mission. Started as a background job by the Mission Executive so the child survives a
 * restart of the parent Foundry process. Exit 0 only when the child mission is COMPLETE.
 */
import { resumeMission, runModelMission } from '@/lib/native-builder/foundryMissionController'
import { loadMission } from '@/lib/native-builder/foundryMissionStore'

const missionId = process.argv[2]
if (!missionId) { console.error('missing mission id'); process.exit(2) }
const existing = await loadMission(missionId)
if (!existing) { console.error(`unknown mission ${missionId}`); process.exit(2) }
const done = existing.status === 'QUEUED' ? await runModelMission(missionId) : await resumeMission(missionId)
const final = (await loadMission(missionId)) ?? done
console.log(JSON.stringify({ missionId, status: final.status, changedFiles: final.sourceState.changedFiles, blocker: final.blocker?.blocker ?? null, evidence: (final.blocker?.evidence ?? '').slice(0, 400) }))
process.exit(final.status === 'COMPLETE' ? 0 : 1)
