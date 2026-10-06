import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { runWithWorkspaceRoot } from '@/lib/repo/workspaceContext'
import { previewDiff } from '@/lib/repo/diff'
import { reviewDiffText, synthesizeAppliedDiff } from './foundryEngineeringDepth'
import type { FoundryMissionRecord } from './foundryMissionTypes'
const root=await mkdtemp(path.join(os.tmpdir(),'p8-nongit-review-'))
try {
 await writeFile(path.join(root,'calc.mjs'),'export function add(a,b){return a+b}\n')
 await runWithWorkspaceRoot(root,async()=>{
  assert.equal((await previewDiff({paths:['calc.mjs']})).diff,'','a fresh non-Git workspace has no Git diff')
  const mutation={path:'calc.mjs',matchText:'export function add(a,b){return a-b}',replacementText:'export function add(a,b){return a+b}',start:1,removed:1,added:1}
  const diff=synthesizeAppliedDiff(mutation as never);assert.ok(diff?.includes('+export function add(a,b){return a+b}'))
  const mission={userRequest:'Fix add in calc.mjs',sourceState:{changedFiles:['calc.mjs']},candidateFiles:['calc.mjs'],engineering:{impact:{owners:['calc.mjs']}}} as unknown as FoundryMissionRecord
  assert.equal(reviewDiffText(diff!,mission).status,'PASS','actual bounded edit evidence remains reviewable without Git')
  execFileSync('git',['init','--quiet'],{cwd:root});execFileSync('git',['add','calc.mjs'],{cwd:root})
  await writeFile(path.join(root,'calc.mjs'),'export function add(a,b){return a+b+1}\n')
  assert.match((await previewDiff({paths:['calc.mjs']})).diff,/return a\+b\+1/,'tracked Git changes remain visible')
 })
 await assert.rejects(async()=>await runWithWorkspaceRoot(path.join(root,'missing'),()=>previewDiff()),'missing working directories must not become empty successful diffs')
 console.log('PASS non-Git review, real bounded edit evidence, tracked diff and non-Git-error refusal')
} finally { await rm(root,{recursive:true,force:true}) }
