import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const tmp=mkdtempSync(path.join(os.tmpdir(),'p8-budget-pause-'))
process.env.REPO_ROOT=tmp; process.env.WAR_ROOM_LOCAL_DATA_DIR=path.join(tmp,'app-data'); process.env.FOUNDRY_CONTRACTS_ROOT=path.join(tmp,'contracts'); process.env.FOUNDRY_PROVIDER_POLICY='LOCAL'
try {
 const {startMission,runModelMission}=await import('./foundryMissionController')
 const {FoundryModelRouter}=await import('./foundryModelRouter')
 const {createResourceBudget}=await import('./foundryResourceGovernor')
 const {loadActiveResourceBudget,saveResourceBudget}=await import('./foundryContractStore')
 const mission=await startMission('Fix calc.mjs and run tests. Do not install anything.')
 createResourceBudget({missionId:mission.missionId,limits:{maxModelCalls:1}})
 const spent=loadActiveResourceBudget(mission.missionId)!
 spent.totals.modelCalls=1; saveResourceBudget(spent)
 const limits=JSON.stringify(spent.limits)
 let calls=0
 const invoke=async()=>{calls++;throw Error('Unauthorized provider invocation')}
 const model={provider:'ollama' as const,model:'qualification-no-network',reasonMission:invoke,chooseNextAction:invoke,diagnoseFailure:invoke,replan:invoke,summarizeProgress:invoke}
 const result=await runModelMission(mission.missionId,new FoundryModelRouter([model]))
 assert.equal(calls,0)
 assert.equal(result.status,'PAUSED')
 assert.equal(result.blocker?.blocker,'Resource budget requires Commander action')
 assert.equal(result.modelState?.calls,0)
 assert.equal(result.modelState?.providerFailures,0)
 assert.equal(JSON.stringify(loadActiveResourceBudget(mission.missionId)?.limits),limits)
 assert.equal(result.journal.filter(j=>j.text.includes('Provider retry suppressed')).length,1)
 console.log('PASS real governor/router/controller: exhausted budget pauses once, zero provider invocations/failure increments, unchanged limits')
} finally {rmSync(tmp,{recursive:true,force:true})}
