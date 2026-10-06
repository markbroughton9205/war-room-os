/**
 * Bounded recovery for an edit that would break syntax: the file stays untouched, the rejected candidate is remembered, an identical retry is refused at once,
 * a corrected retry is accepted, and the whole-file rewrite is only an escalation (short, read, non-test owner; after two failures on the same source; written only if it parses).
 * Real tools (file.read / file.replace_unique / file.write), a real registry and real directories in an isolated temp base.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let passed = 0
const ok = (name: string) => { passed += 1; console.log(`PASS ${name}`) }

const tmp = mkdtempSync(path.join(os.tmpdir(), 'synrec-'))
const base = path.join(tmp, 'base')
const projects = path.join(tmp, 'projects')
for (const dir of [base, projects]) mkdirSync(dir, { recursive: true })
Object.assign(process.env, {
  REPO_ROOT: base,
  FOUNDRY_PROJECTS_ROOT: projects,
  WAR_ROOM_PROJECTS_ROOT: path.join(tmp, 'war-room-projects'),
  WAR_ROOM_ENGINEER_ALLOWED_ROOTS: projects,
  WAR_ROOM_LOCAL_DATA_DIR: path.join(tmp, 'app-data'),
})

const { openExistingProjectWorkspace } = await import('./workspaceRegistry')
const { runWithWorkspaceRoot } = await import('@/lib/repo/workspaceContext')
const { executeEngineerTool } = await import('./engineerTools')
const { ingestModelToolResult, startMissionInput } = await import('./foundryMissionController')
const { resolveWorkspaceBinding } = await import('./foundryWorkspaceBinding')
const { saveMission, loadMission } = await import('./foundryMissionStore')
const { evaluateReplanDecision, smallFileRewriteTarget } = await import('./foundryEngineeringGateTable')
const { namedFunctionBodyLines, findGoalRelevantUniqueSpans } = await import('./foundryEditAnchors')
const { SYNTAX_ESCALATION_AFTER, candidateSignature, isRepeatedBadCandidate, recordSyntaxRejection, syntaxEscalated } = await import('./foundrySyntaxRecovery')

const sha = (text: string) => createHash('sha256').update(text).digest('hex')
const BUGGY = 'export function add(a, b) {\n  return a - b\n}\n\nexport function multiply(a, b) {\n  return a * b\n}\n'
const TEST = "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { add } from './calc.mjs'\ntest('add', () => { assert.equal(add(2, 3), 5) })\n"

/** A bound mission in a fresh project, taken through owners, impact, baseline and a read (the real gates an edit needs). */
async function scenario(name: string, source = BUGGY) {
  const dir = path.join(projects, name)
  mkdirSync(dir)
  writeFileSync(path.join(dir, 'calc.mjs'), source)
  writeFileSync(path.join(dir, 'calc.test.mjs'), TEST)
  const workspace = await openExistingProjectWorkspace(dir, name)
  const binding = (await resolveWorkspaceBinding({ workspaceId: workspace.id }))!
  const record = startMissionInput('The add function in calc.mjs returns the wrong result. Fix add so add(2, 3) is 5. Do not change the tests.', name, {})
  record.permissions = { ...record.permissions, filesystem: true, terminal: true }
  record.workspaceBinding = binding
  await saveMission(record)
  const inWorkspace = <T>(fn: () => Promise<T>) => runWithWorkspaceRoot(binding.workspaceRoot, fn, binding.workspaceId) as Promise<T>
  await inWorkspace(() => executeEngineerTool({ tool: 'engineering.baseline' as never, input: {} }, { repairId: record.missionId }))
  const live = (await loadMission(record.missionId))!
  const call = (tool: string, input: Record<string, unknown>) => inWorkspace(() => executeEngineerTool({ tool: tool as never, input }, { repairId: record.missionId, mission: live }))
  await call('code.owners', { query: 'add calc function' })
  await call('code.impact', {})
  await call('file.read', { path: 'calc.mjs' })
  const anchor = (live.engineering as { editAnchors?: Array<{ anchorId: string; anchorText: string }> } | undefined)?.editAnchors?.find(item => item.anchorText.includes('return a - b'))
  assert.ok(anchor, 'the read produced an anchor over the buggy line')
  const file = path.join(dir, 'calc.mjs')
  return { dir, file, live, call, anchor, read: () => readFileSync(file, 'utf8') }
}
const edit = (s: Awaited<ReturnType<typeof scenario>>, replacementText: string) => s.call('file.replace_unique', { path: 'calc.mjs', anchorId: s.anchor.anchorId, replacementText, reason: 'fix add' })
const BAD_ONE = 'export function add(a, b) {\n  return a + b\n}(a, b) {'
const BAD_TWO = 'return a + b }}'
const GOOD = 'return a + b'

