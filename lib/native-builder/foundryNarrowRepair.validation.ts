/** Generic validation of narrow diagnostic-driven repair: a stand-in model proposes one bounded patch per turn; the mechanism does the rest. */
import assert from 'node:assert/strict'
import { symlinkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { linkedValidators, literalHints, runtimeReads, runtimeDiagnose, typeOnlyImportDiagnose, diagnoseAll, callbackItemType, statementChain, strayWord, stateTypeRoot, stubDiagnose, stubValueRoot, introducesStrayCharacters, strayCharacterCount, coerceValue, valueShapeRoot, memberAccessRoot, misimportRoot, stripEchoedPunctuation, tokenFixRoot, propertyExpressionRoot, emptyArrayRoot, importRoot, accumulatorRoot, stripBoundaryCopies, hintFor, syntaxErrorCount, buildNarrowContext, diagnoseFile, evaluatePatch, repairStagnant, setNarrowRepairLedgerRootForTests, MAX_TRIES_PER_TARGET, type NarrowContext } from './foundryNarrowRepair'

const root = mkdtempSync(path.join(os.tmpdir(), 'foundry-narrow-'))
setNarrowRepairLedgerRootForTests(path.join(root, '.ledger'))
let passed = 0
const ok = (name: string) => { passed += 1; console.log(`PASS ${name}`) }

const TYPES = `export type Job = { id: string; state: 'RUNNING' | 'DONE'; started: number }
export function label(job: Job): string { return job.id + ':' + job.state }
`
const BROKEN = `import { Job, label } from './types'

export function summarize(jobs: Job[]): string {
  const first = jobs.find(job => job.state === 'RUNNING')
  const name = first.id
  const age = Date.now() - jobs[0].startedAt
  const text: string = label(jobs.length)
  const done: number = jobs.filter(j => j.state === 'DONE').length.toString()
  const untouched = jobs.map(j => j.id).join(',')
  return name + age + text + done + untouched
}
`
const reset = (name: string, text = BROKEN) => { writeFileSync(path.join(root, 'types.ts'), TYPES); writeFileSync(path.join(root, name), text); return name }

/** Stand-in for the local model: given the executive's context for ONE diagnostic, answer with one bounded patch of that line. */
function standInModel(context: NarrowContext, source: string) {
  const suggestion = /COMPILER SUGGESTS:\n(.*)/.exec(context.text)?.[1]
  if (suggestion) return { startLine: context.patchRange.start, endLine: context.patchRange.end, replacement: suggestion }
  const line = context.target.target.line
  const text = source.split('\n')[line - 1]
  const fixed = context.target.target.code === 'TS18048' || context.target.target.code === 'TS2532' ? text.replace('first.id', "first?.id ?? ''")
    : /startedAt/.test(context.target.target.message) ? text.replace('startedAt', 'started')
    : /number' is not assignable to parameter of type 'Job'/.test(context.target.target.message) ? text.replace('label(jobs.length)', 'label(jobs[0])')
    : /string' is not assignable to type 'number'/.test(context.target.target.message) ? text.replace('.length.toString()', '.length')
    : text
  return { startLine: line, endLine: line, replacement: fixed }
}

// 1. several defects are repaired one diagnostic at a time, monotonically, leaving unrelated lines alone, ending TypeScript-clean.
{
  const file = reset('view.ts')
  const original = readFileSync(path.join(root, file), 'utf8').split('\n')
  const start = diagnoseFile(root, file)
  assert.ok(start.length >= 4, `expected several defects, got ${start.length}`)
  const trail = [start.length]
  let calls = 0
  for (let guard = 0; guard < 12; guard++) {
    const context = buildNarrowContext(root, file)
    if (!context) break
    assert.ok(context.text.includes('TARGET DIAGNOSTIC') && context.text.includes('CURRENT CODE WINDOW') && context.text.includes('SOURCE LINE'))
    const source = readFileSync(path.join(root, file), 'utf8')
    const patch = standInModel(context, source)
    calls += 1
    const outcome = evaluatePatch(root, file, patch)
    if (outcome.ok) { writeFileSync(path.join(root, file), outcome.content); trail.push(outcome.after) }
  }
  assert.equal(diagnoseFile(root, file).length, 0, 'final source is TypeScript-clean')
  for (let i = 1; i < trail.length; i++) assert.ok(trail[i] < trail[i - 1], `diagnostics must decrease monotonically: ${trail}`)
  assert.ok(calls <= start.length + 1, `one bounded turn per diagnostic, got ${calls} for ${start.length}`)
  const final = readFileSync(path.join(root, file), 'utf8').split('\n')
  assert.equal(final.length, original.length)
  const changed = final.filter((line, index) => line !== original[index]).length
  assert.ok(changed <= start.length, `only the target lines change (${changed})`)
  assert.equal(final[8], original[8], 'an unrelated line is untouched')
  ok(`one diagnostic per turn: ${trail.join(' -> ')} errors, ${changed} lines changed, clean`)
}

// 2. a candidate that makes things worse is rejected and the file (the checkpoint) is untouched.
{
  const file = reset('view2.ts')
  const before = readFileSync(path.join(root, file), 'utf8')
  const context = buildNarrowContext(root, file)!
  const worse = evaluatePatch(root, file, { startLine: context.target.target.line, endLine: context.target.target.line, replacement: 'const broken: number = "x"; const alsoBroken: string = 1; const and: boolean = []' })
  assert.equal(worse.ok, false)
  assert.ok(!worse.ok && /PATCH_REJECTED/.test(worse.error))
  const syntax = evaluatePatch(root, file, { startLine: context.target.target.line, endLine: context.target.target.line, replacement: 'const x = ((' })
  assert.equal(syntax.ok, false)
  assert.equal(readFileSync(path.join(root, file), 'utf8'), before, 'checkpoint restored: file unchanged')
  const tooBig = evaluatePatch(root, file, { startLine: 1, endLine: 60, replacement: 'x' })
  assert.equal(tooBig.ok, false)
  ok('worse / syntax-breaking / oversized candidates are rejected; checkpoint intact')
}

// 3. repeated NO_CHANGE does not burn unlimited calls, and the stagnation survives a restart (it is on disk).
{
  const file = reset('view3.ts')
  const defects = diagnoseFile(root, file).length
  let calls = 0
  for (let guard = 0; guard < 60; guard++) {
    const context = buildNarrowContext(root, file)
    if (!context) break
    calls += 1
    const same = evaluatePatch(root, file, { startLine: context.target.target.line, endLine: context.target.target.line, replacement: readFileSync(path.join(root, file), 'utf8').split('\n')[context.target.target.line - 1] })
    assert.equal(same.ok, false)
  }
  assert.ok(calls <= defects * MAX_TRIES_PER_TARGET, `bounded: ${calls} calls for ${defects} diagnostics`)
  assert.equal(buildNarrowContext(root, file), null, 'nothing left to try on this exact source')
  assert.equal(repairStagnant(root, file).stagnant, true)
  ok(`NO_CHANGE is bounded: ${calls} calls for ${defects} diagnostics, then stagnant (persisted)`)
}

// 4. an edit elsewhere in the file does not reopen a stuck diagnostic (its surroundings are unchanged); an edit to its own statement does.
{
  const file = 'view3.ts'
  const text = readFileSync(path.join(root, file), 'utf8')
  writeFileSync(path.join(root, file), `${text}\n// edited elsewhere\n`)
  assert.equal(buildNarrowContext(root, file), null, 'unrelated edit keeps the stuck diagnostics stuck (no wasted calls)')
  writeFileSync(path.join(root, file), text.replace('const text: string = label(jobs.length)', 'const text: string = label(jobs.length) // reworded'))
  assert.ok(buildNarrowContext(root, file), 'a change to the diagnostic\'s own statement reopens it')
  ok('stagnation is keyed on the code the model sees: unrelated edits keep it stuck, a local edit reopens it')
}

// 5b. the error is reported at the use site; the cause is the multi-line declaration above it.
{
  const file = 'multi.ts'
  writeFileSync(path.join(root, file), `export function f(xs: number[]): number {\n  const total = xs\n    .map(x => x * 2)\n    .filter(x => x > 1)\n    .reduce((a, b) => a + b, '0')\n  return total\n}\n`)
  const before = readFileSync(path.join(root, file), 'utf8')
  const first = buildNarrowContext(root, file)!
  assert.equal(first.target.attempt, 0)
  assert.equal(first.target.target.line, 6, 'the compiler points at the use site')
  assert.ok(first.text.includes('WHERE THE NAMES ON THE TARGET LINE ARE DECLARED') && first.text.includes('.reduce('), 'the declaration is surfaced')
  // A patch at the use site that does not improve anything is rejected, recorded, and leaves the file alone.
  const miss = evaluatePatch(root, file, { startLine: first.patchRange.start, endLine: first.patchRange.end, replacement: '  return total + 0' })
  assert.equal(miss.ok, false)
  assert.equal(readFileSync(path.join(root, file), 'utf8'), before)
  // Retry: the patch range is now the whole multi-line declaring statement.
  const retry = buildNarrowContext(root, file)!
  assert.equal(retry.target.attempt, 1)
  assert.deepEqual(retry.patchRange, { start: 2, end: 5 })
  const lines = before.split('\n')
  const fixed = evaluatePatch(root, file, { startLine: 2, endLine: 5, replacement: lines.slice(1, 5).join('\n').replace("'0'", '0') })
  assert.ok(fixed.ok)
  if (fixed.ok) { writeFileSync(path.join(root, file), fixed.content); assert.equal(diagnoseFile(root, file).length, 0) }
  ok('use-site error: declaration surfaced; the retry patches the whole multi-line declaring statement and the file is clean')
}

// 5. a fragment or a syntax regression is measurable, so a whole-file write can be refused before it destroys a file.
{
  assert.equal(syntaxErrorCount('a.ts', BROKEN), 0)
  assert.ok(syntaxErrorCount('a.ts', 'export function f( {') > 0)
  assert.equal(syntaxErrorCount('a.json', '{'), 0)
  ok('syntaxErrorCount distinguishes valid, broken and non-source files')
}

assert.ok(hintFor('TS7053').includes('index signature') && hintFor('TS9999') === '')
assert.ok(hintFor('TS2345').includes('callback whose parameter has an explicit type annotation'), 'the callback-annotation conflict is named in the TS2345 guidance')
ok('known diagnostic codes carry deterministic guidance; unknown codes carry none')

// 8. context-copy contamination: only exact copies of the lines just outside the range are dropped.
{
  const src = ['const a = 1', 'const attention = a + 1', '', 'const x = attention', 'const y = x', 'const z = y', 'export { z }'].join('\n')
  const range: [number, number] = [4, 5]
  const pre = stripBoundaryCopies(src, ...range, 'const attention = a + 1\nconst x = attention + 0\nconst y = x')
  assert.equal(pre.replacement, 'const x = attention + 0\nconst y = x')
  assert.equal(pre.strippedBefore, 1)
  const post = stripBoundaryCopies(src, ...range, 'const x = attention\nconst y = x + 1\nconst z = y')
  assert.equal(post.replacement, 'const x = attention\nconst y = x + 1')
  assert.equal(post.strippedAfter, 1)
  const legit = stripBoundaryCopies(src, ...range, 'const x = attention * 2\nconst y = x')
  assert.equal(legit.replacement, 'const x = attention * 2\nconst y = x')
  assert.equal(legit.strippedBefore + legit.strippedAfter, 0)
  const punctuation = stripBoundaryCopies('f(() => {\n  a()\n})\nb()', 2, 2, '})\n  a(1)')
  assert.equal(punctuation.replacement, '})\n  a(1)', 'punctuation-only lines are never treated as copies')
  // End to end: the contaminated candidate is accepted once its copy is dropped; lines outside the range stay byte-identical.
  const file = 'ctx.ts'
  const text = ['export const base = 1', 'export const attention = base + 1', '', 'export const view: number = attention', 'export const other = base'].join('\n')
  writeFileSync(path.join(root, file), text.replace('number = attention', 'string = attention'))
  const before = readFileSync(path.join(root, file), 'utf8')
  const outcome = evaluatePatch(root, file, { startLine: 4, endLine: 4, replacement: 'export const attention = base + 1\nexport const view: number = attention' })
  assert.ok(outcome.ok, 'the copied declaration must not cause a redeclaration')
  if (outcome.ok) {
    const out = outcome.content.split('\n')
    assert.equal(out.length, 5)
    assert.deepEqual([out[0], out[1], out[2], out[4]], [before.split('\n')[0], before.split('\n')[1], '', before.split('\n')[4]])
  }
  ok('copied context lines before/after the range are stripped; legitimate edits and unrelated lines survive')
}

// 9. TS7053 on an untyped reduce accumulator is repaired at the seed, not at the use site.
{
  const file = 'acc.ts'
  const text = `export type Task = { id: string; state: 'A' | 'B' }
export function group(tasks: Task[]) {
  const total = tasks.length
  const grouped = Object.values(tasks.reduce((acc, task) => {
    const state = task.state
    if (!acc[state]) {
      acc[state] = { state, items: [] as Task[] }
    }
    acc[state].items.push(task)
    return acc
  }, {})).map(entry => entry.items.length)
  return { total, grouped }
}
`
  writeFileSync(path.join(root, file), text)
  const diags = diagnoseFile(root, file)
  assert.ok(diags.some(item => item.code === 'TS7053'), 'fixture has the use-site errors')
  const use = diags.find(item => item.code === 'TS7053')!
  const rootCause = accumulatorRoot(text, use, diags)!
  assert.ok(rootCause, 'the enclosing reduce is found')
  assert.deepEqual(rootCause.seed, { start: 11, end: 11 })
  assert.equal(rootCause.keyType, use.message.match(/expression of type '([^']+)'/)![1]); assert.ok(rootCause.keyType.length > 1 && !/key type in the message/.test(rootCause.keyType), `key type parsed: ${rootCause.keyType}`)
  assert.ok(rootCause.valueShapes.some(item => item.includes('items')), 'the stored value shape is surfaced')
  assert.ok(rootCause.related.length >= 2, 'the use-site cluster is listed')
  assert.equal(rootCause.itemType, '(typeof tasks)[number]', 'a ready element type for the reduced items')
  assert.equal(accumulatorRoot(text, diags.find(item => item.code !== 'TS7053') ?? { ...use, code: 'TS2322' }, diags), null)
  const context = buildNarrowContext(root, file)!
  assert.deepEqual(context.patchRange, rootCause.seed, 'the writable range is the seed, not acc[state]')
  assert.ok(context.text.includes('TARGET:\nreduce accumulator seed/type') && context.text.includes('RELATED DIAGNOSTICS') && context.text.includes('KEY TYPE') && context.text.includes('EXPECTED VALUE TYPE'))
  // A seed typed with an explicit shape resolves the cluster, monotonically; only the seed line changes.
  const outcome = evaluatePatch(root, file, { startLine: 11, endLine: 11, replacement: '{} as Record<string, { state: Task[\'state\']; items: Task[] }>' })
  assert.ok(outcome.ok, `seed typing accepted: ${outcome.ok ? '' : outcome.error}`)
  if (outcome.ok) {
    assert.ok(outcome.after < outcome.before, 'diagnostics decrease')
    const before = text.split('\n')
    const after = outcome.content.split('\n')
    assert.equal(after.length, before.length)
    assert.deepEqual(after.filter((line, i) => line !== before[i]).length, 1, 'only the seed line changed')
    writeFileSync(path.join(root, file), outcome.content)
    assert.equal(diagnoseFile(root, file).length, 0)
  }
  // A typed seed is no longer a root cause target.
  assert.equal(accumulatorRoot(readFileSync(path.join(root, file), 'utf8'), use, []), null)
  ok('TS7053 use-site maps to the reduce seed: seed is the only writable range, cluster and value shape surfaced, diagnostics drop')
}

// 10. A. missing named import: the writable range is the import section and only the import changes.
{
  writeFileSync(path.join(root, 'shapekinds.ts'), "export type ShapeKind = 'round' | 'square'\nexport const shapeKinds: ShapeKind[] = ['round', 'square']\n")
  writeFileSync(path.join(root, 'shapeother.ts'), 'export const shapeOther = 1\n')
  const file = 'useshape.ts'
  const text = ["import { shapeOther } from './shapeother'", '', 'export function describe(kind: ShapeKind): string {', '  return kind + shapeOther', '}', ''].join('\n')
  writeFileSync(path.join(root, file), text)
  const diags = diagnoseFile(root, file)
  assert.deepEqual(diags.map(item => item.code), ['TS2304'])
  const cause = importRoot(root, file, text, diags[0])!
  assert.ok(cause, 'exactly one sibling exports the symbol')
  assert.equal(cause.importRoot.mode, 'ADD')
  assert.equal(cause.importRoot.spec, './shapekinds')
  assert.deepEqual(cause.range, { start: 1, end: 1 }, 'the import block is the writable range, not the use site (line 3)')
  const context = buildNarrowContext(root, file)!
  assert.deepEqual(context.patchRange, { start: 1, end: 1 })
  assert.ok(context.text.includes('MISSING SYMBOL:\nShapeKind') && context.text.includes("./shapekinds"))
  // anything outside the import range is refused
  const wrongPlace = evaluatePatch(root, file, { startLine: 3, endLine: 3, replacement: 'export function describe(kind: string): string {' })
  assert.equal(wrongPlace.ok, false)
  // a second import of an already imported module is refused
  const duplicate = evaluatePatch(root, file, { startLine: 1, endLine: 1, replacement: "import { shapeOther } from './shapeother'\nimport { shapeOther as again } from './shapeother'" })
  assert.equal(duplicate.ok, false)
  const fixed = evaluatePatch(root, file, { startLine: 1, endLine: 1, replacement: "import { shapeOther } from './shapeother'\nimport type { ShapeKind } from './shapekinds'" })
  assert.ok(fixed.ok, `import accepted: ${fixed.ok ? '' : fixed.error}`)
  if (fixed.ok) {
    const before = text.split('\n')
    const after = fixed.content.split('\n')
    assert.equal(after.length, before.length + 1)
    assert.deepEqual(after.slice(2), before.slice(1), 'only the import block changed')
    writeFileSync(path.join(root, file), fixed.content)
    assert.equal(diagnoseFile(root, file).length, 0)
  }
  // a name two modules export is not credible: no import root
  writeFileSync(path.join(root, 'shapetwin.ts'), "export type ShapeKind = 'twin'\n")
  assert.equal(importRoot(root, file, text, diags[0]), null)
  rmSync(path.join(root, 'shapetwin.ts'))
  ok('missing import: import block is the only writable range; one new line; duplicates and edits elsewhere refused; clean')
}

// 10. B. existing import augmentation: the symbol joins the named import, no duplicate import line.
{
  const file = 'useshape2.ts'
  const text = ["import { shapeKinds } from './shapekinds'", '', 'export function count(kind: ShapeKind): number {', '  return shapeKinds.indexOf(kind)', '}', ''].join('\n')
  writeFileSync(path.join(root, file), text)
  const diags = diagnoseFile(root, file)
  const cause = importRoot(root, file, text, diags[0])!
  assert.equal(cause.importRoot.mode, 'AUGMENT')
  assert.deepEqual(cause.range, { start: 1, end: 1 })
  const second = evaluatePatch(root, file, { startLine: 1, endLine: 1, replacement: "import { shapeKinds } from './shapekinds'\nimport { ShapeKind } from './shapekinds'" })
  assert.equal(second.ok, false, 'a second import of the same module is refused')
  const fixed = evaluatePatch(root, file, { startLine: 1, endLine: 1, replacement: "import { shapeKinds, ShapeKind } from './shapekinds'" })
  assert.ok(fixed.ok, `augmented: ${fixed.ok ? '' : fixed.error}`)
  if (fixed.ok) {
    assert.equal(fixed.content.split('\n').length, text.split('\n').length, 'no new line')
    assert.equal(fixed.content.split("from './shapekinds'").length - 1, 1, 'exactly one import of the module')
    writeFileSync(path.join(root, file), fixed.content)
    assert.equal(diagnoseFile(root, file).length, 0)
  }
  ok('existing import: the missing name is added to the named import; no duplicate import line')
}

// 10. C. never[] accumulator: the empty-array declaration is the target, not the push.
{
  const file = 'bucket.ts'
  const text = ['export type Item = { id: string; group: string }', 'export function bucket(items: Item[]) {', '  const out = {} as Record<string, { group: string; ids: [] }>', '  for (const item of items) {', '    if (!out[item.group]) out[item.group] = { group: item.group, ids: [] }', '    out[item.group].ids.push(item.id)', '  }', '  return out', '}', ''].join('\n')
  writeFileSync(path.join(root, file), text)
  const diags = diagnoseFile(root, file)
  assert.ok(diags.some(item => item.code === 'TS2345' && /type 'never'/.test(item.message)), 'fixture: push into never')
  const push = diags.find(item => item.code === 'TS2345')!
  const cause = emptyArrayRoot(text, push)!
  assert.ok(cause)
  assert.deepEqual(cause.range, { start: 3, end: 3 }, 'the declared type, not the later push line (6) or the value literal (5)')
  assert.equal(cause.emptyArray.property, 'ids')
  assert.equal(cause.emptyArray.pushedType, 'string')
  const context = buildNarrowContext(root, file)!
  assert.ok(context.text.includes('REPLACE EXACTLY THIS TEXT') && context.text.includes('PUSHED VALUE TYPE:\nstring') && context.text.includes('EXPECTED ARRAY ELEMENT TYPE'))
  const whole = evaluatePatch(root, file, { startLine: 3, endLine: 3, replacement: 'ids: string[]\nmore' })
  assert.equal(whole.ok, false, 'a multi-line replacement is refused: the model returns the fragment only')
  const outcome = evaluatePatch(root, file, { startLine: 3, endLine: 3, replacement: 'ids: string[]' })
  assert.ok(outcome.ok, `typed: ${outcome.ok ? '' : outcome.error}`)
  if (outcome.ok) {
    const before = text.split('\n')
    const after = outcome.content.split('\n')
    assert.equal(after.filter((line, i) => line !== before[i]).length, 1)
    writeFileSync(path.join(root, file), outcome.content)
    assert.equal(diagnoseFile(root, file).length, 0)
  }
  ok('never[] accumulator: the empty-array declaration is the only writable range; the push becomes valid; other lines untouched')
}

// 10. D. strong monotonicity: a lower error count bought with a new kind of error is rejected, the checkpoint stays intact.
{
  const file = 'shift.ts'
  const text = ["export const a: number = 'x'", "export const b: number = 'y'", ''].join('\n')
  writeFileSync(path.join(root, file), text)
  const outcome = evaluatePatch(root, file, { startLine: 1, endLine: 1, replacement: 'export const a: number = missingName' })
  assert.equal(outcome.ok, false)
  assert.ok(!outcome.ok && /new kind of error/.test(outcome.error) && /TS2304/.test(outcome.error), outcome.ok ? '' : outcome.error)
  assert.equal(readFileSync(path.join(root, file), 'utf8'), text, 'checkpoint intact')
  // the same defect moved to the same family is still judged by count
  const honest = evaluatePatch(root, file, { startLine: 1, endLine: 1, replacement: 'export const a: number = 1' })
  assert.ok(honest.ok && honest.after === 1)
  ok('a candidate that trades errors for a new error family is rejected; an honest fix is accepted')
}

// 11. downstream-prone TS2322 is deferred until every upstream diagnostic is gone, and is never reached past a stuck upstream one.
{
  const file = 'downstream.ts'
  const text = ["export function f(id: string) {", "  const early: number = 'x'", '  const box: { tags: [] } = { tags: [] }', '  box.tags.push(id)', '  return early + box.tags.length', '}', ''].join('\n')
  writeFileSync(path.join(root, file), text)
  const codes = diagnoseFile(root, file).map(item => item.code)
  assert.ok(codes.includes('TS2322') && codes.includes('TS2345'), `fixture: ${codes}`)
  const first = buildNarrowContext(root, file)!
  assert.equal(first.target.target.code, 'TS2345', 'the TS2322 on the earlier line is not targeted first')
  assert.deepEqual(first.patchRange, { start: 3, end: 3 })
  const fixed = evaluatePatch(root, file, { startLine: 3, endLine: 3, replacement: 'tags: string[]' })
  assert.ok(fixed.ok, fixed.ok ? '' : fixed.error)
  if (fixed.ok) writeFileSync(path.join(root, file), fixed.content)
  assert.equal(buildNarrowContext(root, file)!.target.target.code, 'TS2322', 'only then is the TS2322 targeted')
  // an upstream diagnostic that is stuck stops the repair; the downstream one is not tried in its place
  const stuck = 'stuck.ts'
  writeFileSync(path.join(root, stuck), ["export function g(id: string) {", "  const early: number = 'x'", '  const box: { tags: [] } = { tags: [] }', '  box.tags.push(id)', '  return early + box.tags.length', '}', ''].join('\n'))
  for (let i = 0; i < MAX_TRIES_PER_TARGET; i++) evaluatePatch(root, stuck, { startLine: 3, endLine: 3, replacement: 'tags: []' })
  assert.equal(repairStagnant(root, stuck).stagnant, true)
  ok('TS2322 is deferred behind upstream diagnostics, targeted only after they clear, and not reached past a stuck upstream one')
}

// 12. the empty-array type may sit outside the callback that pushes into it (reduce seed type vs. reduce callback): the whole outer function is searched.
{
  const file = 'reducebucket.ts'
  const text = ['export type Item = { id: string; group: string }', 'export function bucket(items: Item[]) {', '  return Object.values(', '    items.reduce((acc, item) => {', '      if (!acc[item.group]) {', '        acc[item.group] = { group: item.group, ids: [] }', '      }', '      acc[item.group].ids.push(item.id)', '      return acc', '    }, {} as Record<string, { group: string; ids: [] }>)', '  )', '}', ''].join('\n')
  writeFileSync(path.join(root, file), text)
  const diags = diagnoseFile(root, file)
  const push = diags.find(item => item.code === 'TS2345' && /type 'never'/.test(item.message))!
  assert.ok(push, `fixture: ${diags.map(item => item.code)}`)
  const cause = emptyArrayRoot(text, push)!
  assert.equal(cause.emptyArray.declaration, 'type')
  assert.deepEqual(cause.range, { start: 10, end: 10 }, 'the declared type (line 10), not the value literal (line 6)')
  const outcome = evaluatePatch(root, file, { startLine: 10, endLine: 10, replacement: 'ids: string[]' })
  assert.ok(outcome.ok, outcome.ok ? '' : outcome.error)
  ok('never[] declaration outside the pushing callback is found: the declared type is the writable range')
}

// 13. a TS2322 that elaborates to one incompatible property is repaired at the expression that produces it, as a fragment.
{
  const file = 'prop.ts'
  const text = ["export type Row = { state: 'A' | 'B'; label: string }", 'export function rows(items: { state: string; label: string }[]): { groups: Row[] } {', '  const note = items.length', "  return { groups: items.map(item => ({ ...item, state: item.state || 'A' })) }", '}', ''].join('\n')
  writeFileSync(path.join(root, file), text)
  const diags = diagnoseFile(root, file)
  const diag = diags.find(item => item.code === 'TS2322')!
  assert.ok(diag && /Types of property 'state' are incompatible/.test(diag.message), `fixture: ${diags.map(item => item.message).join(' | ')}`)
  const cause = propertyExpressionRoot(text, diag)!
  assert.ok(cause, 'one property assignment named state inside the returned value')
  assert.deepEqual(cause.range, { start: 4, end: 4 })
  assert.equal(cause.property.current, "state: item.state || 'A'")
  assert.equal(cause.property.expected, '"A" | "B"')
  const context = buildNarrowContext(root, file)!
  assert.ok(context.text.includes('REPLACE EXACTLY THIS TEXT') && context.text.includes('EXPECTED TYPE') && context.text.includes('CURRENT EXPRESSION:\nitem.state || \'A\'') && context.text.includes('SMALLEST VALID REPAIRS') && context.text.includes('local type assertion'), 'property mismatch prompt carries found/expected/current and the repair options')
  assert.ok(!/Row\b/.test(context.text.split('SMALLEST VALID REPAIRS')[1]?.split('\n').slice(0, 5).join('\n') ?? ''), 'the guidance is generic: it does not name the answer')
  const bad = evaluatePatch(root, file, { startLine: 4, endLine: 4, replacement: "state: item.state || 'A'" })
  assert.equal(bad.ok, false, 'unchanged fragment is NO_CHANGE')
  // after the one narrow try the same diagnostic is offered at statement level (escalation ladder), whole line
  const wider = buildNarrowContext(root, file)!
  assert.equal(wider.target.cause, null)
  const fixed = evaluatePatch(root, file, { startLine: wider.patchRange.start, endLine: wider.patchRange.end, replacement: "  return { groups: items.map(item => ({ ...item, state: (item.state === 'B' ? 'B' : 'A') as Row['state'] })) }" })
  assert.ok(fixed.ok, fixed.ok ? '' : fixed.error)
  if (fixed.ok) {
    const before = text.split('\n')
    const after = fixed.content.split('\n')
    assert.equal(after.filter((line, i) => line !== before[i]).length, 1, 'only that line changed')
    assert.ok(after[3].startsWith('  return { groups: items.map(item => ({ ...item, state: ('), 'the rest of the line is preserved by the splice')
    writeFileSync(path.join(root, file), fixed.content)
    assert.equal(diagnoseFile(root, file).length, 0)
  }
  ok('incompatible-property TS2322: the producing expression is the only writable fragment; spliced; clean')
}

// 14. compiler-named one-token defects are repaired as a spliced token: misspelt name, default import of named exports, member read off a default import.
{
  writeFileSync(path.join(root, 'tokmod.ts'), 'export type Widget = { id: string }\nexport const makeWidget = (id: string): Widget => ({ id })\nexport class Box { static open(): string { return "o" } }\n')
  // misspelt property
  const spell = 'spell.ts'
  const spellText = ['export function f(jobs: { claims: string[] }[]) {', '  return jobs.map(job => job.claim.length)', '}', ''].join('\n')
  writeFileSync(path.join(root, spell), spellText)
  const d1 = diagnoseFile(root, spell).find(item => item.code === 'TS2551')!
  assert.ok(d1, 'fixture: did-you-mean diagnostic')
  const t1 = tokenFixRoot(spellText, d1)!
  assert.equal(t1.token.text, 'claim')
  assert.equal(t1.token.suggestion, 'claims')
  const o1 = evaluatePatch(root, spell, { startLine: 2, endLine: 2, replacement: 'claims' })
  assert.ok(o1.ok, o1.ok ? '' : o1.error)
  if (o1.ok) assert.equal(o1.content.split('\n').filter((line, i) => line !== spellText.split('\n')[i]).length, 1)
  // default import where only named exports exist
  const def = 'defimp.ts'
  const defText = ["import makeWidget from './tokmod'", 'export const w = makeWidget("a")', ''].join('\n')
  writeFileSync(path.join(root, def), defText)
  const d2 = diagnoseFile(root, def).find(item => item.code === 'TS2613')
  assert.ok(d2, `fixture: ${diagnoseFile(root, def).map(item => item.code)}`)
  const t2 = tokenFixRoot(defText, d2)!
  assert.equal(t2.token.text, 'makeWidget')
  assert.equal(t2.token.suggestion, '{ makeWidget }')
  const o2 = evaluatePatch(root, def, { startLine: 1, endLine: 1, replacement: '{ makeWidget }' })
  assert.ok(o2.ok, o2.ok ? '' : o2.error)
  // a member read off a default import that is really a named export
  const ns = 'nsimp.ts'
  const nsText = ["import Box from './tokmod'", 'export const v = Box.open()', ''].join('\n')
  writeFileSync(path.join(root, ns), nsText)
  const d3 = diagnoseFile(root, ns).find(item => item.code === 'TS2339')
  if (d3) {
    const t3 = tokenFixRoot(nsText, d3)
    assert.ok(t3 && t3.token.text === 'Box' && t3.token.suggestion === '{ Box }', 'default-import member misuse targets the import binding')
  }
  // anything else is not a token fix
  assert.equal(tokenFixRoot("export const a: number = 'x'\n", { file: 'x', line: 1, col: 14, code: 'TS2322', message: "Type 'string' is not assignable to type 'number'.", syntactic: false }), null)
  ok('token fixes: did-you-mean name, default->named import, default-import member misuse; the fragment is only the token, spliced')
}

// 15. escalation ladder: a compiler-suggested token that is only half the fix gets one wider statement retry; echoed line text and multi-line fragments are handled.
{
  const file = 'ladder.ts'
  const text = ['export function f(jobs: { claims: string[] }[]) {', "  return jobs.some(job => job.claim.startsWith('P'))", '}', ''].join('\n')
  writeFileSync(path.join(root, file), text)
  const first = buildNarrowContext(root, file)!
  assert.equal(first.target.cause?.kind, 'TOKEN_FIX')
  assert.ok(first.text.includes('COMPILER SUGGESTS:\nclaims'))
  // the name is corrected but the type is wrong: a new error kind, so the strict rule rejects it
  const half = evaluatePatch(root, file, { startLine: 2, endLine: 2, replacement: 'claims' })
  assert.equal(half.ok, false)
  assert.ok(!half.ok && /new kind of error/.test(half.error), half.ok ? '' : half.error)
  // the retry is the statement itself, no narrower range
  const retry = buildNarrowContext(root, file)!
  assert.equal(retry.target.cause, null, 'the narrow range is not offered again')
  assert.equal(retry.target.attempt, 0, 'the statement the compiler points at, not a declaration')
  assert.deepEqual(retry.patchRange, { start: 2, end: 2 })
  const fixed = evaluatePatch(root, file, { startLine: retry.patchRange.start, endLine: retry.patchRange.end, replacement: "  return jobs.some(job => job.claims.some(claim => claim.startsWith('P')))" })
  assert.ok(fixed.ok, fixed.ok ? '' : fixed.error)
  // echoed surrounding text on the line is dropped, a multi-line fragment is allowed
  const imp = 'echo.ts'
  const impText = ["import makeWidget from './tokmod'", 'export const w = makeWidget("a")', ''].join('\n')
  writeFileSync(path.join(root, imp), impText)
  const echoed = evaluatePatch(root, imp, { startLine: 1, endLine: 1, replacement: "import { makeWidget } from './tokmod'" })
  assert.ok(echoed.ok && echoed.content.split('\n')[0] === "import { makeWidget } from './tokmod'", 'a whole-line reply is reduced to the fragment')
  const seed = 'multiseed.ts'
  const seedText = ['export function g(ids: string[]) {', '  return ids.reduce((acc, id) => {', '    acc[id] = [id]', '    return acc', '  }, {})', '}', ''].join('\n')
  writeFileSync(path.join(root, seed), seedText)
  const multi = evaluatePatch(root, seed, { startLine: 5, endLine: 5, replacement: '{} as Record<\n  string,\n  string[]\n>' })
  assert.ok(multi.ok, multi.ok ? '' : multi.error)
  ok('escalation ladder retries a half-right token at statement level; echoed line text is dropped; multi-line fragments are accepted')
}

// 16. partial punctuation echoes around a fragment are dropped only when that balances it; legitimate brackets are never removed.
{
  assert.equal(stripEchoedPunctuation('{} as Record<string, string[]>)', '  }, ', ');'), '{} as Record<string, string[]>', 'a trailing ) that the line already has is dropped')
  assert.equal(stripEchoedPunctuation('}, {} as Record<string, string[]>', '  }, ', ');'), '{} as Record<string, string[]>', 'a leading }, that the line already has is dropped')
  assert.equal(stripEchoedPunctuation('foo(a, b)', '  x = ', ';'), 'foo(a, b)', 'a balanced fragment is left alone')
  assert.equal(stripEchoedPunctuation('make(a', '  x = ', ');'), 'make(a', 'when removing an echo would not balance it, nothing is removed')
  const seed = 'echoseed.ts'
  const seedText = ['export function h(ids: string[]) {', '  return Object.values(ids.reduce((acc, id) => {', '    acc[id] = [id]', '    return acc', '  }, {}))', '}', ''].join('\n')
  writeFileSync(path.join(root, seed), seedText)
  const outcome = evaluatePatch(root, seed, { startLine: 5, endLine: 5, replacement: '{} as Record<string, string[]>))' })
  assert.ok(outcome.ok, outcome.ok ? '' : outcome.error)
  if (outcome.ok) assert.equal(outcome.content.split('\n')[4], '  }, {} as Record<string, string[]>))', 'the line keeps its own closing punctuation exactly once')
  ok('echoed surrounding punctuation is dropped only when it balances the fragment')
}

// 17. an accumulator that is filled with empty arrays: the prompt explains the element type instead of showing the literal [].
{
  const file = 'evid.ts'
  const text = ['export type Rec = { criterion: string; at: number }', 'export function group(records: Rec[]) {', '  const grouped = records.reduce((acc, record) => {', '    if (!acc[record.criterion]) {', '      acc[record.criterion] = []', '    }', '    acc[record.criterion].push(record)', '    return acc', '  }, {})', '  return grouped', '}', ''].join('\n')
  writeFileSync(path.join(root, file), text)
  const context = buildNarrowContext(root, file)!
  assert.equal(context.target.cause?.kind, 'ACCUMULATOR_SEED')
  assert.ok(context.text.includes('starts empty and is filled by push') && context.text.includes('never write `[]` as a type'), 'the empty-tuple trap is named')
  assert.ok(context.text.includes('TYPE OF ONE ITEM BEING REDUCED') && context.text.includes('(typeof records)[number]'))
  const outcome = evaluatePatch(root, file, { startLine: 9, endLine: 9, replacement: '{} as Record<string, (typeof records)[number][]>' })
  assert.ok(outcome.ok, outcome.ok ? '' : outcome.error)
  ok('accumulator prompt: empty array literal explained, ready element type supplied, and that type is accepted')
}

// 18. errors a fix merely UNMASKS elsewhere are tolerated only with a net gain; TS7015 on a wrongly typed seed; an import from a module that does not export the name.
{
  const file = 'unmask.ts'
  const text = ['export type Rec = { criterion: string; at: string }', 'export function g(records: Rec[]) {', '  const grouped = records.reduce((acc, record) => {', '    if (!acc[record.criterion]) { acc[record.criterion] = [] }', '    acc[record.criterion].push(record)', '    return acc', '  }, {})', '  return Object.values(grouped).map(list => list.sort((a: { at: number }, b: { at: number }) => a.at - b.at))', '}', ''].join('\n')
  writeFileSync(path.join(root, file), text)
  const before = diagnoseFile(root, file)
  assert.ok(before.length >= 4, `fixture: ${before.map(item => item.code)}`)
  const context = buildNarrowContext(root, file)!
  assert.equal(context.target.cause?.kind, 'ACCUMULATOR_SEED')
  const outcome = evaluatePatch(root, file, { startLine: 7, endLine: 7, replacement: '{} as Record<string, Rec[]>' })
  assert.ok(outcome.ok, `unmasked errors elsewhere with a net gain are accepted: ${outcome.ok ? '' : outcome.error}`)
  if (outcome.ok) {
    assert.ok(outcome.after < outcome.before)
    assert.ok(/now visible elsewhere/.test(outcome.summary), 'the summary says so, nothing is hidden')
  }
  // the patch's own text creating a new kind of error is still rejected (test 10D); so is a new kind with no net gain
  const noGain = 'nogain.ts'
  const noGainText = ['export type Rec = { criterion: string; at: string }', 'export function k(records: Rec[]) {', '  const grouped = records.reduce((acc, record) => {', '    acc[record.criterion] = record', '    return acc', '  }, {})', '  return Object.values(grouped).map(r => r.nope)', '}', ''].join('\n')
  writeFileSync(path.join(root, noGain), noGainText)
  const noGainDiags = diagnoseFile(root, noGain)
  assert.deepEqual(noGainDiags.map(item => item.code).sort(), ['TS18046', 'TS7053'], 'fixture: one error to fix, one hidden behind it')
  const revealedAsMany = evaluatePatch(root, noGain, { startLine: 6, endLine: 6, replacement: '{} as Record<string, Rec>' })
  assert.equal(revealedAsMany.ok, false, 'revealing as many errors as it removes is no gain: rejected')
  assert.ok(!revealedAsMany.ok && /new kind of error/.test(revealedAsMany.error))
  assert.equal(readFileSync(path.join(root, noGain), 'utf8'), noGainText, 'checkpoint intact')

  const arr = 'arrseed.ts'
  const arrText = ['export type Rec = { criterion: string; at: string }', 'export function h(records: Rec[]) {', '  return records.reduce((acc, record) => {', '    acc[record.criterion] = record', '    return acc', '  }, {} as Rec[])', '}', ''].join('\n')
  writeFileSync(path.join(root, arr), arrText)
  const d7015 = diagnoseFile(root, arr).find(item => item.code === 'TS7015')!
  assert.ok(d7015, `fixture: ${diagnoseFile(root, arr).map(item => item.code)}`)
  const seed = accumulatorRoot(arrText, d7015, diagnoseFile(root, arr))!
  assert.ok(seed && seed.seed.start === 6, 'a typed-but-wrong seed is the cause of TS7015')
  const fixedSeed = evaluatePatch(root, arr, { startLine: 6, endLine: 6, replacement: '{} as Record<string, Rec>' })
  assert.ok(fixedSeed.ok, fixedSeed.ok ? '' : fixedSeed.error)

  writeFileSync(path.join(root, 'misa.ts'), 'type McX = { id: string }\nexport const misaValue: McX = { id: "a" }\n')
  writeFileSync(path.join(root, 'misb.ts'), 'export type McX = { id: string }\n')
  const mis = 'misuse.ts'
  const misText = ["import { McX } from './misa'", 'export const v: McX = { id: "b" }', ''].join('\n')
  writeFileSync(path.join(root, mis), misText)
  const d2459 = diagnoseFile(root, mis).find(item => item.code === 'TS2459')!
  assert.ok(d2459, `fixture: ${diagnoseFile(root, mis).map(item => item.code)}`)
  const move = misimportRoot(root, mis, misText, d2459)!
  assert.ok(move && move.importRoot.mode === 'MOVE' && move.importRoot.spec === './misb', 'the one module that exports the name is found')
  const moved = evaluatePatch(root, mis, { startLine: 1, endLine: 1, replacement: "import type { McX } from './misb'" })
  assert.ok(moved.ok, moved.ok ? '' : moved.error)
  ok('unmasked errors tolerated only with a net gain and outside the patched lines; TS7015 seed; wrong-module import')
}

// 19. a member that does not exist on an object type: the model is given the type's real members and returns only the corrected access expression.
{
  const file = 'member.ts'
  const text = ['export type Src = { tasks: { id: string }[]; jobs: { name: string }[]; now: number }', 'export function ids(source: Src) {', '  return source.map(task => task.id)', '}', ''].join('\n')
  writeFileSync(path.join(root, file), text)
  const diag = diagnoseFile(root, file).find(item => item.code === 'TS2339')!
  assert.ok(diag, 'fixture: TS2339')
  const cause = memberAccessRoot(root, file, text, diag)!
  assert.ok(cause, 'the receiver type is resolved')
  assert.equal(cause.member.expression, 'source', 'an array method is missing: the receiver is the fragment and the .map after it stays')
  assert.equal(cause.member.keepsMethod, true)
  assert.deepEqual(cause.member.members.map(item => item.split(':')[0]), ['tasks', 'jobs', 'now'])
  const context = buildNarrowContext(root, file)!
  assert.equal(context.target.cause?.kind, 'MEMBER_ACCESS')
  assert.ok(context.text.includes('The `.map` after it stays') && context.text.includes('WITHOUT `.map`') && context.text.includes('REAL MEMBERS OF Src') && context.text.includes('tasks: { id: string; }[]') && context.text.includes('REPLACE EXACTLY THIS TEXT'))
  const fixed = evaluatePatch(root, file, { startLine: 3, endLine: 3, replacement: 'source.tasks' })
  assert.ok(fixed.ok, fixed.ok ? '' : fixed.error)
  if (fixed.ok) { writeFileSync(path.join(root, file), fixed.content); assert.equal(diagnoseFile(root, file).length, 0) }
  // nested search: the thing asked for lives one or two levels down
  const deep = 'deep.ts'
  const deepText = ['export type State = { graph: { tasks: { id: string }[] }; failures: Record<string, number> | null }', 'export type Src = { now: number; state: State | null }', 'export function f(source: Src) {', '  return source.map(task => task.id)', '}', 'export function g(source: Src) {', '  return source.failures', '}', ''].join('\n')
  writeFileSync(path.join(root, deep), deepText)
  const deepDiags = diagnoseFile(root, deep).filter(item => item.code === 'TS2339')
  assert.equal(deepDiags.length, 2, `fixture: ${deepDiags.length}`)
  const mapCause = memberAccessRoot(root, deep, deepText, deepDiags[0])!
  assert.ok(mapCause.member.nested.some(item => item.startsWith('source.state?.graph.tasks')), `array-typed member found three levels down, null-aware: ${mapCause.member.nested}`)
  const failCause = memberAccessRoot(root, deep, deepText, deepDiags[1])!
  assert.ok(failCause.member.nested.some(item => item.startsWith('source.state?.failures')), `exact name found one level down: ${failCause.member.nested}`)
  const deepContext = buildNarrowContext(root, deep)!
  assert.ok(deepContext.text.includes('MEMBER PATHS THAT MATCH') && deepContext.text.includes('source.state?.graph.tasks'))
  // not for module namespaces or non-TS2339
  assert.equal(memberAccessRoot(root, file, text, { ...diag, code: 'TS2322' }), null)
  ok('member access: real members of the receiver type are listed; only the access expression is writable and spliced')
}

// 20. the wider retry is told why the narrow edit was rejected; unknown object-literal properties list the type's own property names.
{
  const file = 'noted.ts'
  const text = ['export type S = { state: { items: { id: string }[] } | null }', 'export function f(s: S) {', '  return s.map((x: { id: number }) => x.id)', '}', ''].join('\n')
  writeFileSync(path.join(root, file), text)
  const first = buildNarrowContext(root, file)!
  assert.equal(first.target.cause?.kind, 'MEMBER_ACCESS')
  // Paired repair: the receiver is right but the callback's annotation conflicts with the real item type. Both edits are one root cause.
  const pairedText = ['export type S = { state: { items: { id: string }[] } | null }', 'export function f(s: S, other: { id: number }[]) {', '  const ids = other.map((o: { id: number }) => o.id)', '  return s.map((x: { id: number }) => ({ id: x.id, tags: ids.map((i: number) => i) }))', '}', ''].join('\n')
  writeFileSync(path.join(root, file), pairedText)
  const before = diagnoseFile(root, file)
  const ctx = buildNarrowContext(root, file)!
  assert.equal(ctx.target.cause?.kind, 'MEMBER_ACCESS')
  assert.equal(ctx.target.cause?.kind === 'MEMBER_ACCESS' ? ctx.target.cause.member.callbackAnnotations.length : -1, 1, 'only the annotation of the callback passed to this method is in scope')
  const outcome = evaluatePatch(root, file, { startLine: ctx.patchRange.start, endLine: ctx.patchRange.end, replacement: 's.state?.items' })
  assert.ok(outcome.ok, `paired repair accepted: ${outcome.ok ? '' : outcome.error}`)
  if (outcome.ok) {
    assert.ok(outcome.after < outcome.before && /paired repair/.test(outcome.summary), outcome.summary)
    const out = outcome.content.split('\n')
    const orig = pairedText.split('\n')
    assert.equal(out[2], orig[2], 'an unrelated callback annotation elsewhere is untouched')
    assert.ok(out[3].includes('s.state?.items.map((x) =>') && out[3].includes('ids.map((i: number) => i)'), `only this callback's annotation went, the nested one stays: ${out[3]}`)
    assert.deepEqual(out.filter((line, i) => line !== orig[i]).length, 1, 'one line changed')
    writeFileSync(path.join(root, file), outcome.content)
    assert.equal(diagnoseFile(root, file).length, 0, 'syntax valid and clean')
  }
  assert.ok(before.length >= 1)

  // Not paired when the model's edit alone is already acceptable: an annotation that does NOT conflict is left alone.
  const plain = 'plainmember.ts'
  const plainText = ['export type S = { items: { id: string }[] }', 'export function f(s: S) {', '  return s.map((x: { id: string }) => x.id)', '}', ''].join('\n')
  writeFileSync(path.join(root, plain), plainText)
  const plainCtx = buildNarrowContext(root, plain)!
  assert.equal(plainCtx.target.cause?.kind, 'MEMBER_ACCESS')
  const plainOut = evaluatePatch(root, plain, { startLine: plainCtx.patchRange.start, endLine: plainCtx.patchRange.end, replacement: 's.items' })
  assert.ok(plainOut.ok, plainOut.ok ? '' : plainOut.error)
  if (plainOut.ok) {
    assert.ok(!/paired/.test(plainOut.summary), 'the model edit alone was enough: no pairing')
    assert.ok(plainOut.content.includes('(x: { id: string })'), 'the non-conflicting annotation stays')
  }


  // The model repeats the whole statement (including the method that stays): the receiver in front of `.map` is recovered, nothing else is taken from the echo.
  const echo = 'echomember.ts'
  const echoText = ['export type S = { state: { items: { id: string }[] } | null }', 'export function f(s: S) {', '  const ids = s.map((x: { id: number }) => x.id)', '  return ids', '}', ''].join('\n')
  writeFileSync(path.join(root, echo), echoText)
  const echoCtx = buildNarrowContext(root, echo)!
  const echoed = evaluatePatch(root, echo, { startLine: echoCtx.patchRange.start, endLine: echoCtx.patchRange.end, replacement: '  const ids = s.state?.items.map((x: { id: number }) => x.id)' })
  assert.ok(echoed.ok && /paired repair/.test(echoed.summary), echoed.ok ? echoed.summary : echoed.error)
  if (echoed.ok) assert.equal(echoed.content.split('\n')[2], '  const ids = s.state?.items.map((x) => x.id)')

  // An access that is CALLED like a function where the real member is an array: the prompt says the answer must end with an array method.
  const calledFile = 'calledmember.ts'
  const calledText = ['export type S = { mission: { id: string }; state: { evidence: { id: string }[] } | null }', 'export function f(s: S) {', '  return s.mission.evidence((e: { id: string }) => e.id)', '}', ''].join('\n')
  writeFileSync(path.join(root, calledFile), calledText)
  const calledCtx = buildNarrowContext(root, calledFile)!
  assert.ok(calledCtx.text.includes('this access is CALLED with (...)') && calledCtx.text.includes('end with an array method'), 'the called-collection trap is named')
  const calledFixed = evaluatePatch(root, calledFile, { startLine: calledCtx.patchRange.start, endLine: calledCtx.patchRange.end, replacement: 's.state?.evidence.map' })
  assert.ok(calledFixed.ok, calledFixed.ok ? '' : calledFixed.error)

  // The called collection's callback carries an annotation that conflicts with the real item type: completion + annotation cleanup are one root cause.
  const calledNote = 'calledannot.ts'
  const calledNoteText = ['export type S = { mission: { id: string }; state: { evidence: { id: string; n: number }[] } | null }', 'export function f(s: S, other: { id: string }[]) {', '  const keep = other.map((o: { id: string }) => o.id)', '  return s.mission.evidence((e: { id: string; n: string }) => ({ id: e.id, keep }))', '}', ''].join('\n')
  writeFileSync(path.join(root, calledNote), calledNoteText)
  const calledNoteCtx = buildNarrowContext(root, calledNote)!
  const completed = evaluatePatch(root, calledNote, { startLine: calledNoteCtx.patchRange.start, endLine: calledNoteCtx.patchRange.end, replacement: 's.state?.evidence' })
  assert.ok(completed.ok, completed.ok ? '' : completed.error)
  if (completed.ok) {
    assert.ok(/collection call/.test(completed.summary) && /annotation/.test(completed.summary), completed.summary)
    const out = completed.content.split('\n')
    assert.equal(out[2], calledNoteText.split('\n')[2], 'an unrelated callback annotation is untouched')
    assert.ok(out[3].includes('s.state?.evidence.map((e) =>'), out[3])
  }

  // A worse or wrong candidate is rejected and the checkpoint stays intact: the pairing only helps when it makes the combination acceptable.
  const wrong = 'wrongmember.ts'
  const wrongText = ['export type S = { state: { items: { id: string }[] } | null; label: string }', 'export function f(s: S) {', '  return s.map((x: { id: number }) => x.id)', '}', ''].join('\n')
  writeFileSync(path.join(root, wrong), wrongText)
  const wrongCtx = buildNarrowContext(root, wrong)!
  const wrongOut = evaluatePatch(root, wrong, { startLine: wrongCtx.patchRange.start, endLine: wrongCtx.patchRange.end, replacement: 's.label' })
  assert.equal(wrongOut.ok, false, 'a wrong receiver is not rescued by removing the annotation')
  assert.equal(readFileSync(path.join(root, wrong), 'utf8'), wrongText, 'checkpoint intact')

  const lit = 'literal.ts'
  const litText = ['export const unused = 1', 'export const job: { jobId: string; startedAt: string; state: string } = {', "  jobId: 'a',", "  started: 'now',", "  state: 'x',", '}', ''].join('\n')
  writeFileSync(path.join(root, lit), litText)
  const d2561 = diagnoseFile(root, lit).find(item => item.code === 'TS2561')
  assert.ok(d2561, `fixture: ${diagnoseFile(root, lit).map(item => item.code)}`)
  const tok = tokenFixRoot(litText, d2561)!
  assert.ok(tok && tok.token.text === 'started' && /^startedAt\s+\(the type's own property whose name is closest/.test(tok.token.suggestion) && /jobId, startedAt, state/.test(tok.token.suggestion), `the type's own properties are listed: ${tok?.token.suggestion}`)
  const fixedLit = evaluatePatch(root, lit, { startLine: 4, endLine: 4, replacement: 'startedAt' })
  assert.ok(fixedLit.ok, fixedLit.ok ? '' : fixedLit.error)
  ok('wider retry carries the narrow rejection reason; unknown object-literal property lists the type properties')
}

// 21. paired value-shape repair: name and value change together; collection call completed with the method that fits the callback.
{
  // coercions the found/expected pair proves (and nothing else)
  assert.equal(coerceValue('now', 'number', 'string'), 'String(now)')
  assert.equal(coerceValue('raw', 'string', 'number'), 'Number(raw)')
  assert.equal(coerceValue('list', 'string[] | undefined', 'string[]'), 'list ?? []')
  assert.equal(coerceValue('a.b', 'string | undefined', 'string'), "a.b ?? ''")
  assert.equal(coerceValue('a + b', 'number | undefined', 'number'), '(a + b) ?? 0')
  assert.equal(coerceValue('x', 'Foo | undefined', 'Foo'), null, 'no definite default for an object type: no correction')
  assert.equal(coerceValue('x', 'boolean', 'string'), null)

  // number -> string: the rename is the model's edit, the value must change with it (name + value together)
  const lit = 'pairlit.ts'
  const litText = ['export const now = 5', 'export const job: { jobId: string; startedAt: string; state: string } = {', "  jobId: 'a',", '  started: now,', "  state: 'x',", '}', ''].join('\n')
  writeFileSync(path.join(root, lit), litText)
  const nameOnly = evaluatePatch(root, lit, { startLine: 4, endLine: 4, replacement: 'startedAt' })
  assert.ok(nameOnly.ok, `rename + String(...) accepted together: ${nameOnly.ok ? '' : nameOnly.error}`)
  if (nameOnly.ok) {
    const out = nameOnly.content.split('\n')
    assert.equal(out[3], '  startedAt: String(now),')
    assert.deepEqual(out.filter((line, i) => line !== litText.split('\n')[i]).length, 1, 'unrelated properties are untouched')
    assert.ok(/paired value repair/.test(nameOnly.summary))
    writeFileSync(path.join(root, lit), nameOnly.content)
    assert.equal(diagnoseFile(root, lit).length, 0)
  }
  // worse / syntax-breaking candidates are rejected and the checkpoint stays intact
  writeFileSync(path.join(root, lit), litText)
  const worse = evaluatePatch(root, lit, { startLine: 4, endLine: 4, replacement: 'startedAt: missingName' })
  assert.equal(worse.ok, false)
  const broken = evaluatePatch(root, lit, { startLine: 4, endLine: 4, replacement: 'startedAt:' })
  assert.equal(broken.ok, false)
  assert.ok(!broken.ok && /syntax|PATCH_REJECTED/.test(broken.error))
  assert.equal(readFileSync(path.join(root, lit), 'utf8'), litText, 'checkpoint intact')

  // T | undefined -> T where the contract needs a definite value: the model names the right property but leaves the value
  const optional = 'pairopt.ts'
  const optionalText = ['export function f(list: string[] | undefined): { ids: string[]; label: string } {', '  const ids = list', "  return { ids, label: 'x' }", '}', ''].join('\n')
  writeFileSync(path.join(root, optional), optionalText)
  const d = diagnoseFile(root, optional).find(item => item.code === 'TS2322')!
  assert.ok(d, 'fixture: TS2322 on a shorthand property')
  const shape = valueShapeRoot(optionalText, d)!
  assert.ok(shape && shape.value.shorthand && shape.value.found === 'string[] | undefined' && shape.value.expected === 'string[]')
  const ctx = buildNarrowContext(root, optional)!
  assert.equal(ctx.target.cause?.kind, 'VALUE_SHAPE')
  for (const part of ['FOUND TYPE:\nstring[] | undefined', 'EXPECTED TYPE:\nstring[]', 'CURRENT PROPERTY:\nids', 'CURRENT VALUE EXPRESSION:\nids', 'do not leave undefined/null possible']) assert.ok(ctx.text.includes(part), `prompt carries ${part}`)
  const fixed = evaluatePatch(root, optional, { startLine: ctx.patchRange.start, endLine: ctx.patchRange.end, replacement: 'ids' })
  assert.ok(fixed.ok, `unchanged model value + proven correction accepted: ${fixed.ok ? '' : fixed.error}`)
  if (fixed.ok) {
    assert.equal(fixed.content.split('\n')[2], "  return { ids: ids ?? [], label: 'x' }")
    assert.deepEqual(fixed.content.split('\n').filter((line, i) => line !== optionalText.split('\n')[i]).length, 1)
  }

  // a model-authored value that is already right needs no executive help
  const optionalDirect = 'pairoptdirect.ts'
  writeFileSync(path.join(root, optionalDirect), optionalText)
  const directCtx = buildNarrowContext(root, optionalDirect)!
  const direct = evaluatePatch(root, optionalDirect, { startLine: directCtx.patchRange.start, endLine: directCtx.patchRange.end, replacement: 'ids: ids ?? []' })
  assert.ok(direct.ok && !/paired/.test(direct.summary))

  // collection call: the model finds the collection, the method that fits the callback completes it
  const called = 'calledpair.ts'
  const calledText = ['export type S = { mission: { id: string }; state: { evidence: { id: string }[] } | null }', 'export function f(s: S) {', '  const ids = s.mission.evidence(e => ({ id: e.id }))', '  const hits = s.mission.evidence(e => e.id === "x")', '  return [ids, hits]', '}', ''].join('\n')
  writeFileSync(path.join(root, called), calledText)
  const callCtx = buildNarrowContext(root, called)!
  assert.equal(callCtx.target.cause?.kind, 'MEMBER_ACCESS')
  assert.ok(callCtx.text.includes('COLLECTION CALL') && callCtx.text.includes('builds a new value from each item') && callCtx.text.includes('map, flatMap, forEach'))
  const mapped = evaluatePatch(root, called, { startLine: callCtx.patchRange.start, endLine: callCtx.patchRange.end, replacement: 's.state?.evidence' })
  assert.ok(mapped.ok && /collection call: the model's path was completed with \.map/.test(mapped.summary), mapped.ok ? mapped.summary : mapped.error)
  if (mapped.ok) { writeFileSync(path.join(root, called), mapped.content) }
  const callCtx2 = buildNarrowContext(root, called)!
  assert.ok(callCtx2.text.includes('answers a yes/no question about each item') && callCtx2.text.includes('filter, find, some, every'))
  const filtered = evaluatePatch(root, called, { startLine: callCtx2.patchRange.start, endLine: callCtx2.patchRange.end, replacement: 's.state?.evidence' })
  assert.ok(filtered.ok && /\.filter/.test(filtered.summary), filtered.ok ? filtered.summary : filtered.error)
  ok('paired value repair (number->string with the rename, T|undefined->T, unchanged value + proven correction), unrelated untouched, worse/syntax rejected, collection call completed with the fitting method')
}

// 22. corrupted (CJK / full-width) output is never an edit; legitimate non-ASCII text that the file already had is not touched.
{
  assert.equal(strayCharacterCount('needsCommand印象'), 2)
  assert.equal(introducesStrayCharacters('a.ts', 'const a = 1', 'const a\u5370 = 1'), true)
  assert.equal(introducesStrayCharacters('a.ts', "const t = '\u5370'", "const t = '\u5370'; const u = 2"), false, 'characters the file already had stay allowed')
  assert.equal(introducesStrayCharacters('a.json', 'x', 'x\u5370'), false, 'only source files')
  const file = 'stray.ts'
  const text = ['export const label = "ok"', "export const n: number = 'x'", ''].join('\n')
  writeFileSync(path.join(root, file), text)
  const bad = evaluatePatch(root, file, { startLine: 2, endLine: 2, replacement: 'export const n: number = 1; export const label\u5370 = 2' })
  assert.equal(bad.ok, false)
  assert.ok(!bad.ok && /stray non-code characters/.test(bad.error), bad.ok ? '' : bad.error)
  assert.equal(readFileSync(path.join(root, file), 'utf8'), text, 'checkpoint intact')
  ok('stray CJK characters are rejected as corrupted output; pre-existing text is untouched')
}

// 23. a stub that satisfies the type checker by deleting data is an error; it cannot be introduced by a repair and is repaired back to the real value.
{
  const stubbed = ['export function load(source: { items?: string[] }) {', '  const tasks = source.items', '  const label = "x"', '  return { tasks: [], label }', '}', ''].join('\n')
  const found = stubDiagnose('s.ts', stubbed)
  assert.equal(found.length, 1)
  assert.ok(found[0].code === 'stub:EMPTY_VALUE' && found[0].line === 4 && /variable 'tasks' \(line 2\)/.test(found[0].message))
  // no false positives: the variable is used, or there is no such variable, or the property is not empty
  assert.deepEqual(stubDiagnose('s.ts', ['export function f(s: { items: string[] }) {', '  const tasks = s.items', '  console.log(tasks.length)', '  return { tasks: [] }', '}'].join('\n')), [])
  assert.deepEqual(stubDiagnose('s.ts', ['export function f() {', '  return { tasks: [] }', '}'].join('\n')), [])
  assert.deepEqual(stubDiagnose('s.ts', ['export function f(s: { items: string[] }) {', '  const tasks = s.items', '  return { tasks }', '}'].join('\n')), [])
  assert.deepEqual(stubDiagnose('s.json', stubbed), [])

  // the stub is repaired back to the real value (and the model is shown where it is)
  const file = 'stub.ts'
  writeFileSync(path.join(root, file), stubbed)
  assert.ok(diagnoseFile(root, file).length === 0, 'the compiler alone is satisfied: only the stub rule sees it')
  const ctx = buildNarrowContext(root, file)!
  assert.equal(ctx.target.cause?.kind, 'STUB_VALUE')
  assert.ok(ctx.text.includes('THE REAL VALUE (declared above and never used)') && ctx.text.includes('const tasks = source.items') && ctx.text.includes('REPLACE EXACTLY THIS TEXT'))
  const restored = evaluatePatch(root, file, { startLine: ctx.patchRange.start, endLine: ctx.patchRange.end, replacement: 'tasks' })
  assert.ok(restored.ok, restored.ok ? '' : restored.error)
  if (restored.ok) assert.equal(restored.content.split('\n')[3], '  return { tasks, label }')

  // creating a stub to silence a type error is rejected (a new kind of error, in the patched line) and the checkpoint stays intact
  const honest = 'honest.ts'
  const honestText = ['export function load(source: { items?: string[] }): { tasks: string[] } {', '  const tasks = source.items', '  return { tasks }', '}', ''].join('\n')
  writeFileSync(path.join(root, honest), honestText)
  const honestCtx = buildNarrowContext(root, honest)!
  assert.equal(honestCtx.target.cause?.kind, 'VALUE_SHAPE')
  const gamed = evaluatePatch(root, honest, { startLine: honestCtx.patchRange.start, endLine: honestCtx.patchRange.end, replacement: 'tasks: []' })
  assert.equal(gamed.ok, false, 'deleting the data to satisfy the type is not a fix')
  assert.equal(readFileSync(path.join(root, honest), 'utf8'), honestText, 'checkpoint intact')
  // the honest repair (a real default) is accepted
  const honest2 = 'honest2.ts'
  writeFileSync(path.join(root, honest2), honestText)
  const honest2Ctx = buildNarrowContext(root, honest2)!
  const fixed = evaluatePatch(root, honest2, { startLine: honest2Ctx.patchRange.start, endLine: honest2Ctx.patchRange.end, replacement: 'tasks: tasks ?? []' })
  assert.ok(fixed.ok, fixed.ok ? '' : fixed.error)
  void stubValueRoot
  ok('dropped-data stubs are errors: detected without false positives, repaired back to the real value, and never accepted as a fix')
}

// 24. a chain error reported at a property that only references a variable: the producing expression is found in that variable's declaration.
{
  const file = 'farprop.ts'
  const text = ["export type St = 'A' | 'B'", 'export function f(items: { state: string }[]): { rows: { state: St }[]; label: string } {', '  const rows = items.map(item => ({ state: item.state }))', "  return { rows: rows ?? [], label: 'x' }", '}', ''].join('\n')
  writeFileSync(path.join(root, file), text)
  const diag = diagnoseFile(root, file).find(item => item.code === 'TS2322')!
  assert.ok(diag && /Types of property 'state' are incompatible/.test(diag.message), 'fixture: a chain error reported at the returned property')
  const cause = propertyExpressionRoot(text, diag)!
  assert.ok(cause, 'the producing expression is found in the variable declaration')
  assert.deepEqual(cause.range, { start: 3, end: 3 }, 'line 3 (the declaration), not line 4 (where it is reported)')
  assert.equal(cause.property.current, 'state: item.state')
  const ctx = buildNarrowContext(root, file)!
  assert.deepEqual(ctx.patchRange, { start: 3, end: 3 })
  const fixed = evaluatePatch(root, file, { startLine: 3, endLine: 3, replacement: 'state: item.state as St' })
  assert.ok(fixed.ok, fixed.ok ? '' : fixed.error)
  if (fixed.ok) {
    assert.deepEqual(fixed.content.split('\n').filter((line, i) => line !== text.split('\n')[i]).length, 1, 'only the producing expression changed')
    writeFileSync(path.join(root, file), fixed.content)
    assert.equal(diagnoseFile(root, file).length, 0)
  }
  ok('chain error at a property that references a variable: the writable fragment is the producing expression in the declaration')
}

// 25. paired import: the model's edit is right but uses a name that is not imported; exactly one module defines it.
{
  writeFileSync(path.join(root, 'pairstates.ts'), "export type PairState = 'A' | 'B'\nexport type PairOther = number\n")
  writeFileSync(path.join(root, 'pairstates2.ts'), "export type PairShared = 'x'\n")
  writeFileSync(path.join(root, 'pairstates3.ts'), "export type PairShared = 'y'\n")
  const aug = 'pairaug.ts'
  const augText = ["import { PairOther } from './pairstates'", 'export function f(items: { state: string }[], n: PairOther): { rows: { state: \'A\' | \'B\' }[] } {', '  const rows = items.map(item => ({ state: item.state }))', '  return { rows: rows ?? [] }', '}', ''].join('\n')
  writeFileSync(path.join(root, aug), augText)
  const ctx = buildNarrowContext(root, aug)!
  assert.equal(ctx.target.cause?.kind, 'PROPERTY_EXPRESSION')
  const out = evaluatePatch(root, aug, { startLine: ctx.patchRange.start, endLine: ctx.patchRange.end, replacement: 'state: item.state as PairState' })
  assert.ok(out.ok, out.ok ? '' : out.error)
  if (out.ok) {
    assert.ok(/paired import: PairState/.test(out.summary), out.summary)
    const lines = out.content.split('\n')
    assert.ok(lines[0].includes('PairOther') && lines[0].includes('PairState') && lines.filter(line => line.startsWith('import')).length === 1, `the name joins the existing import: ${lines[0]}`)
    assert.equal(lines.filter((line, i) => line !== augText.split('\n')[i]).length >= 1, true)
    writeFileSync(path.join(root, aug), out.content)
    assert.equal(diagnoseFile(root, aug).length, 0)
  }
  // new import line when the module is not imported yet
  const add = 'pairadd.ts'
  const addText = ['export function f(items: { state: string }[]): { rows: { state: \'A\' | \'B\' }[] } {', '  const rows = items.map(item => ({ state: item.state }))', '  return { rows: rows ?? [] }', '}', ''].join('\n')
  writeFileSync(path.join(root, add), addText)
  const addCtx = buildNarrowContext(root, add)!
  const addOut = evaluatePatch(root, add, { startLine: addCtx.patchRange.start, endLine: addCtx.patchRange.end, replacement: 'state: item.state as PairState' })
  assert.ok(addOut.ok && addOut.content.split('\n')[0] === "import type { PairState } from './pairstates'", addOut.ok ? addOut.content.split('\n')[0] : addOut.error)
  // a name two modules define is ambiguous: no import is invented, the candidate is rejected and the checkpoint stays
  const amb = 'pairamb.ts'
  const ambText = ['export function f(items: { state: string }[]): { rows: { state: \'x\' }[] } {', '  const rows = items.map(item => ({ state: item.state }))', '  return { rows: rows ?? [] }', '}', ''].join('\n')
  writeFileSync(path.join(root, amb), ambText)
  const ambCtx = buildNarrowContext(root, amb)!
  const ambOut = evaluatePatch(root, amb, { startLine: ambCtx.patchRange.start, endLine: ambCtx.patchRange.end, replacement: "state: item.state as PairShared" })
  assert.equal(ambOut.ok, false)
  assert.equal(readFileSync(path.join(root, amb), 'utf8'), ambText)
  // an edit that creates some OTHER kind of error as well is not rescued by the import
  const mixed = 'pairmixed.ts'
  writeFileSync(path.join(root, mixed), addText)
  const mixedCtx = buildNarrowContext(root, mixed)!
  const mixedOut = evaluatePatch(root, mixed, { startLine: mixedCtx.patchRange.start, endLine: mixedCtx.patchRange.end, replacement: 'state: (item.state as PairState).nope' })
  assert.equal(mixedOut.ok, false)
  ok('paired import: the one defining module is imported (existing import augmented, or one new line); ambiguous names and mixed errors are rejected, checkpoint intact')
}

// 26. React state initialised with an empty literal: the root cause is the useState declaration, not each read.
{
  const HOOK = 'function useState<S>(initial: S): [S, (value: S) => void] { return [initial, () => undefined] }'
  // 1. useState([]) with downstream .map item properties
  const list = 'statelist.ts'
  const listText = [HOOK, 'export type Thing = { id: string; name: string; done: boolean }', 'export type Other = { label: string }', 'export function List() {', '  const [items, setItems] = useState([])', '  const [count, setCount] = useState(0)', "  setItems([{ id: 'a', name: 'n', done: false }])", '  setCount(1)', '  return items.map(item => item.name + item.done + count)', '}', ''].join('\n')
  writeFileSync(path.join(root, list), listText)
  const before = diagnoseFile(root, list)
  assert.ok(before.some(item => item.code === 'TS2339' && /on type 'never'/.test(item.message)), `fixture: ${before.map(item => item.message).join(' | ')}`)
  const diag = before.find(item => item.code === 'TS2339')!
  const root1 = stateTypeRoot(root, list, listText, diag)!
  assert.ok(root1, 'the callback item resolves back to the state')
  assert.equal(root1.state.name, 'items')
  assert.equal(root1.state.array, true)
  assert.deepEqual(root1.range, { start: 5, end: 5 })
  assert.ok(root1.state.fields.includes('name') && root1.state.fields.includes('done'))
  assert.ok(root1.state.candidates[0].startsWith('Thing '), `the type with the read fields ranks first: ${root1.state.candidates}`)
  assert.ok(!root1.state.candidates.some(item => item.startsWith('Other ')), 'a type with none of the fields is not offered')
  assert.ok(root1.state.setterCalls.some(item => item.includes('setItems(')))
  const ctx1 = buildNarrowContext(root, list)!
  assert.equal(ctx1.target.cause?.kind, 'STATE_TYPE')
  for (const part of ['FIELDS READ FROM', 'TYPE CANDIDATES', 'HOW THE SETTER IS CALLED', 'REPLACE EXACTLY THIS TEXT']) assert.ok(ctx1.text.includes(part), part)
  const fixed1 = evaluatePatch(root, list, { startLine: ctx1.patchRange.start, endLine: ctx1.patchRange.end, replacement: 'useState<Thing[]>([])' })
  assert.ok(fixed1.ok, fixed1.ok ? '' : fixed1.error)
  if (fixed1.ok) {
    const out = fixed1.content.split('\n')
    assert.equal(out[4], '  const [items, setItems] = useState<Thing[]>([])')
    assert.equal(out[5], listText.split('\n')[5], 'an unrelated state hook is untouched')
    assert.deepEqual(out.filter((line, i) => line !== listText.split('\n')[i]).length, 1)
    writeFileSync(path.join(root, list), fixed1.content)
    assert.equal(diagnoseFile(root, list).length, 0, 'the implicit-any / never errors are gone')
  }

  // 2. useState({}) with downstream object property reads
  const obj = 'stateobj.ts'
  const objText = [HOOK, 'export type View = { title: string; count: number }', 'export function Panel() {', '  const [view, setView] = useState({})', "  setView({ title: 't', count: 1 })", '  return view.title + view.count', '}', ''].join('\n')
  writeFileSync(path.join(root, obj), objText)
  const objCtx = buildNarrowContext(root, obj)!
  assert.equal(objCtx.target.cause?.kind, 'STATE_TYPE')
  assert.ok(objCtx.text.includes('View   (has 2 of the 2 fields read: title, count)'))
  // 3. a wrong candidate does not help: rejected, checkpoint intact
  writeFileSync(path.join(root, 'stateother.ts'), objText.replace('View = { title: string; count: number }', 'Other = { label: string }').replace('useState({})', 'useState({})'))
  const wrongText = objText.replace('export type View = { title: string; count: number }', 'export type View = { title: string; count: number }\nexport type Wrong = { label: string }')
  writeFileSync(path.join(root, 'statewrong.ts'), wrongText)
  const wrongCtx = buildNarrowContext(root, 'statewrong.ts')!
  const wrong = evaluatePatch(root, 'statewrong.ts', { startLine: wrongCtx.patchRange.start, endLine: wrongCtx.patchRange.end, replacement: 'useState<Wrong>({} as Wrong)' })
  assert.equal(wrong.ok, false, 'a type without the fields leaves the errors: not an improvement')
  assert.equal(readFileSync(path.join(root, 'statewrong.ts'), 'utf8'), wrongText, 'checkpoint intact')
  const right = evaluatePatch(root, obj, { startLine: objCtx.patchRange.start, endLine: objCtx.patchRange.end, replacement: 'useState<View>({} as View)' })
  assert.ok(right.ok, right.ok ? '' : right.error)
  if (right.ok) { writeFileSync(path.join(root, obj), right.content); assert.equal(diagnoseFile(root, obj).length, 0, '{} property errors are gone') }
  // null typing that leaves every read unguarded creates new kinds of error: rejected
  const nullFile = 'statenull.ts'
  writeFileSync(path.join(root, nullFile), objText)
  const nullCtx = buildNarrowContext(root, nullFile)!
  const nulled = evaluatePatch(root, nullFile, { startLine: nullCtx.patchRange.start, endLine: nullCtx.patchRange.end, replacement: 'useState<View | null>(null)' })
  assert.equal(nulled.ok, false, 'a nullable type with unguarded reads is not a fix')

  // 5. the candidate must be compatible with what the setter receives
  const setterFile = 'statesetter.ts'
  const setterText = [HOOK, 'export type RowA = { name: string }', 'export type RowB = { name: number }', 'export function Rows() {', '  const [rows, setRows] = useState([])', '  setRows([{ name: 5 }])', '  return rows.map(row => row.name)', '}', ''].join('\n')
  writeFileSync(path.join(root, setterFile), setterText)
  const setterCtx = buildNarrowContext(root, setterFile)!
  assert.ok(setterCtx.text.includes('setRows([{ name: 5 }])'), 'the setter call shape is shown')
  const incompatible = evaluatePatch(root, setterFile, { startLine: setterCtx.patchRange.start, endLine: setterCtx.patchRange.end, replacement: 'useState<RowA[]>([])' })
  assert.equal(incompatible.ok, false, 'RowA has the field but cannot take what the setter is given')
  writeFileSync(path.join(root, 'statesetter2.ts'), setterText)
  const setterCtx2 = buildNarrowContext(root, 'statesetter2.ts')!
  const compatible = evaluatePatch(root, 'statesetter2.ts', { startLine: setterCtx2.patchRange.start, endLine: setterCtx2.patchRange.end, replacement: 'useState<RowB[]>([])' })
  assert.ok(compatible.ok, compatible.ok ? '' : compatible.error)
  ok('untyped React state: the useState declaration is the root cause, candidates ranked by fields read, wrong/nullable/setter-incompatible types rejected, unrelated hooks untouched')
}

// 27. one fix for untyped state removes the whole cluster of {} errors; the errors it unmasks elsewhere are tolerated only when the cluster it removed is larger.
{
  const HOOK = 'function useState<S>(initial: S): [S, (value: S) => void] { return [initial, () => undefined] }'
  const text = [HOOK, 'export type V = { a: string; b: string; c: string; d: string; items: string[] }', 'export function P() {', '  const [v, setV] = useState({})', '  void setV', '  return [v.a, v.b, v.c, v.d, v.items.map((item: { name: string }) => item.name)]', '}', ''].join('\n')
  writeFileSync(path.join(root, 'statecluster.ts'), text)
  const before = diagnoseFile(root, 'statecluster.ts')
  assert.ok(before.filter(item => item.code === 'TS2339').length >= 5, `fixture: ${before.length} errors on {}`)
  const ctx = buildNarrowContext(root, 'statecluster.ts')!
  assert.equal(ctx.target.cause?.kind, 'STATE_TYPE')
  const out = evaluatePatch(root, 'statecluster.ts', { startLine: ctx.patchRange.start, endLine: ctx.patchRange.end, replacement: 'useState<V>({} as V)' })
  assert.ok(out.ok, `the cluster fix is accepted although it unmasks the item callback mismatch: ${out.ok ? '' : out.error}`)
  if (out.ok) { assert.ok(out.after < out.before, `${out.before} -> ${out.after}`); assert.ok(/now visible elsewhere/.test(out.summary)) }
  ok('shared root cause: the whole cluster of {} errors counts as removed, unmasked errors elsewhere are reported, not hidden')
}

// 28. a property read off a plain string: the value itself is the answer; a line that is only an unresolved word is a stray fragment.
{
  const file = 'primitive.ts'
  const text = ['export function f(failures: string[]) {', '  return failures.map(failure => failure.text)', '}', ''].join('\n')
  writeFileSync(path.join(root, file), text)
  const ctx = buildNarrowContext(root, file)!
  assert.equal(ctx.target.cause?.kind, 'MEMBER_ACCESS')
  assert.ok(ctx.text.includes('is a string, not an object') && ctx.text.includes('Write the value itself') && !ctx.text.includes('REAL MEMBERS OF'), 'no member list for a primitive')
  const fixed = evaluatePatch(root, file, { startLine: ctx.patchRange.start, endLine: ctx.patchRange.end, replacement: 'failure' })
  assert.ok(fixed.ok, fixed.ok ? '' : fixed.error)
  if (fixed.ok) { writeFileSync(path.join(root, file), fixed.content); assert.equal(diagnoseFile(root, file).length, 0) }

  const stray = 'stray.tsx'
  const strayText = ['client', "import { x } from './strayhelper'", 'export const y = x', ''].join('\n')
  writeFileSync(path.join(root, 'strayhelper.ts'), 'export const x = 1\n')
  writeFileSync(path.join(root, stray), strayText)
  const strayDiag = diagnoseFile(root, stray).find(item => item.code === 'TS2304')!
  assert.ok(strayDiag, 'fixture: the stray word is an unresolved name')
  assert.equal(strayWord({ target: strayDiag, lineText: 'client' }), 'client')
  assert.equal(strayWord({ target: strayDiag, lineText: 'const a = client' }), null)
  const strayCtx = buildNarrowContext(root, stray)!
  assert.ok(strayCtx.text.includes("THE WHOLE LINE IS ONLY THE WORD 'client'") && strayCtx.text.includes("'use client'"))
  ok('primitive receiver: the value itself is offered, no member list; a stray one-word line is named as a leftover fragment')
}

// 29. inside JSX, a braced expression is a patchable unit: the callback of a list render is replaced as one piece, not line by line.
{
  const tsx = ['export function List({ rows }: { rows: string[] }) {', '  return (', '    <ul>', '      {rows.map((row: { name: string }, index: number) => (', '        <li key={index}>{row.name}</li>', '      ))}', '    </ul>', '  )', '}', ''].join('\n')
  const chain = statementChain(tsx, 4)
  assert.deepEqual(chain[0], { start: 4, end: 6 }, 'the braced list expression (lines 4-6) is the innermost unit')
  // a braced expression with no expression inside (`{/* comment */}`) is not a unit
  assert.deepEqual(statementChain(['export const a = (', '  <p>', '    {/* note */}', '  </p>', ')', ''].join('\n'), 3).filter(item => item.start === 3 && item.end === 3), [])
  ok('JSX braced expressions are patchable units (the list callback is one piece); empty comment braces are not')
}

// 30. a callback argument whose parameter type conflicts with the collection's items: the real item type is stated, the model must change the answer.
{
  const message = "Argument of type '(resource: { name: string; value: number; }, index: number) => JSX.Element' is not assignable to parameter of type '(value: string, index: number, array: string[]) => Element'."
  assert.equal(callbackItemType({ code: 'TS2345', message }), 'string')
  assert.equal(callbackItemType({ code: 'TS2345', message: "Argument of type 'number' is not assignable to parameter of type 'string'." }), null, 'not a callback mismatch')
  assert.equal(callbackItemType({ code: 'TS2322', message }), null)
  const file = 'cbitems.ts'
  const text = ['export function f(rows: string[]) {', '  return rows.map((row: { name: string }, index: number) => row.name + index)', '}', ''].join('\n')
  writeFileSync(path.join(root, file), text)
  const ctx = buildNarrowContext(root, file)!
  assert.ok(ctx.text.includes('THE ITEMS OF THIS COLLECTION ARE: string') && ctx.text.includes('Your answer must differ from the current code'), ctx.text.slice(0, 600))
  ok('callback argument mismatch: the real item type is stated from the compiler signature')
}

// 31. a value-style import of a type compiles but breaks the node runner: it is an error in lib/ modules and is repaired as one token.
{
  mkdirSync(path.join(root, 'lib'), { recursive: true })
  writeFileSync(path.join(root, 'lib', 'tytypes.ts'), 'export type TyT = { a: string }\nexport const tyV = 1\n')
  const file = 'lib/tyuse.ts'
  const text = ["import { TyT, tyV } from './tytypes'", 'export const tyX: TyT = { a: String(tyV) }', ''].join('\n')
  writeFileSync(path.join(root, file), text)
  assert.equal(diagnoseFile(root, file).length, 0, 'the compiler accepts it: only the runtime rule sees it')
  const found = typeOnlyImportDiagnose(root, file, text)
  assert.equal(found.length, 1)
  assert.ok(found[0].code === 'import:TYPE_ONLY' && /'TyT' is only a type/.test(found[0].message) && found[0].line === 1)
  assert.deepEqual(typeOnlyImportDiagnose(root, file, "import type { TyT } from './tytypes'\nimport { tyV } from './tytypes'\n"), [], 'import type and value imports are fine')
  assert.deepEqual(typeOnlyImportDiagnose(root, file, "import { type TyT, tyV } from './tytypes'\n"), [], 'the inline type modifier is fine')
  assert.deepEqual(typeOnlyImportDiagnose(root, 'components/x.tsx', text), [], 'only lib/ modules (loaded by the node validators) are held to it')
  assert.ok(diagnoseAll(root, file).some(item => item.code === 'import:TYPE_ONLY'), 'part of the authoritative diagnostics')
  const ctx = buildNarrowContext(root, file)!
  assert.equal(ctx.target.cause?.kind, 'TOKEN_FIX')
  assert.ok(ctx.text.includes('COMPILER SUGGESTS:\ntype TyT'))
  const fixed = evaluatePatch(root, file, { startLine: ctx.patchRange.start, endLine: ctx.patchRange.end, replacement: 'type TyT' })
  assert.ok(fixed.ok, fixed.ok ? '' : fixed.error)
  if (fixed.ok) { assert.equal(fixed.content.split('\n')[0], "import { type TyT, tyV } from './tytypes'"); writeFileSync(path.join(root, file), fixed.content); assert.equal(diagnoseAll(root, file).length, 0) }
  ok('type-only value imports: reported in lib/ modules, repaired as one token, other imports untouched')
}

// 32. a validator that compiles but fails when it runs: the failing assertion is a diagnostic with its line, repaired like any other.
{
  mkdirSync(path.join(root, 'lib'), { recursive: true })
  try { symlinkSync(path.join(resolveRepoRoot(), 'scripts'), path.join(root, 'scripts')) } catch { /* already linked */ }
  writeFileSync(path.join(root, 'lib', 'rtmod.ts'), 'export const double = (n: number): number => n * 2\n')
  const file = 'lib/rtmod.validation.ts'
  const text = ["import assert from 'node:assert/strict'", "import { double } from './rtmod'", 'assert.equal(double(1), 2)', 'assert.equal(double(2), 5)', "console.log('RT_VALIDATION 2/2')", ''].join('\n')
  writeFileSync(path.join(root, file), text)
  assert.equal(diagnoseFile(root, file).length, 0, 'it compiles: only running it shows the problem')
  const found = runtimeDiagnose(root, file, text)
  assert.equal(found.length, 1)
  assert.ok(found[0].code === 'runtime:FAILURE' && found[0].line === 4, `the failing assertion line: ${JSON.stringify(found[0])}`)
  assert.ok(/AssertionError/.test(found[0].message), found[0].message)
  assert.equal(runtimeDiagnose(root, file, text), found, 'the same text is not run twice (cached)')
  assert.deepEqual(runtimeDiagnose(root, 'lib/rtmod.ts', text), [], 'only validators are run')
  assert.deepEqual(runtimeDiagnose(root, file, text.replace('double(2), 5', 'double(2), 4')), [], 'a passing validator has no runtime diagnostic')
  const withType = text.replace("assert.equal(double(1), 2)", "const bad: number = 'x'")
  assert.deepEqual(diagnoseAll(root, file, { [file]: withType }).filter(item => item.code === 'runtime:FAILURE'), [], 'a file that does not compile is not run')
  assert.ok(diagnoseAll(root, file).some(item => item.code === 'runtime:FAILURE'), 'part of the authoritative diagnostics once the file compiles')
  const ctx = buildNarrowContext(root, file)!
  assert.equal(ctx.target.target.code, 'runtime:FAILURE')
  assert.ok(ctx.text.includes('fails when it RUNS'))
  const fixed = evaluatePatch(root, file, { startLine: ctx.patchRange.start, endLine: ctx.patchRange.end, replacement: 'assert.equal(double(2), 4)' })
  assert.ok(fixed.ok, fixed.ok ? '' : fixed.error)
  if (fixed.ok) { writeFileSync(path.join(root, file), fixed.content); assert.equal(diagnoseAll(root, file).length, 0, 'the validator passes') }
  ok('runtime validator failures: the failing assertion is a diagnostic (cached, only for clean validators) and is repaired as a one-line patch')
}

// 33. a runtime failure is judged by WHERE it fails, not by its text: editing the expected string of the same failing assertion is not progress; the real members are shown.
{
  writeFileSync(path.join(root, 'lib', 'rt2mod.ts'), "export const jobs = [{ name: 'Production build', stateLabel: 'Stale record - gone' }]\n")
  const file = 'lib/rt2mod.validation.ts'
  const text = ["import assert from 'node:assert/strict'", "import { jobs } from './rt2mod'", "assert.ok(jobs.some(job => job.name.includes('Stale record')))", "console.log('RT2_VALIDATION 1/1')", ''].join('\n')
  writeFileSync(path.join(root, file), text)
  const ctx = buildNarrowContext(root, file)!
  assert.equal(ctx.target.target.code, 'runtime:FAILURE')
  assert.ok(ctx.text.includes('WHAT THE FAILING ASSERTION READS') && /job: name, stateLabel/.test(ctx.text), ctx.text.slice(-500))
  assert.ok(runtimeReads(root, file, text, 3).some(item => item.startsWith('job: name, stateLabel')), 'runtimeReads names the item and its real members')
  // changing only the expected text of the same failing assertion is the same failure moved: rejected
  const sameFailure = evaluatePatch(root, file, { startLine: 3, endLine: 3, replacement: "assert.ok(jobs.some(job => job.name.includes('Stale record build')))" })
  assert.equal(sameFailure.ok, false, 'the same assertion still fails: no progress')
  writeFileSync(path.join(root, 'lib', 'rt2b.validation.ts'), text)
  const real = evaluatePatch(root, 'lib/rt2b.validation.ts', { startLine: 3, endLine: 3, replacement: "assert.ok(jobs.some(job => job.stateLabel.includes('Stale record')))" })
  assert.ok(real.ok, real.ok ? '' : real.error)
  ok('runtime failure identity is the failing line; the real members the assertion reads are offered; the same failure is not progress')
}

// 34. the real wording is found in the code under test; imported libraries are not "values the test reads".
{
  writeFileSync(path.join(root, 'lib', 'rt3mod.ts'), "export const label = 'Zebra marker - the process is gone and no result was written'\nexport const jobs = [{ name: 'Production build', stateLabel: label }]\n")
  const file = 'lib/rt3mod.validation.ts'
  const text = ["import assert from 'node:assert/strict'", "import { jobs } from './rt3mod'", "assert.ok(jobs.some(job => job.stateLabel.includes('Zebra marker build')))", "console.log('RT3_VALIDATION 1/1')", ''].join('\n')
  writeFileSync(path.join(root, file), text)
  const hints = literalHints(root, file, text.split('\n')[2])
  assert.equal(hints.length, 1)
  assert.ok(hints[0].includes("Zebra marker - the process is gone") && hints[0].includes('rt3mod.ts'), hints[0])
  assert.deepEqual(literalHints(root, file, "assert.equal(count, 12)"), [], 'no quoted literal: nothing to look up')
  assert.deepEqual(literalHints(root, file, "assert.ok(x.includes('zzzz-nothing-like-this'))"), [], 'no similar wording in the code under test')
  const reads = runtimeReads(root, file, text, 3)
  assert.ok(reads.some(item => item.startsWith('job: ')) && !reads.some(item => item.startsWith('assert:')), `the imported assert is skipped: ${reads.map(item => item.slice(0, 20))}`)
  const ctx = buildNarrowContext(root, file)!
  assert.ok(ctx.text.includes('REAL TEXT IN THE CODE UNDER TEST') && ctx.text.includes('Zebra marker - the process is gone'))
  assert.ok(ctx.text.includes("[stored under the key 'label']") && ctx.text.includes('THE FIELD THAT HOLDS THIS TEXT (check this field, not another one): job.stateLabel') && ctx.text.includes('ONE replacement line fixes BOTH'), 'the field whose name contains the key is named: ' + ctx.text.slice(-700))
  const fixed = evaluatePatch(root, file, { startLine: 3, endLine: 3, replacement: "assert.ok(jobs.some(job => job.stateLabel.includes('Zebra marker')))" })
  assert.ok(fixed.ok, fixed.ok ? '' : fixed.error)
  ok('runtime failure context: real wording from the code under test is offered, imported libraries are skipped')
}

// 35. a validator that fails because the CODE UNDER TEST returns a broken value: the diagnostic belongs to the implementation file, which is repaired against the validator.
{
  writeFileSync(path.join(root, 'lib', 'rt4impl.ts'), ['export function describeRun(startedAt: string, finishedAt: string) {', '  return {', '    elapsed: String(Number(finishedAt) - Number(startedAt)),', '  }', '}', ''].join('\n'))
  const validatorFile = 'lib/rt4impl.validation.ts'
  const implFile = 'lib/rt4impl.ts'
  writeFileSync(path.join(root, validatorFile), ["import assert from 'node:assert/strict'", "import { describeRun } from './rt4impl'", "assert.equal(describeRun('2026-01-01T00:00:00Z', '2026-01-01T00:02:09Z').elapsed, '129')", "console.log('RT4_VALIDATION 1/1')", ''].join('\n'))
  assert.deepEqual(linkedValidators(root, implFile), [validatorFile], 'the validator that exercises the implementation is found')
  const implText = readFileSync(path.join(root, implFile), 'utf8')
  const validatorText = readFileSync(path.join(root, validatorFile), 'utf8')
  assert.deepEqual(runtimeDiagnose(root, validatorFile, validatorText), [], 'the validator is right (expected 129, actual NaN): it is not blamed')
  const onImpl = runtimeDiagnose(root, implFile, implText)
  assert.equal(onImpl.length, 1)
  assert.ok(onImpl[0].code === 'runtime:FAILURE' && onImpl[0].line === 3 && /expectation is right/.test(onImpl[0].message), JSON.stringify(onImpl[0]))
  const ctx = buildNarrowContext(root, implFile)!
  assert.equal(ctx.target.target.code, 'runtime:FAILURE')
  // the candidate is judged by running the validator against it (the repository file is never touched while judging)
  const wrong = evaluatePatch(root, implFile, { startLine: 3, endLine: 3, replacement: "    elapsed: 'NaN'," })
  assert.equal(wrong.ok, false, 'a value that still fails the validator is not progress')
  assert.equal(readFileSync(path.join(root, implFile), 'utf8'), implText, 'the repository file is untouched by judging')
  const fixed = evaluatePatch(root, implFile, { startLine: 3, endLine: 3, replacement: '    elapsed: String((Date.parse(finishedAt) - Date.parse(startedAt)) / 1000),' })
  assert.ok(fixed.ok, fixed.ok ? '' : fixed.error)
  if (fixed.ok) { writeFileSync(path.join(root, implFile), fixed.content); assert.deepEqual(runtimeDiagnose(root, implFile, fixed.content), [], 'the validator now passes against the repaired file') }
  ok('runtime failure from a broken value is blamed on the implementation, judged by running the validator against the candidate, and repaired there')
}

// 36. a field that is also declared in a types file is still attributed to the one file with logic.
{
  writeFileSync(path.join(root, 'lib', 'rt5types.ts'), 'export type RunView = { spentTime: string }\n')
  writeFileSync(path.join(root, 'lib', 'rt5impl.ts'), ["import type { RunView } from './rt5types'", 'export function describeRun(startedAt: string, finishedAt: string): RunView {', '  return {', '    spentTime: String(Number(finishedAt) - Number(startedAt)),', '  }', '}', ''].join('\n'))
  writeFileSync(path.join(root, 'lib', 'rt5impl.validation.ts'), ["import assert from 'node:assert/strict'", "import { describeRun } from './rt5impl'", "assert.equal(describeRun('2026-01-01T00:00:00Z', '2026-01-01T00:02:09Z').spentTime, '129')", ''].join('\n'))
  const implText = readFileSync(path.join(root, 'lib', 'rt5impl.ts'), 'utf8')
  const validatorText = readFileSync(path.join(root, 'lib', 'rt5impl.validation.ts'), 'utf8')
  assert.deepEqual(runtimeDiagnose(root, 'lib/rt5impl.validation.ts', validatorText), [], 'the validator is not blamed')
  const onImpl = runtimeDiagnose(root, 'lib/rt5impl.ts', implText)
  assert.equal(onImpl.length, 1, 'the implementation file is blamed, not the types file')
  assert.equal(onImpl[0].line, 4)
  assert.deepEqual(runtimeDiagnose(root, 'lib/rt5types.ts', 'export type RunView = { spentTime: string }\n'), [], 'the types file is never blamed for a wrong value')
  ok('a wrong value is attributed to the implementation file even when a types file declares the same field')
}

// 37. the code under test produces only PART of the required text: the implementation is blamed, not the expectation.
{
  writeFileSync(path.join(root, 'lib', 'rt6impl.ts'), ['export function raise(detail: string) {', '  return {', '    banner: detail,', '  }', '}', ''].join('\n'))
  writeFileSync(path.join(root, 'lib', 'rt6impl.validation.ts'), ["import assert from 'node:assert/strict'", "import { raise } from './rt6impl'", "assert.equal(raise('credentials missing').banner, 'Decision required: credentials missing')", ''].join('\n'))
  const implText = readFileSync(path.join(root, 'lib', 'rt6impl.ts'), 'utf8')
  const validatorText = readFileSync(path.join(root, 'lib', 'rt6impl.validation.ts'), 'utf8')
  assert.deepEqual(runtimeDiagnose(root, 'lib/rt6impl.validation.ts', validatorText), [], 'the expectation is the spec: the validator is not blamed')
  const onImpl = runtimeDiagnose(root, 'lib/rt6impl.ts', implText)
  assert.equal(onImpl.length, 1, 'the implementation is blamed for its incomplete text')
  assert.equal(onImpl[0].line, 3)
  assert.ok(onImpl[0].message.includes("it is missing the prefix 'Decision required: '"), 'the exact missing part is stated: ' + onImpl[0].message)
  assert.ok(onImpl[0].message.startsWith("The code produces 'credentials missing' but the required text is 'Decision required: credentials missing'"), 'the gap comes first so it is never cut off: ' + onImpl[0].message.slice(0, 120))
  // pasting the validator's expected text as a literal is gaming the test: rejected, file untouched
  const gamed = evaluatePatch(root, 'lib/rt6impl.ts', { startLine: 3, endLine: 3, replacement: "    banner: 'Decision required: credentials missing'," })
  assert.equal(gamed.ok, false)
  assert.ok(!gamed.ok && /special-cases the test/.test(gamed.error), gamed.ok ? '' : gamed.error)
  assert.equal(readFileSync(path.join(root, 'lib', 'rt6impl.ts'), 'utf8'), implText, 'checkpoint intact')
  writeFileSync(path.join(root, 'lib', 'rt6b.ts'), implText)
  writeFileSync(path.join(root, 'lib', 'rt6b.validation.ts'), validatorText.replace('./rt6impl', './rt6b'))
  const fixed = evaluatePatch(root, 'lib/rt6b.ts', { startLine: 3, endLine: 3, replacement: "    banner: 'Decision required: ' + detail," })
  assert.ok(fixed.ok, fixed.ok ? '' : fixed.error)
  // an unrelated mismatch (neither side is a fragment of the other, nothing broken) stays on the validator
  writeFileSync(path.join(root, 'lib', 'rt7impl.ts'), ['export function label() {', '  return {', "    caption: 'alpha',", '  }', '}', ''].join('\n'))
  const rt7 = ["import assert from 'node:assert/strict'", "import { label } from './rt7impl'", "assert.equal(label().caption, 'beta')", ''].join('\n')
  writeFileSync(path.join(root, 'lib', 'rt7impl.validation.ts'), rt7)
  assert.equal(runtimeDiagnose(root, 'lib/rt7impl.validation.ts', rt7).length, 1, 'a plain mismatch is an expectation the validator must settle')
  ok('incomplete output from the code under test is blamed on the implementation; a plain mismatch stays on the validator')
}

rmSync(root, { recursive: true, force: true })
console.log(`FOUNDRY_NARROW_REPAIR_VALIDATION ${passed}/40`)
