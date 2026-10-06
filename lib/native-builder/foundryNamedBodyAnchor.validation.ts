/**
 * A fix goal that names a small function anchors on that function's own statement (the line the fix changes), not on its declaration header.
 * Provenance (NAMED_FUNCTION_BODY) travels with the anchor and lifts it to HIGH; uniqueness, the syntax guard, workspace write isolation and the whole-file safeguards are unchanged.
 * Real tools (file.read / file.replace_unique / file.write), a real registry and real directories in an isolated temp base.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let passed = 0
const ok = (name: string) => { passed += 1; console.log(`PASS ${name}`) }

const tmp = mkdtempSync(path.join(os.tmpdir(), 'namedbody-'))
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
const { startMissionInput } = await import('./foundryMissionController')
const { resolveWorkspaceBinding } = await import('./foundryWorkspaceBinding')
const { saveMission, loadMission } = await import('./foundryMissionStore')
const { anchorOrigins, fileShaOf, MAX_ORIGIN_BODY_STATEMENTS, namedFunctionBodyLines, registerEditAnchor } = await import('./foundryEditAnchors')
const { isLocalizedFixGoal, NAMED_BODY_LINE_BONUS, scoreAnchorText } = await import('./foundryAnchorRanking')
const { inferQueryReadBounds } = await import('./foundryBoundedEdit')

/** The exact request of the source-tree and installed smokes. */
const REQUEST = 'The add function in calc.mjs returns the wrong result and calc.test.mjs fails. Fix add so add(2, 3) is 5, run the tests with npm test and verify they pass. Do not change the tests.'
const BUGGY = 'export function add(a, b) {\n  return a - b\n}\n\nexport function multiply(a, b) {\n  return a * b\n}\n'
const TEST = "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { add } from './calc.mjs'\ntest('add', () => { assert.equal(add(2, 3), 5) })\n"
const ADD_ORIGIN = { kind: 'NAMED_FUNCTION_BODY', functionName: 'add' }

type StoredAnchor = { anchorId: string; anchorText: string; relevance?: string; relevanceScore?: number; origin?: { kind: string; functionName: string } }
type ReadResult = {
  ok: boolean
  result?: {
    compact: string
    content: string
    range: { startLine: number; endLine: number }
    EDIT_ANCHOR?: { anchorId: string; ANCHOR_TEXT: string; ANCHOR_RELEVANCE?: string; ANCHOR_START_LINE: number }
    anchors?: Array<{ anchorId: string; ANCHOR_TEXT: string; ANCHOR_RELEVANCE?: string }>
  }
}

/** A bound mission in a fresh project, taken through owners and impact (the real gates an edit needs). No read yet: each check chooses its own read shape. */
async function scenario(name: string, options: { source?: string; request?: string } = {}) {
  const dir = path.join(projects, name)
  mkdirSync(dir)
  writeFileSync(path.join(dir, 'calc.mjs'), options.source ?? BUGGY)
  writeFileSync(path.join(dir, 'calc.test.mjs'), TEST)
  const workspace = await openExistingProjectWorkspace(dir, name)
  const binding = (await resolveWorkspaceBinding({ workspaceId: workspace.id }))!
  const record = startMissionInput(options.request ?? REQUEST, name, {})
  record.permissions = { ...record.permissions, filesystem: true, terminal: true }
  record.workspaceBinding = binding
  await saveMission(record)
  const inWorkspace = <T>(fn: () => Promise<T>) => runWithWorkspaceRoot(binding.workspaceRoot, fn, binding.workspaceId) as Promise<T>
  await inWorkspace(() => executeEngineerTool({ tool: 'engineering.baseline' as never, input: {} }, { repairId: record.missionId }))
  const live = (await loadMission(record.missionId))!
  const call = (tool: string, input: Record<string, unknown>) => inWorkspace(() => executeEngineerTool({ tool: tool as never, input }, { repairId: record.missionId, mission: live }))
  await call('code.owners', { query: 'add calc function' })
  await call('code.impact', {})
  const file = path.join(dir, 'calc.mjs')
  const read = async (input: Record<string, unknown>) => (await call('file.read', { path: 'calc.mjs', ...input })) as ReadResult
  const stored = () => ((live.engineering as { editAnchors?: StoredAnchor[] } | undefined)?.editAnchors ?? [])
  return { dir, file, live, call, read, stored, text: () => readFileSync(file, 'utf8') }
}
const primary = (read: ReadResult) => read.result!.EDIT_ANCHOR!

