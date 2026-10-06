import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import path from 'node:path'
import os from 'node:os'
const tmp=mkdtempSync(path.join(os.tmpdir(),'p8-lint-tooling-'))
process.env.REPO_ROOT=tmp;process.env.WAR_ROOM_LOCAL_DATA_DIR=path.join(tmp,'app-data')
try {
 const {startMissionInput}=await import('./foundryMissionController')
 const {buildEngineeringGateTable}=await import('./foundryEngineeringGateTable')
 const m=startMissionInput('Fix source and run tests. Do not install anything.')
 m.sourceState.changedFiles=['calc.mjs']
 m.plan.push({id:'failed-lint',intent:'LINT',title:'Lint',status:'failed',note:'Command "eslint" not found'})
 const evidence=JSON.stringify(m.plan)
 let table=buildEngineeringGateTable(m)
 assert.deepEqual(table.availableTools,['lint.run'])
 assert.equal(table.nextRequiredAction,'TOOL')
 assert.equal(JSON.stringify(m.plan),evidence,'failed evidence retained')
 m.plan.at(-1)!.note='calc.mjs:1 Parsing error: Unexpected token'
 table=buildEngineeringGateTable(m)
 assert.ok(table.availableTools.includes('file.read'),'genuine syntax failure retains focused read recovery')
 assert.ok(table.availableTools.includes('file.replace_unique'))
 console.log('PASS missing eslint requires lint rerun without source edit; syntax errors retain focused repair; prior failed evidence retained')
}finally{rmSync(tmp,{recursive:true,force:true})}