const a = await scenario('A')
const before = a.read()

// 1. A patch that breaks syntax is refused with the parser error, the range, the window and the model's own replacement; the file is untouched.
{
  const first = await edit(a, BAD_ONE)
  assert.equal(first.ok, false)
  const message = String(first.error)
  for (const needle of ['PATCH_BREAKS_SYNTAX', 'PARSER_ERROR: syntax error', 'WRITABLE_RANGE: anchor', 'lines 2-2', 'MATCHED_REGION', 'return a - b', 'YOUR_REJECTED_REPLACEMENT', 'SOURCE_WINDOW:', '2:   return a - b', 'RETRY_RULES', 'do NOT repeat', 'ONE corrected bounded patch', 'REPEATED_BAD_PATCH']) {
    assert.ok(message.includes(needle), `the rejection carries "${needle}": ${message.slice(0, 400)}`)
  }
  assert.ok(!message.includes('ESCALATION'), 'no escalation after one failure')
  assert.equal(a.read(), before, 'the file is byte-identical after a rejected patch')
  ok('1: a syntax-breaking patch is rejected with the parser error, range, source window and the rejected replacement; the file is unchanged')
}

// 2. The identical retry is refused at once as REPEATED_BAD_PATCH, still leaves the file alone, and counts as the second failed attempt on this source: the escalation appears.
{
  const again = await edit(a, BAD_ONE)
  assert.equal(again.ok, false)
  assert.ok(/^REPEATED_BAD_PATCH/.test(String(again.error)), String(again.error))
  assert.ok(/ESCALATION \(2 failed attempts/.test(String(again.error)) && /rewrite the whole file with file\.write/.test(String(again.error)), String(again.error))
  assert.equal((a.live.engineering as { syntaxRecovery?: { count: number } }).syntaxRecovery?.count, 2)
  assert.equal(a.read(), before)
  ok('2: an identical malformed retry is refused immediately as REPEATED_BAD_PATCH, counts as a failed attempt, and carries the escalation')
}

// 3. Two failed attempts on the same source make the whole-file rewrite available (for the short owner file only); a further different bad patch keeps the file untouched too.
{
  const owners = ['calc.test.mjs', 'calc.mjs']
  const recoveryOf = () => (a.live.engineering as { syntaxRecovery?: never }).syntaxRecovery
  const here = <T>(fn: () => T) => runWithWorkspaceRoot(a.dir, fn) as T
  assert.equal(here(() => smallFileRewriteTarget(owners, ['calc.mjs'], recoveryOf())), 'calc.mjs', 'two failures on this source escalate to the short owner file')
  const third = await edit(a, BAD_TWO)
  assert.equal(third.ok, false)
  assert.ok(/ESCALATION \(3 failed attempts/.test(String(third.error)), String(third.error).slice(-300))
  assert.equal(a.read(), before)
  ok('3: two failed attempts on the same source escalate to a whole-file rewrite of the short owner file')
}

// 4. A corrected retry is accepted, and nothing but the intended line changes.
{
  const fixed = await edit(a, GOOD)
  assert.equal(fixed.ok, true, String(fixed.error))
  const afterLines = a.read().split('\n')
  const beforeLines = before.split('\n')
  assert.equal(afterLines.length, beforeLines.length)
  const changed = afterLines.flatMap((line, index) => (line === beforeLines[index] ? [] : [index + 1]))
  assert.deepEqual(changed, [2], `only line 2 changed: ${changed.join(',')}`)
  assert.equal(afterLines[1], '  return a + b')
  assert.ok(a.read().includes('export function multiply(a, b) {\n  return a * b\n}'), 'multiply is untouched')
  ok('4: a corrected retry is accepted and only the intended line changes')
}

// 5. The whole-file escalation only writes a candidate that parses; an identical broken candidate is refused at once.
{
  const e = await scenario('E')
  const original = e.read()
  const brokenWhole = 'export function add(a, b) {\n  return a + b\n}\nexport function multiply(a, b) {\n  return a * b\n'
  const refused = await e.call('file.write', { path: 'calc.mjs', content: brokenWhole, reason: 'whole-file rewrite' })
  assert.equal(refused.ok, false)
  assert.ok(/PATCH_BREAKS_SYNTAX: the complete file you wrote/.test(String(refused.error)), String(refused.error))
  assert.equal(e.read(), original, 'a whole-file candidate that does not parse never reaches the disk')
  const repeat = await e.call('file.write', { path: 'calc.mjs', content: brokenWhole, reason: 'whole-file rewrite' })
  assert.ok(/^REPEATED_BAD_PATCH/.test(String(repeat.error)), String(repeat.error))
  const dropsCode = 'export function add(a, b) {\n  return a + b\n}\n'
  const dropped = await e.call('file.write', { path: 'calc.mjs', content: dropsCode, reason: 'whole-file rewrite' })
  assert.ok(/WHOLE_FILE_DROPS_CODE/.test(String(dropped.error)) && String(dropped.error).includes('multiply'), String(dropped.error))
  assert.equal(e.read(), original, 'a rewrite that deletes an existing declaration never reaches disk')
  const goodWhole = 'export function add(a, b) {\n  return a + b\n}\n\nexport function multiply(a, b) {\n  return a * b\n}\n'
  const accepted = await e.call('file.write', { path: 'calc.mjs', content: goodWhole, reason: 'whole-file rewrite' })
  assert.equal(accepted.ok, true, String(accepted.error))
  assert.equal(e.read(), goodWhole)
  const lines = e.read().split('\n'); const was = original.split('\n')
  assert.deepEqual(lines.flatMap((line, i) => (line === was[i] ? [] : [i + 1])), [2], 'only the intended line differs from the original')
  ok('5: a whole-file candidate is written only if it parses; a broken one never reaches disk and an identical repeat is refused at once')
}

// 6. The whole-file escalation is bounded: short, read, non-test owners only; two failures on this exact source; never before.
{
  const digest = sha(BUGGY)
  const twice = recordSyntaxRejection(recordSyntaxRejection(undefined, 'calc.mjs', digest, 's1', 'e1'), 'calc.mjs', digest, 's1', 'e1')
  assert.equal(SYNTAX_ESCALATION_AFTER, 2, 'the documented threshold')
  assert.equal(syntaxEscalated(twice, 'calc.mjs', digest), true)
  assert.equal(syntaxEscalated(recordSyntaxRejection(undefined, 'calc.mjs', digest, 's1', 'e1'), 'calc.mjs', digest), false, 'one failure is not enough')
  assert.equal(syntaxEscalated(twice, 'calc.mjs', sha(`${BUGGY}\n// changed`)), false, 'a changed source digest starts over')
  assert.equal(syntaxEscalated(twice, 'other.mjs', digest), false, 'another path starts over')
  assert.equal(isRepeatedBadCandidate(twice, 'calc.mjs', digest, 's1'), true)
  assert.equal(isRepeatedBadCandidate(twice, 'calc.mjs', digest, 'new'), false)
  assert.notEqual(candidateSignature('calc.mjs', digest, 'a', 'b'), candidateSignature('calc.mjs', digest, 'a', 'c'))
  // the gate rule, against real files in a workspace
  const small = await scenario('F')
  const recovery = recordSyntaxRejection(recordSyntaxRejection(undefined, 'calc.mjs', sha(small.read()), 'a', 'x'), 'calc.mjs', sha(small.read()), 'b', 'y')
  const run = <T>(fn: () => T) => runWithWorkspaceRoot(small.dir, fn) as T
  assert.equal(run(() => smallFileRewriteTarget(['calc.test.mjs', 'calc.mjs'], ['calc.mjs'], recovery)), 'calc.mjs')
  assert.equal(run(() => smallFileRewriteTarget(['calc.mjs'], [], recovery)), null, 'a file the mission has not read is not a target')
  assert.equal(run(() => smallFileRewriteTarget(['calc.test.mjs'], ['calc.test.mjs'], recordSyntaxRejection(recordSyntaxRejection(undefined, 'calc.test.mjs', sha(TEST), 'a', 'x'), 'calc.test.mjs', sha(TEST), 'b', 'y'))), null, 'a test file is never rewritten')
  const longSource = `${BUGGY}${Array.from({ length: 220 }, (_, i) => `export const filler${i} = ${i}\n`).join('')}`
  const long = await scenario('G', longSource)
  const longRecovery = recordSyntaxRejection(recordSyntaxRejection(undefined, 'calc.mjs', sha(long.read()), 'a', 'x'), 'calc.mjs', sha(long.read()), 'b', 'y')
  assert.equal(runWithWorkspaceRoot(long.dir, () => smallFileRewriteTarget(['calc.mjs'], ['calc.mjs'], longRecovery)), null, 'a long file is never escalated to a whole-file rewrite')
  assert.equal(run(() => smallFileRewriteTarget(['calc.mjs'], ['calc.mjs'], undefined)), null, 'no failures, no escalation')
  ok('6: whole-file escalation is bounded to short, read, non-test owners after two failures on the same source digest')
}

// 7. A model that answers a rejected patch with REPLAN is told to send the corrected TOOL call (with the anchor), not another plan.
{
  const r = await scenario('R')
  await edit(r, BAD_ONE)
  const verdict = evaluateReplanDecision(r.live, { reasoningSummary: 'The edit caused a syntax error; need to adjust the replacement text.', planChanges: undefined } as never)
  assert.equal(verdict.allowed, false)
  for (const needle of ['SYNTAX_RETRY_REQUIRED', 'calc.mjs is unchanged', 'Do not REPLAN', `"anchorId":"${r.anchor.anchorId}"`, '"name":"file.replace_unique"']) {
    assert.ok(verdict.compact.includes(needle), `refusal carries "${needle}": ${verdict.compact}`)
  }
  ok('7: a REPLAN after a rejected syntax patch is refused with the exact corrected-TOOL call shape and anchor')
}

// 8. A bound project with no lint/typecheck tooling gets its regression evidence from a passing run of ALL its own test files, and from nothing weaker.
{
  const t = await scenario('T')
  const run = (targets: string[], ok = true) => {
    const mission = t.live as never as { engineering?: { regressionOk?: boolean } }
    delete mission.engineering!.regressionOk
    ingestModelToolResult(t.live, 'terminal.execute' as never, { operation: { id: 'node_test', targets } }, { ok, tool: 'terminal.execute', result: { ok, exitCode: ok ? 0 : 1 } } as never)
    return mission.engineering!.regressionOk === true
  }
  assert.equal(run(['calc.test.mjs']), true, 'every project test file passed')
  assert.equal(run(['calc.test.mjs'], false), false, 'a failing run is not evidence')
  assert.equal(run([]), false, 'a run that named no test file is not evidence')
  writeFileSync(path.join(t.dir, 'other.test.mjs'), TEST)
  assert.equal(run(['calc.test.mjs']), false, 'a project test file that was not run keeps the gate open')
  assert.equal(run(['calc.test.mjs', 'other.test.mjs']), true)
  mkdirSync(path.join(t.dir, 'node_modules', '.bin'), { recursive: true }); writeFileSync(path.join(t.dir, 'node_modules', '.bin', 'eslint'), '')
  assert.equal(run(['calc.test.mjs', 'other.test.mjs']), false, 'a project that has a linter must still pass lint/typecheck')
  ok('8: a bound project without lint/typecheck tooling gets regression evidence only from all of its tests passing')
}

// 9. A goal that names a function offers that function's own statement lines as bounded anchors (the line that has to change), not just the declaration token.
{
  const goal = 'The add function in calc.mjs returns the wrong result and calc.test.mjs fails. Fix add so add(2, 3) is 5.'
  assert.deepEqual(namedFunctionBodyLines(BUGGY, goal), ['return a - b'], 'only the named function body, unique lines only')
  assert.ok(findGoalRelevantUniqueSpans(BUGGY, goal).includes('return a - b'))
  assert.deepEqual(namedFunctionBodyLines(BUGGY, 'Fix the divide function'), [], 'a function the goal does not name is not offered')
  assert.deepEqual(namedFunctionBodyLines('function add(a, b) {\n  return a - b\n}\nfunction sub(a, b) {\n  return a - b\n}\n', goal), [], 'a line that occurs twice is not a unique anchor')
  assert.deepEqual(namedFunctionBodyLines('export const add = (a, b) => {\n  const total = a - b\n  return total\n}\n', goal), ['const total = a - b', 'return total'], 'arrow function bodies too')
  ok('9: a goal that names a function offers its unique body lines as anchors')
}

// 10. A model that keeps replanning with nothing left to plan is steered to COMPLETE and then completed through the gate; a justified REPLAN is never touched.
{
  const { satisfiedGateReplanAction } = await import('./foundryGateDrive')
  const base = { gateComplete: true, nextRequiredAction: 'COMPLETE', justification: null as string | null }
  assert.equal(satisfiedGateReplanAction({ ...base, refusals: 0 }), 'REFUSE', 'the first unjustified REPLAN is refused toward COMPLETE')
  assert.equal(satisfiedGateReplanAction({ ...base, refusals: 1 }), 'COMPLETE', 'the second completes the mission through the gate')
  assert.equal(satisfiedGateReplanAction({ ...base, refusals: 5 }), 'COMPLETE')
  assert.equal(satisfiedGateReplanAction({ ...base, refusals: 3, justification: 'TEST_FAILURE' }), null, 'a justified replan is left alone')
  assert.equal(satisfiedGateReplanAction({ ...base, refusals: 3, gateComplete: false }), null, 'an unsatisfied gate never completes')
  assert.equal(satisfiedGateReplanAction({ ...base, refusals: 3, nextRequiredAction: 'TOOL' }), null, 'a required tool is never skipped')
  const controller = readFileSync(path.join(process.cwd(), 'lib/native-builder/foundryMissionController.ts'), 'utf8')
  const hook = controller.indexOf('satisfiedGateReplanAction({')
  assert.ok(hook > 0 && hook < controller.indexOf("await modelTransition(mission, 'REPLANNING', response.decision.reasoningSummary)"), 'the check runs before a replan is counted')
  assert.ok(controller.slice(hook, hook + 900).includes('gateComplete: satisfied.complete'), 'it consults the completion gate')
  ok('10: unjustified REPLANs after every gate is satisfied are steered to COMPLETE and completed through the gate; others untouched')
}

rmSync(tmp, { recursive: true, force: true })
console.log(`FOUNDRY_SYNTAX_RECOVERY_VALIDATION ${passed}/10`)