const origins = (content: string, goal = REQUEST, intent = '') => [...anchorOrigins(content, goal, intent).keys()]
const sized = (statements: number) => `export function add(a, b) {\n  let total = 0\n${Array.from({ length: statements - 2 }, (_, i) => `  total += ${i + 1} * a`).join('\n')}\n  return total\n}\n`

// 1. The live failure shape: a read around the declaration token (`function add`) used to issue that fragment as the MEDIUM anchor, so a whole-function replacement could never apply.
{
  const s = await scenario('A')
  const read = await s.read({ aroundMatch: 'function add' })
  assert.equal(read.ok, true)
  assert.equal(primary(read).ANCHOR_TEXT, 'return a - b', 'the statement that has to change, not the declaration fragment')
  assert.equal(primary(read).ANCHOR_RELEVANCE, 'HIGH')
  assert.equal(primary(read).ANCHOR_START_LINE, 2)
  assert.deepEqual(read.result!.anchors!.map(item => item.ANCHOR_TEXT), ['return a - b'], 'the header fragment is not offered at all')
  const persisted = s.stored()
  assert.deepEqual(persisted.map(item => item.anchorText), ['return a - b'])
  assert.deepEqual(persisted[0].origin, ADD_ORIGIN, 'provenance is persisted with the anchor')
  assert.equal(persisted[0].relevance, 'HIGH')
  assert.equal(persisted[0].relevanceScore, NAMED_BODY_LINE_BONUS)
  for (const needle of ['ANCHOR_CANDIDATES:', 'lines 2-2', 'goalMatch = add', 'relevance = HIGH', 'reason = unique statement inside add, the function the goal names', 'ANCHOR_TEXT:\nreturn a - b']) {
    assert.ok(read.result!.compact.includes(needle), `the printed block carries "${needle}": ${read.result!.compact}`)
  }
  ok('1: a read around `function add` issues the body line `return a - b` as a HIGH anchor with persisted provenance (not the header fragment)')
}

// 2. Every other way a model reads the file reaches the same anchor, including a short query that only the mission request makes a fix goal.
{
  const shapes: Array<[string, Record<string, unknown>]> = [
    ['path only', {}],
    ['symbol', { symbol: 'add' }],
    ['aroundMatch on the statement', { aroundMatch: 'return a - b' }],
    ['query naming the function', { query: 'add' }],
    ['explicit line range', { startLine: 1, endLine: 8 }],
  ]
  for (const [label, input] of shapes) {
    const s = await scenario(`B${label.replace(/\W+/g, '')}`)
    const read = await s.read(input)
    assert.equal(primary(read).ANCHOR_TEXT, 'return a - b', `${label}: ${read.result!.compact}`)
    assert.equal(primary(read).ANCHOR_RELEVANCE, 'HIGH', label)
    assert.deepEqual(s.stored().map(item => item.origin), [ADD_ORIGIN], label)
  }
  ok('2: path-only, symbol, aroundMatch, query and range reads all issue the HIGH body-line anchor')
}

// 3. The two-argument score is untouched (ordinary ranking is pinned by the older validators); the origin only adds the documented bonus and says why.
{
  const header = scoreAnchorText('export function add(a, b) {', REQUEST)
  const line = scoreAnchorText('return a - b', REQUEST)
  assert.deepEqual([header.score, header.relevance], [16, 'MEDIUM'], 'the header only matches the word "function"')
  assert.deepEqual([line.score, line.relevance, line.reason], [0, 'LOW', 'no requested goal terms or required bindings'], 'without provenance the statement is LOW')
  assert.deepEqual(scoreAnchorText('return a - b', REQUEST, undefined), line, 'an absent origin is the two-argument score')
  const lifted = scoreAnchorText('return a - b', REQUEST, { kind: 'NAMED_FUNCTION_BODY', functionName: 'add' })
  assert.deepEqual([lifted.score, lifted.relevance, lifted.goalMatch], [line.score + NAMED_BODY_LINE_BONUS, 'HIGH', 'add'])
  assert.deepEqual(lifted.matchedGoalTerms.slice(0, 1), ['add'])
  assert.equal(lifted.reason, 'unique statement inside add, the function the goal names')
  assert.ok(lifted.score > header.score, 'the statement outranks the declaration header')
  ok('3: scoring without an origin is unchanged; an origin adds exactly the documented bonus and names the function')
}

