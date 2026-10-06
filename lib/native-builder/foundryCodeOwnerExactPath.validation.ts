import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { compactOwnershipQuery, rejectIrrelevantTest, rankTests } from './foundryEngineeringContract'
import { extendSelfReviewForMultiFile } from './foundryMultiFileEngineering'
import { validateReplacementText } from './foundryBoundedEdit'
import { buildCodeIndex, mapOwnership } from './foundryCodeIntelligence'
import { runWithWorkspaceRoot } from '@/lib/repo/workspaceContext'
const root=await mkdtemp(path.join(os.tmpdir(),'p8-owner-path-'))
try {
 await writeFile(path.join(root,'calc.mjs'),'export function add(a,b){return a-b}\n')
 await writeFile(path.join(root,'calc.test.mjs'),"import {add} from './calc.mjs'; import assert from 'node:assert/strict'; assert.equal(add(2,3),5)\n")
 await runWithWorkspaceRoot(root,async()=>{
  const index=await buildCodeIndex(true)
  const source=await mapOwnership('calc.mjs',index)
  assert.equal(source.owners[0],'calc.mjs','explicit source path must beat its importing test')
  assert.ok(source.tests.includes('calc.test.mjs'),'root-level .test.mjs must be associated')
  await writeFile(path.join(root,'shared.mjs'),'export function add(a,b){return a-b}\n')
  await writeFile(path.join(root,'shared.test.mjs'),"import {add} from './shared.mjs'; assert.equal(add(2,3),5)\n")
  const query=compactOwnershipQuery('The add function in shared.mjs is wrong. Fix shared.mjs. Do not change calc.test.mjs or eslint.config.mjs. Use Local Only.')
  assert.equal(query,'shared.mjs')
  const fresh=await buildCodeIndex()
  const shared=await mapOwnership(query,fresh)
  assert.deepEqual(shared.owners,['shared.mjs'],'explicit source ownership excludes unrelated owners')
  assert.equal(shared.owners[0],'shared.mjs','new files must invalidate cached ownership')
  assert.ok(shared.tests.includes('shared.test.mjs'))
  const mission={kind:'fixture',userRequest:'Fix shared.mjs',sourceState:{changedFiles:['shared.mjs']},engineering:{ownership:shared}} as Parameters<typeof rejectIrrelevantTest>[0]
  assert.deepEqual(rankTests(mission).map(t=>t.test),['shared.test.mjs'],'real sibling ranking must exclude calc.test.mjs')
  const review={status:'PASS',findings:[],severity:[],requiredAction:'none',at:new Date().toISOString(),diffHash:'test',compact:'PASS'} as Parameters<typeof extendSelfReviewForMultiFile>[0]
  assert.equal(extendSelfReviewForMultiFile(review,mission).status,'PASS','ordinary shared.mjs must not trigger fixture-only caller rule')
  assert.match(rejectIrrelevantTest(mission,['calc.test.mjs'])??'',/Irrelevant test refused/,'root sibling tests must not earn verification')
  assert.equal(rejectIrrelevantTest(mission,['shared.test.mjs']),null)
  await writeFile(path.join(root,'shared.mjs'),'export function renamed(a,b){return a+b}\n')
  const updated=await buildCodeIndex()
  assert.ok(updated.symbols.renamed?.includes('shared.mjs'),'content changes must refresh symbols')
  assert.ok(!updated.symbols.add?.includes('shared.mjs'))
  assert.match(validateReplacementText({request:'fix shared.mjs',matchText:'return a+b',replacementText:'return a+b'})??'',/^NO_CHANGE/)
  const test=await mapOwnership('calc.test.mjs',index)
  assert.equal(test.owners[0],'calc.test.mjs','explicit test ownership requests remain supported')
 })
 console.log('PASS exact path ownership and root-level .test.mjs association')
} finally { await rm(root,{recursive:true,force:true}) }
