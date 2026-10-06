import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const temp=await mkdtemp(path.join(os.tmpdir(),'p8-command-checkpoint-'))
process.env.WAR_ROOM_LOCAL_DATA_DIR=path.join(temp,'app-data')
process.env.REPO_ROOT=path.join(temp,'repo')
const {startMissionInput}=await import('./foundryMissionController')
const {saveMission,loadMission}=await import('./foundryMissionStore')
try {
 for(const command of ['pause','resume','cancel'] as const){
  const m=startMissionInput('Fix implementation. Do not install anything.');m.status=command==='resume'?'PAUSED':'EXECUTING';await saveMission(m)
  const staleCommand=structuredClone(m)
  const executor=structuredClone(m);executor.sourceState.changedFiles=['implementation.mjs'];executor.testState={ok:true,detail:'actual owner test passed'};executor.toolCalls.push({at:new Date().toISOString(),tool:'file.replace_unique',ok:true,reason:'real in-flight write'});assert.ok(executor.modelState);executor.modelState.calls=4;await saveMission(executor)
  staleCommand.pauseRequested=command==='pause';staleCommand.cancelRequested=command==='cancel';await saveMission(staleCommand,command)
  const stored=(await loadMission(m.missionId))!
  assert.deepEqual(stored.sourceState.changedFiles,['implementation.mjs'],`${command} must not erase source evidence published after its initial read`)
  assert.equal(stored.testState.detail,'actual owner test passed',`${command} must preserve newer validation`)
  assert.ok(stored.toolCalls.some(c=>c.tool==='file.replace_unique'),`${command} must preserve newer tool history`)
  assert.equal(stored.modelState?.calls,4);assert.equal(stored.pauseRequested,command==='pause');assert.equal(stored.cancelRequested,command==='cancel')
 }
 console.log('PASS stale Pause/Resume/Cancel snapshots preserve newer source, test, tool and usage evidence')
} finally {await rm(temp,{recursive:true,force:true})}