// 4. Provenance is earned: fix goals only, named functions only, small braced functions only, unique lines only, real statements only.
{
  assert.deepEqual(origins(BUGGY), ['return a - b'], 'only the named function, not multiply')
  assert.deepEqual(anchorOrigins(BUGGY, REQUEST).get('return a - b'), ADD_ORIGIN)
  assert.deepEqual(origins(BUGGY, 'add', REQUEST), ['return a - b'], 'a short query borrows the function name and the fix intent from the mission request')
  assert.deepEqual(origins(BUGGY, 'add'), [], 'a short query alone is not a fix goal')
  assert.deepEqual(origins(BUGGY, 'The multiply function in calc.mjs returns the wrong result. Fix multiply.'), ['return a * b'], 'whichever function the goal names')
  assert.deepEqual(origins(BUGGY, 'The divide function returns the wrong result. Fix divide.'), [], 'a function that does not exist, a function that is not named')

  const twice = 'export function add(a, b) {\n  return a - b\n}\n\nexport function sub(a, b) {\n  return a - b\n}\n'
  assert.deepEqual(origins(twice), [], 'a line that occurs twice is not a unique anchor, so it has no provenance')

  for (const goal of [
    'The add function returns the wrong result. Fix add and change its signature to take three numbers.',
    'Rename add to sum: it returns the wrong value.',
    'Rename the add function and fix the callers.',
  ]) assert.deepEqual(origins(BUGGY, goal), [], `a structural goal targets the declaration: ${goal}`)
  for (const goal of ['Add logging to the add function in calc.mjs.', 'Explain how add works in calc.mjs.', 'Refactor add for readability.']) {
    assert.deepEqual(origins(BUGGY, goal), [], `not a fix goal: ${goal}`)
  }

  assert.ok(origins(sized(MAX_ORIGIN_BODY_STATEMENTS)).length > 0, 'a function at the limit is small enough')
  assert.deepEqual(origins(sized(MAX_ORIGIN_BODY_STATEMENTS + 1)), [], 'a function past the limit keeps the ordinary ranking (a component is not a biased sample of its first lines)')

  const arrow = 'export const add = (a, b) => a - b\nexport const multiply = (a, b) => {\n  return a * b\n}\n'
  assert.deepEqual(origins(arrow), [], 'an expression-bodied arrow has no body lines')
  assert.deepEqual(namedFunctionBodyLines(arrow, REQUEST), [], 'and the next declaration is not mistaken for its body')

  const stringy = "export function add(a, b) {\n  const open = '{'\n  return a - b\n}\n\nexport function multiply(a, b) {\n  return a * b\n}\n"
  assert.deepEqual(origins(stringy), ["const open = '{'", 'return a - b'], 'a brace inside a string does not stretch the body into the next function')

  const branchy = 'export function add(a, b) {\n  // the bug is below\n  if (a > 0) {\n    return a - b\n  } else {\n    return b\n  }\n}\n'
  assert.deepEqual(origins(branchy), ['if (a > 0) {', 'return a - b', 'return b'], 'comments and block-only lines (`} else {`, `}`) are never anchors')

  const positives = ['Fix add', 'the result is wrong', 'repair the parser', 'the tests fail', 'an off-by-one error', 'there is a typo', 'debug the loop', 'a regression in total', 'it is broken', 'incorrect output', 'that was a mistake', 'a bug in add']
  const negatives = ['Add a divide function', 'create a fixture for add', 'prefix the name', 'Rename add to sum', 'Fix the signature of add', 'refactor add', 'Explain add']
  for (const goal of positives) assert.equal(isLocalizedFixGoal(goal), true, goal)
  for (const goal of negatives) assert.equal(isLocalizedFixGoal(goal), false, goal)
  ok('4: provenance requires a fix goal, a named small braced function, a unique real statement, and no rename/signature intent')
}

