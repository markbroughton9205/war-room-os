import assert from 'node:assert/strict'
import { parseLaunchModelPolicy, standaloneRepairBinding, localOnlyRouting, FoundryLaunchPolicyError, isLoopbackModelEndpoint } from './foundryLaunchPolicy'
import { FoundryModelRouter } from './foundryModelRouter'
import { requestOllamaStreamingCompletion } from './ollamaClient'
import type { FoundryMissionModel, FoundryModelResponse } from './foundryModelTypes'
const savedBase=process.env.OLLAMA_BASE_URL
const savedFetch=globalThis.fetch
let httpCalls=0
globalThis.fetch=async()=>{httpCalls++;throw Error('Unexpected model HTTP call')}
try {
 process.env.OLLAMA_BASE_URL='http://127.0.0.1:11434'
 assert.equal(parseLaunchModelPolicy(undefined),undefined)
 assert.equal(parseLaunchModelPolicy('AUTO'),undefined)
 assert.equal(parseLaunchModelPolicy('LOCAL_ONLY'),'LOCAL_ONLY')
 for(const bad of ['REMOTE','',{},2])assert.throws(()=>parseLaunchModelPolicy(bad),FoundryLaunchPolicyError)
 assert.deepEqual(standaloneRepairBinding('workspace-a',false),{workspaceId:'workspace-a',continueProjectId:undefined})
 assert.deepEqual(standaloneRepairBinding('workspace-a',true),{workspaceId:'workspace-a',continueProjectId:'workspace-a'})
 for(const endpoint of ['http://localhost:11434','http://127.0.0.1:11434','http://[::1]:11434'])assert.equal(isLoopbackModelEndpoint(endpoint),true)
 for(const endpoint of ['http://192.168.1.4:11434','https://example.com','http://user:secret@localhost:11434','file:///tmp/model','http://127.0.0.1.evil.com','http://localhost.evil.com','http://0.0.0.0'])assert.equal(isLoopbackModelEndpoint(endpoint),false)
 let remoteCalls=0,localCalls=0
 const model=(provider:'ollama'|'cursor-agent',ok:boolean):FoundryMissionModel=>{
  const call=async():Promise<FoundryModelResponse>=>{
   if(provider==='ollama')localCalls++;else remoteCalls++
   const modelName=provider==='ollama'?'local-test':'cloud-test'
   if(!ok)return {ok:false,provider,model:modelName,error:'offline',failureClass:'UNAVAILABLE',latencyMs:1}
   return {ok:true,provider,model:modelName,decision:{decision:'COMPLETE',reasoningSummary:'Stub only'},rawText:'{}',latencyMs:1}
  }
  return {provider,model:provider==='ollama'?'local-test':'cloud-test',reasonMission:call,chooseNextAction:call,diagnoseFailure:call,replan:call,summarizeProgress:call}
 }
 const context={kind:'chooseNextAction' as const,context:{} as never}
 const options=localOnlyRouting('LOCAL_ONLY','cursor-agent',{provider:'ollama',modelId:'local-test'})
 const router=new FoundryModelRouter([model('cursor-agent',true),model('ollama',false)])
 const failure=await router.route('chooseNextAction',context,{...options,policy:'REMOTE',primaryUsageLimited:false})
 assert.equal(failure.response.ok,false);assert.equal(remoteCalls,0);assert.equal(localCalls,1)
 const missing=await new FoundryModelRouter([model('cursor-agent',true)]).route('chooseNextAction',context,options)
 assert.equal(missing.response.ok,false);assert.equal(remoteCalls,0)
 const success=await new FoundryModelRouter([model('cursor-agent',true),model('ollama',true)]).route('chooseNextAction',context,options)
 assert.equal(success.selectedProvider,'ollama');assert.equal(remoteCalls,0);assert.equal(localCalls,2)
 const requestOnly=await new FoundryModelRouter([model('cursor-agent',true),model('ollama',true)]).route('chooseNextAction',{...context,requireLoopback:true},{policy:'REMOTE'})
 assert.equal(requestOnly.selectedProvider,'ollama');assert.equal(remoteCalls,0);assert.equal(localCalls,3)
 process.env.OLLAMA_BASE_URL='http://192.168.1.4:11434'
 const refused=await router.route('chooseNextAction',context,options)
 assert.equal(refused.response.ok,false);assert.equal(refused.attempts.length,0);assert.equal(localCalls,3);assert.equal(remoteCalls,0)
 const direct=await requestOllamaStreamingCompletion({model:'local-test',prompt:'stub',requireLoopback:true})
 assert.equal(direct.ok,false);assert.equal(httpCalls,0)
 process.env.OLLAMA_BASE_URL='http://127.0.0.1:11434'
 globalThis.fetch=async(_input,init)=>{assert.equal(init?.redirect,'error');httpCalls++;process.env.OLLAMA_BASE_URL='http://192.168.1.4:11434';return new Response('unsupported think',{status:400})}
 const compatibility=await requestOllamaStreamingCompletion({model:'local-test',prompt:'stub',requireLoopback:true})
 assert.equal(compatibility.ok,false);assert.equal(httpCalls,1)
 console.log('PASS: policy parsing, repair workspace binding, offline/missing local zero-cloud fallback; off-box endpoint refused at router, direct generation and compatibility retry boundaries. No real network/model calls.')
}finally{
 globalThis.fetch=savedFetch
 if(savedBase===undefined)delete process.env.OLLAMA_BASE_URL;else process.env.OLLAMA_BASE_URL=savedBase
}
