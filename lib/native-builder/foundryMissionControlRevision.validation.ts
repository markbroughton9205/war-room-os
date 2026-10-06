import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const temp = await mkdtemp(path.join(os.tmpdir(),'p8-control-revision-'))
process.env.WAR_ROOM_LOCAL_DATA_DIR=path.join(temp,'app-data')
process.env.REPO_ROOT=path.join(temp,'repo')
const { startMissionInput }=await import('./foundryMissionController')
const { saveMission, loadMission }=await import('./foundryMissionStore')
const { pauseMission, resumeMissionRecord }=await import('./foundryOperationsManager')
try {
 const m=startMissionInput('Fix calc.mjs. Do not install anything.');m.status='EXECUTING'
 await saveMission(m)
 const executor=structuredClone(m)
 await pauseMission(m.missionId)
 executor.journal.push({at:new Date().toISOString(),kind:'observation',text:'real in-flight result'})
 executor.sourceState.changedFiles=['calc.mjs']
 await saveMission(executor)
 let stored=(await loadMission(m.missionId))!
 assert.equal(stored.status,'PAUSED');assert.equal(stored.pauseRequested,true)
 assert.ok(stored.journal.some(x=>x.text.includes('Paused:')))
 assert.ok(stored.journal.some(x=>x.text==='real in-flight result'))
 assert.deepEqual(stored.sourceState.changedFiles,['calc.mjs'],'in-flight source evidence survives pause')
 const beforeResume=structuredClone(stored)
 stored=await resumeMissionRecord(m.missionId)
 assert.equal(stored.status,'EXECUTING');assert.equal(stored.pauseRequested,false)
 await saveMission(beforeResume)
 stored=(await loadMission(m.missionId))!
 assert.equal(stored.status,'EXECUTING','late paused writer must not reverse Resume')
 assert.equal(stored.pauseRequested,false,'late paused writer must not undo explicit Resume')
 assert.ok(stored.journal.some(x=>x.text.startsWith('Resume requested')))
 const staleResume=structuredClone(stored)
 stored.cancelRequested=true;await saveMission(stored,'cancel');stored.status='CANCELLED';await saveMission(stored)
 staleResume.status='EXECUTING';await saveMission(staleResume,'resume')
 stored=(await loadMission(m.missionId))!
 assert.equal(stored.status,'CANCELLED');assert.equal(stored.cancelRequested,true)
 assert.equal((await resumeMissionRecord(m.missionId)).status,'CANCELLED','explicit Resume cannot resurrect cancellation')
 const a=await import('./foundryAgentCancellation')
 const independentBundle='./foundryAgentCancellation.ts?independent-bundle'
 const b=await import(independentBundle)
 a.beginFoundryAgentWork(m.missionId);b.abortFoundryAgentWork(m.missionId)
 assert.equal(a.isFoundryAgentAborted(m.missionId),true,'independent bundles share abort control')
 a.releaseFoundryAgentWork(m.missionId)
 const { createServer }=await import('node:http')
 const { requestOllamaCompletion }=await import('./ollamaClient')
 const { requestLocalCoderJson }=await import('./localCoder')
 const aborted=new AbortController();aborted.abort()
 assert.equal((await requestLocalCoderJson({signal:aborted.signal,role:'FOUNDRY_MASTER',system:'test',prompt:'test'})).ok,false,'pre-aborted local calls stop before discovery')
 let reached!:()=>void
 const requestStarted=new Promise<void>(resolve=>{reached=resolve})
 const server=createServer((_req,res)=>{res.writeHead(200,{'content-type':'application/x-ndjson'});res.write('{"response":"partial","done":false}\n');reached()})
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
 const oldUrl=process.env.OLLAMA_BASE_URL
 process.env.OLLAMA_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`
 try {
  const signal=new AbortController()
  const pending=requestOllamaCompletion({model:'fixture',prompt:'test',signal:signal.signal,timeoutMs:5000,requireLoopback:true})
  await requestStarted;signal.abort()
  const result=await pending;assert.equal(result.ok,false,'active local streaming generation must abort')
 } finally {
  if(oldUrl===undefined)delete process.env.OLLAMA_BASE_URL;else process.env.OLLAMA_BASE_URL=oldUrl
  server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))
 }
 console.log('PASS stale executor Pause/Resume/Cancel refusal, command journal retention, in-flight source evidence and cross-bundle abort')
} finally {await rm(temp,{recursive:true,force:true})}