// 5. A statement anchor keeps the whole function in view (its window must not shrink to one line), and a function written as an arrow has no `function` word to lean on.
{
  const ARROW = 'export const total = (items) => {\n  const prices = items.map(item => item.price)\n  return prices.reduce((sum, price) => sum + price, 1)\n}\n\nexport const multiply = (a, b) => {\n  return a * b\n}\n'
  const request = 'The total function in calc.mjs returns the wrong result. Fix total so total([{ price: 1 }, { price: 2 }]) is 3.'
  const s = await scenario('C', { source: ARROW, request })
  const read = await s.read({})
  const a = primary(read)
  assert.ok(['const prices = items.map(item => item.price)', 'return prices.reduce((sum, price) => sum + price, 1)'].includes(a.ANCHOR_TEXT), a.ANCHOR_TEXT)
  assert.equal(a.ANCHOR_RELEVANCE, 'HIGH')
  assert.ok(s.stored().length === 2 && s.stored().every(item => item.origin?.functionName === 'total' && item.relevance === 'HIGH'), 'each statement of the small function is its own HIGH anchor')
  assert.ok(read.result!.content.includes('multiply') && read.result!.content.includes('export const total'), `the window is the function in its file, not the anchor line: ${JSON.stringify(read.result!.content)}`)
  assert.ok(read.result!.range.endLine - read.result!.range.startLine + 1 > 1, 'the window is not collapsed onto the anchor')
  const regions = read.result!.compact.split('\n').filter(line => line.startsWith('- anc_'))
  assert.equal(regions.length, 2)
  assert.ok(regions.every(line => /relevance=HIGH/.test(line) && / text="/.test(line)), `each region row names its statement: ${regions.join(' | ')}`)
  ok('5: an arrow-function fix target gets one HIGH anchor per statement, its rows name the statement, and the window stays the whole function')
}

// 6. Naming a statement is choosing it: the global ranking must not swap it for a different statement of the same function.
{
  const ARROW = 'export const total = (items) => {\n  const prices = items.map(item => item.price)\n  return prices.reduce((sum, price) => sum + price, 1)\n}\n'
  const request = 'The total function in calc.mjs returns the wrong result. Fix total so total([{ price: 1 }, { price: 2 }]) is 3.'
  const wanted = 'return prices.reduce((sum, price) => sum + price, 1)'
  const s = await scenario('D', { source: ARROW, request })
  const read = await s.read({ aroundMatch: wanted })
  assert.equal(primary(read).ANCHOR_TEXT, wanted)
  assert.equal(primary(read).ANCHOR_RELEVANCE, 'HIGH')
  assert.deepEqual(s.stored().find(item => item.anchorText === wanted)?.origin, { kind: 'NAMED_FUNCTION_BODY', functionName: 'total' })
  const indented = await (await scenario('D2', { source: ARROW, request })).read({ aroundMatch: `  ${wanted}` })
  assert.equal(primary(indented).ANCHOR_TEXT, wanted, 'the same line asked for with its indentation is issued as the canonical statement')
  ok('6: a statement asked for by name is the issued anchor (also when asked for with its indentation)')
}

// 7. The window is not the only place a statement can come from: a read of another region still issues the function's statement, and a short query centres a large file on it.
{
  const s = await scenario('E')
  const read = await s.read({ query: 'calculator arithmetic', startLine: 5, endLine: 8 })
  assert.equal(primary(read).ANCHOR_TEXT, 'return a - b', 'the fix target is offered even when the model read the neighbouring function')
  assert.equal(primary(read).ANCHOR_RELEVANCE, 'HIGH')

  const filler = Array.from({ length: 80 }, (_, i) => `export const filler${i} = ${i}`).join('\n')
  const large = await scenario('F', { source: `${filler}\n\n${BUGGY}` })
  const bugLine = large.text().split('\n').indexOf('  return a - b') + 1
  const centred = await large.read({ query: 'add' })
  assert.ok(centred.result!.range.startLine <= bugLine && centred.result!.range.endLine >= bugLine, `the window (${centred.result!.range.startLine}-${centred.result!.range.endLine}) covers line ${bugLine}, not the top of the file`)
  assert.equal(primary(centred).ANCHOR_TEXT, 'return a - b')
  assert.equal(inferQueryReadBounds(BUGGY, REQUEST)?.aroundMatch, 'return a - b')
  assert.equal(inferQueryReadBounds(BUGGY, 'add', REQUEST)?.aroundMatch, 'return a - b', 'the mission request supplies the fix intent')
  assert.notEqual(inferQueryReadBounds(BUGGY, 'Explain the add function in calc.mjs')?.aroundMatch, 'return a - b', 'a non-fix goal infers what it always did')
  ok('7: the function statement is offered even from another region; a short query on a large file is centred on it')
}

// 8. Safety nets are unchanged: a whole-function replacement against the statement anchor is still a syntax error that never reaches disk, the whole-file rewrite still may not drop code,
//    and a correct edit changes exactly the intended line inside the bound workspace only.
{
  const s = await scenario('G')
  const before = s.text()
  const read = await s.read({ aroundMatch: 'function add' })
  const anchorId = primary(read).anchorId
  const whole = await s.call('file.replace_unique', { path: 'calc.mjs', anchorId, replacementText: 'export function add(a, b) {\n  return a + b\n}', reason: 'fix add' })
  assert.equal(whole.ok, false)
  assert.ok(/PATCH_BREAKS_SYNTAX/.test(String(whole.error)), String(whole.error))
  assert.ok(/'export' and 'import' declarations can only appear at the top level of a module/.test(String(whole.error)), `the model is told why: ${String(whole.error).slice(0, 400)}`)
  assert.equal(s.text(), before, 'a rejected patch leaves the file byte-identical')
  const dropped = await s.call('file.write', { path: 'calc.mjs', content: 'export function add(a, b) {\n  return a + b\n}\n', reason: 'whole-file rewrite' })
  assert.ok(/WHOLE_FILE_DROPS_CODE/.test(String(dropped.error)) && String(dropped.error).includes('multiply'), String(dropped.error))
  assert.equal(s.text(), before, 'a rewrite that deletes multiply never reaches disk')
  const fixed = await s.call('file.replace_unique', { path: 'calc.mjs', anchorId, replacementText: 'return a + b', reason: 'fix add' })
  assert.equal(fixed.ok, true, String(fixed.error))
  const after = s.text().split('\n')
  const was = before.split('\n')
  assert.equal(after.length, was.length)
  assert.deepEqual(after.flatMap((line, index) => (line === was[index] ? [] : [index + 1])), [2], 'only line 2 changed')
  assert.equal(after[1], '  return a + b')
  assert.ok(s.text().includes('export function multiply(a, b) {\n  return a * b\n}'), 'multiply is untouched')
  assert.equal(existsSync(path.join(base, 'calc.mjs')), false, 'nothing was written outside the bound workspace')
  ok('8: syntax guard, whole-file safeguard and workspace isolation are unchanged; the correct edit changes only the intended line')
}

// 9. Provenance never overrides ordinary evidence: a non-fix goal, a rename, or a larger function keeps exactly the ranking it had.
{
  const explain = await scenario('H', { request: 'Explain the add function in calc.mjs.' })
  const explained = await explain.read({ aroundMatch: 'function add' })
  assert.ok(explain.stored().every(item => item.origin === undefined), 'a non-fix mission persists no provenance')
  assert.notEqual(primary(explained).ANCHOR_TEXT, 'return a - b', 'and keeps the ordinary pick')

  const rename = await scenario('I', { request: 'Rename add to sum in calc.mjs and fix its callers.' })
  await rename.read({ aroundMatch: 'function add' })
  assert.ok(rename.stored().every(item => item.origin === undefined), 'a rename mission persists no provenance')

  const long = await scenario('J', { source: sized(MAX_ORIGIN_BODY_STATEMENTS + 1) })
  await long.read({ aroundMatch: 'function add' })
  assert.ok(long.stored().every(item => item.origin === undefined), 'a function past the limit persists no provenance')

  const BADGE = "export function Badge(props) {\n  const label = props.label ?? 'none'\n  return <span data-testid=\"status-chip\">{selected.engineeringReview}</span>\n}\n"
  const badge = await scenario('K', { source: BADGE, request: 'Fix the Badge so the status chip shows selected.engineeringReview instead of a hardcoded label.' })
  const badgeRead = await badge.read({})
  assert.equal(primary(badgeRead).ANCHOR_TEXT.includes('selected.engineeringReview'), true, `a binding-bearing anchor still leads: ${primary(badgeRead).ANCHOR_TEXT}`)
  ok('9: non-fix, rename and larger-function goals persist no provenance; a binding-bearing JSX anchor still leads')
}

// 10. A re-read that finds the same text under new evidence upgrades the stored anchor instead of keeping stale relevance.
{
  const s = await scenario('L')
  const sha = fileShaOf(BUGGY)
  const common = { path: 'calc.mjs', sha256: sha, windowContent: 'return a - b', range: { startLine: 2, endLine: 2 }, fullContent: BUGGY, uniqueHint: true, preferredText: 'return a - b' }
  const first = registerEditAnchor(s.live, { ...common, goal: 'Explain how add works.' })!
  assert.equal(first.relevance, 'LOW')
  assert.equal(first.origin, undefined)
  const second = registerEditAnchor(s.live, { ...common, goal: REQUEST })!
  assert.equal(second.anchorId, first.anchorId, 'the same text on the same file hash is the same anchor')
  assert.deepEqual(second.origin, ADD_ORIGIN)
  assert.equal(second.relevance, 'HIGH')
  assert.equal(s.stored().length, 1)
  ok('10: re-registering the same anchor text with provenance upgrades the stored anchor')
}

// 11. With a statement as the anchor, a whole exported function pasted over it nests an `export` inside the function. TypeScript's parser accepts that, so the guard has to refuse it itself;
//     everything legal stays legal (top-level exports, namespace bodies, strings and comments that merely say "export", dynamic import()).
{
  const { sourceSyntaxProblem } = await import('./foundrySyntaxGuard')
  const nested = 'export function add(a, b) {\n  export function add(a, b) {\n    return a + b\n  }\n}\n'
  assert.match(String(sourceSyntaxProblem('calc.mjs', nested)), /^syntax error at line 2: 'export' and 'import' declarations can only appear at the top level of a module$/)
  assert.match(String(sourceSyntaxProblem('calc.ts', "export function add(a: number, b: number) {\n  import x from 'y'\n  return a + b\n}\n")), /^syntax error at line 2:/)
  assert.match(String(sourceSyntaxProblem('calc.mjs', 'export function add(a, b) {\n  if (a) {\n    export default a\n  }\n  return b\n}\n')), /line 3/)
  const legal: Array<[string, string]> = [
    ['calc.mjs', BUGGY],
    ['a.mjs', 'export const a = 1\nexport default function () {}\nexport { a as b }\nexport * from "./x.mjs"\n'],
    ['a.ts', "namespace N {\n  export const x = 1\n}\ndeclare module 'm' {\n  export const y: number\n}\ndeclare global {\n  export interface Window { z: number }\n}\n"],
    ['a.mjs', "const text = 'export function nope() {}'\n// export const alsoNo = 1\n/* import x from 'y' */\n"],
    ['a.mjs', 'export async function load() {\n  const mod = await import("./x.mjs")\n  return mod\n}\n'],
    ['a.tsx', 'export function View() {\n  return <div>export import</div>\n}\n'],
  ]
  for (const [file, source] of legal) assert.equal(sourceSyntaxProblem(file, source), null, `${file}: ${source}`)
  assert.equal(sourceSyntaxProblem('notes.md', nested), null, 'only source files are checked')
  assert.match(String(sourceSyntaxProblem('calc.mjs', 'export function add(a, b) {\n  return a +\n')), /^syntax error at line/, 'ordinary parse errors are still reported first')
  ok('11: the syntax guard refuses a nested export/import, and nothing that is legal')
}

rmSync(tmp, { recursive: true, force: true })
console.log(`FOUNDRY_NAMED_BODY_ANCHOR_VALIDATION ${passed}/11`)
