/** Regression guards for defects found by the Phase 8 Mission Control build: torn lock files, truncated rewrite prompts, no-op rewrites. */
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { acquireResource, setResourceLockRootForTests } from './foundryResourceLocks'
import { syntaxProblem } from './foundryEngineeringGateTable'
import { authoringReferences, buildLocalFoundryModelPrompt } from './foundryLocalModelRuntime'
import { compactDiagnostics } from './foundryEngineeringGateTable'
import type { FoundryModelRequest } from './foundryModelTypes'
import { AUTHORING_MAX_CHANGED_LINES, validatePatchPolicy } from './patchPolicy'
import type { NativeRepairProposal } from './types'
import { consoleOutputIsIntended } from './foundryEngineeringDepth'
import { setExecutiveRootForTests, setMissionCeilings, loadExecutiveState } from './foundryMissionExecutiveRuntime'
import { saveMissionState } from './foundryMissionExecutive'
import { authoringProgress } from './foundryEngineeringGateTable'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { coerceReplanWithTool, toRepoRelativeTarget } from './foundryEngineeringContract'
import { WHOLE_FILE_WRITE_MAX_LINES, wholeFileWriteAdvice } from './foundryBoundedEdit'
import { DRIVABLE_GATE_TOOLS, DRIVE_AFTER_COMPLETE_REFUSALS, gateDrivenToolDecision } from './foundryGateDrive'
import { ACTIVE_GAP_MS, activeElapsedMs, advanceActiveClock, MAX_TRANSIENT_WAITS, childEnvelopeLimits, isTransientChildWait } from './foundryMissionExecutive'

const dir = mkdtempSync(path.join(os.tmpdir(), 'foundry-authoring-'))
let passed = 0
const ok = (name: string) => { passed += 1; console.log(`PASS ${name}`) }

// 1. An empty (torn) PROVIDER_SLOT.json left by a killed writer must not wedge the slot forever.
setResourceLockRootForTests(dir)
const torn = path.join(dir, 'PROVIDER_SLOT.json')
writeFileSync(torn, '')
const old = new Date(Date.now() - 60_000)
utimesSync(torn, old, old)
const slot = await acquireResource({ resource: 'PROVIDER_SLOT', missionId: 'm1', operation: 'probe', exclusive: true, waitMs: 3_000 })
assert.equal(slot.state, 'ACQUIRED')
if (slot.state === 'ACQUIRED') await slot.release()
ok('torn empty lock file is reclaimed instead of wedging the slot')
setResourceLockRootForTests(null)

// 2. A cut-off source file is detected as such; a complete one is not.
const cut = path.join(dir, 'cut.ts')
writeFileSync(cut, 'export function f(a: number) {\n  const x = {\n    a,\n    t')
assert.ok(syntaxProblem(cut)?.startsWith('syntax error'))
const whole = path.join(dir, 'whole.ts')
writeFileSync(whole, 'export const f = (a: number): number => a + 1\n')
assert.equal(syntaxProblem(whole), null)
ok('syntaxProblem flags a truncated file and passes a complete one')

// 3. The authoring prompt keeps its tail (TOOLS + decision instruction) and the whole request even for a large current file.
const big = Array.from({ length: 1500 }, (_, i) => `export const value${i} = ${i}`).join('\n')
const request = {
  kind: 'diagnoseFailure',
  context: {
    userRequest: 'Rewrite file lib/x.ts. The tsc check reports: line 3: bad. Fix exactly these problems.',
    importantFindings: ['AUTHORING: Rewrite lib/x.ts now with file.write (path, content, reason).', `AUTHORING_CURRENT: --- lib/x.ts (current) ---\n${big}`],
    tools: [{ name: 'file.write', args: { path: 'string' }, required: ['path'] }],
    recentToolResults: [], recentErrors: [], completionGate: { missing: ['SOURCE_DONE'], detail: '' },
  },
} as unknown as FoundryModelRequest
const prompt = buildLocalFoundryModelPrompt(request)
assert.ok(prompt.endsWith('Return one JSON decision now.'), 'instruction tail must survive')
assert.ok(prompt.includes('TOOLS:\n- file.write'))
assert.ok(prompt.includes('Fix exactly these problems.'))
assert.ok(prompt.includes('FILE CUT OFF HERE'), 'an over-budget file must say it was cut, not look complete')
ok('authoring prompt trims the file, never the instructions, and labels a cut file')

// 4. A whole-file rewrite of an assigned ~160-line file is over the self-repair cap by default, and within the explicit authoring allowance.
const body = Array.from({ length: 80 }, (_, i) => `export const v${i} = ${i}`).join('\n')
const rewrite = {
  issueId: 'r', sourceKind: 'deterministic', proposerId: 't', diagnosis: 'd', confidence: 'medium', relevantFiles: ['lib/x.ts'], validations: [], risks: [], rollbackPlan: 'r', generatedAt: new Date().toISOString(),
  plannedChanges: [{ file: 'lib/x.ts', reason: 'r', operation: 'replace_range', patch: { operation: 'replace_range', file: 'lib/x.ts', expectedOriginalHash: 'h', matchText: body, replacementText: body } }],
} as unknown as NativeRepairProposal
assert.ok(validatePatchPolicy(rewrite, 'war_room_repair').violations.some(item => item.rule === 'max_lines_exceeded'))
assert.equal(validatePatchPolicy(rewrite, 'war_room_repair', { maxChangedLines: AUTHORING_MAX_CHANGED_LINES }).ok, true)
ok('assigned-file rewrite passes with the authoring allowance; default cap unchanged')

// 5. The contract a file must satisfy (its relative imports) reaches the model; diagnostics are compacted so more of them fit.
const refs = authoringReferences(['lib/native-builder/foundryMissionControlView.ts'], "Import types from './foundryMissionControlTypes'", '')
assert.ok(refs.includes('McInput') && refs.includes('read-only reference'))
assert.equal(authoringReferences(['lib/native-builder/a.ts'], "from './a'", ''), '')
const compact = compactDiagnostics('lib/x.ts(11,11): error TS2339: Property a missing\nlib/x.ts(12,11): error TS2339: Property b missing', ['lib/x.ts'], 500)
assert.ok(!compact.includes('lib/x.ts') && compact.includes('TS2339'))
const withSource = compactDiagnostics('lib/native-builder/foundryMissionControlTypes.ts(1,1): error TS2339: Property q missing', ['lib/native-builder/foundryMissionControlTypes.ts'], 500)
assert.ok(/line 1 `.+`: TS2339/.test(withSource), withSource)
ok('import contract is supplied read-only and diagnostics are compacted')

// 6. a child that merely waited (shared resource, provider) is not a failed attempt; a real failure is.
assert.equal(isTransientChildWait('WAITING_RESOURCE: Waiting for a shared Foundry resource - REPO_WRITE busy (holder abc)'), true)
assert.equal(isTransientChildWait('PAUSED: Transient model provider outage - RESOURCE_BUDGET_EXHAUSTED'), true)
assert.equal(isTransientChildWait('BLOCKED: NARROW_REPAIR_STAGNANT - 2 TypeScript diagnostic(s) remain'), false)
assert.equal(isTransientChildWait('the child mission did not complete'), false)
assert.ok(MAX_TRANSIENT_WAITS >= 1 && MAX_TRANSIENT_WAITS <= 20, 'waiting is bounded so a stuck resource cannot loop forever')
ok('waiting on a shared resource is classified apart from real failures, and bounded')

// 7. a child budget derived from the approved ceilings also scales its build/test sub-meters, and never exceeds what is left.
{
  const limits = childEnvelopeLimits({ maxModelCalls: 600, maxToolCalls: 1200, maxWallMs: 8 * 3_600_000 }, { modelCalls: 402, toolCalls: 879, wallMs: 3_600_000 }, 0.5, 8_000, 2_000)
  assert.equal(limits.maxModelCalls, 198, 'capped by what is left of the approved ceiling')
  assert.equal(limits.maxToolCalls, 321)
  assert.ok(limits.maxBuildRuns >= 30 && limits.maxTestRuns >= 30, `sub-meters scale with the tool allowance: ${limits.maxBuildRuns}/${limits.maxTestRuns}`)
  const tiny = childEnvelopeLimits({ maxModelCalls: 40, maxToolCalls: 100, maxWallMs: 3_600_000 }, { modelCalls: 0, toolCalls: 0, wallMs: 0 }, 0.5, 8_000, 2_000)
  assert.ok(tiny.maxBuildRuns >= 6 && tiny.maxTestRuns >= 12, 'never below the governor defaults')
  assert.ok(limits.maxTotalTokens === limits.maxModelCalls * 10_000)
  ok('child envelope: model/tool capped by the remaining approved ceiling, build/test sub-meters scaled, defaults are a floor')
}

// 8. console output is the product of a validator/proof/script or of a request that asks for logged output; it is still a leftover in product code.
assert.equal(consoleOutputIsIntended(['lib/x/view.validation.ts'], 'Create the new file lib/x/view.validation.ts'), true)
assert.equal(consoleOutputIsIntended(['scripts/run.ts'], 'add a script'), true)
assert.equal(consoleOutputIsIntended(['lib/x/a.proof.ts'], 'prove it'), true)
assert.equal(consoleOutputIsIntended(['lib/x/view.ts'], 'Count each passed check with a console.log line and end by logging N/N'), true)
assert.equal(consoleOutputIsIntended(['lib/x/view.ts'], 'Refactor the view helper'), false, 'product code with no request for output: console.log is still a leftover')
assert.equal(consoleOutputIsIntended(['lib/x/view.ts', 'lib/x/view.validation.ts'], 'Refactor'), false, 'one product file among them: the finding stays')
ok('console output is exempt from the debug-marker review only where it is the product')

// 9. the wall-clock ceiling counts active execution, not idle time (blocked, waiting for a decision, process gone).
{
  const start = '2026-01-01T00:00:00.000Z'
  const t0 = Date.parse(start)
  let ceilings = { startedAt: start, activeMs: undefined as number | undefined, activeAt: undefined as string | undefined }
  assert.equal(activeElapsedMs(ceilings, t0 + 5 * 3_600_000), 5 * 3_600_000, 'no active accounting yet: calendar time (the old behaviour)')
  ceilings = advanceActiveClock(ceilings, t0)
  // two minutes of ticking, then a 3 hour silence (blocked / waiting for the Commander), then one minute of ticking
  for (let m = 1; m <= 2; m++) ceilings = advanceActiveClock(ceilings, t0 + m * 60_000)
  ceilings = advanceActiveClock(ceilings, t0 + 2 * 60_000 + 3 * 3_600_000)
  for (let m = 1; m <= 1; m++) ceilings = advanceActiveClock(ceilings, t0 + 2 * 60_000 + 3 * 3_600_000 + m * 60_000)
  const at = t0 + 2 * 60_000 + 3 * 3_600_000 + 60_000
  assert.equal(activeElapsedMs(ceilings, at), 3 * 60_000, 'three minutes active; the 3 hour silence is not counted')
  assert.equal(activeElapsedMs(ceilings, at + 2 * 60_000), 5 * 60_000, 'a tick-less stretch shorter than the gap still counts as running')
  assert.equal(activeElapsedMs(ceilings, at + ACTIVE_GAP_MS + 1), 3 * 60_000, 'no tick for longer than the gap: the mission is idle, the clock stops')
  ok('active-time accounting: continuous ticks count, idle gaps do not, legacy missions fall back to calendar time')
}

// 10. an absolute path inside the repository is the same write target as its repo-relative form; one outside stays outside.
assert.equal(toRepoRelativeTarget('/repo/root/components/a/B.tsx', '/repo/root'), 'components/a/B.tsx')
assert.equal(toRepoRelativeTarget('components/a/B.tsx', '/repo/root'), 'components/a/B.tsx')
assert.equal(toRepoRelativeTarget('/etc/passwd', '/repo/root'), '/etc/passwd', 'outside the repository: unchanged, so the safety check still refuses it')
assert.equal(toRepoRelativeTarget('/repo/root/../other/x.ts', '/repo/root'), '/repo/root/../other/x.ts', 'a path that escapes the root is not rewritten')
ok('absolute repo paths are normalised before the write-safety check; outside paths are not')

// 11. changing the ceilings never drops the accounting that makes the wall-clock ceiling mean ACTIVE time (a dropped clock silently fell back to calendar time).
{
  const execRoot = mkdtempSync(path.join(os.tmpdir(), 'foundry-ceil-'))
  setExecutiveRootForTests(execRoot)
  const id = 'ceiling-preserve'
  const start = '2026-01-01T00:00:00.000Z'
  const state = loadExecutiveState(id, 'goal')
  state.ceilings = { maxModelCalls: 10, maxToolCalls: 20, maxWallMs: 3_600_000, startedAt: start, approvedBy: 'test', activeMs: 123_000, activeAt: '2026-01-01T00:02:03.000Z', priorWindows: [{ startedAt: start, resetAt: start, reason: 'r', modelCalls: 1, toolCalls: 2 }] }
  saveMissionState(execRoot, id, state)
  setMissionCeilings(id, { maxModelCalls: 99, maxToolCalls: 199, maxWallMs: 3_600_000, approvedBy: 'raised' })
  const after = loadExecutiveState(id).ceilings!
  assert.equal(after.maxModelCalls, 99)
  assert.equal(after.activeMs, 123_000, 'the active clock survives a ceiling change')
  assert.equal(after.activeAt, '2026-01-01T00:02:03.000Z')
  assert.equal(after.priorWindows?.length, 1, 'the window history survives too')
  assert.equal(after.startedAt, start)
  setExecutiveRootForTests(null)
  rmSync(execRoot, { recursive: true, force: true })
  ok('raising a ceiling preserves usage history: active clock, window history and start')
}

// 12. a REPLAN that carries a complete tool call is a TOOL decision in the wrong envelope; a bare REPLAN is not.
{
  const withTool = { decision: 'REPLAN', reasoningSummary: 'x', tool: { name: 'file.write', args: { path: 'a.ts', content: 'x' } } }
  assert.deepEqual(coerceReplanWithTool(withTool)?.decision, 'TOOL')
  assert.equal(coerceReplanWithTool({ decision: 'REPLAN', reasoningSummary: 'x' }), null)
  assert.equal(coerceReplanWithTool({ decision: 'REPLAN', tool: { name: '', args: {} } }), null)
  assert.equal(coerceReplanWithTool({ decision: 'REPLAN', tool: { name: 'file.write' } }), null, 'no arguments: not a call')
  assert.equal(coerceReplanWithTool({ decision: 'TOOL', tool: { name: 'file.write', args: {} } }), null, 'already a TOOL decision')
  ok('REPLAN carrying a complete tool call is run as a tool call; a bare REPLAN stays a REPLAN')
}

// 13. lint.run and typecheck.run passing is not "done" while the repair engine still sees an error they cannot (a dropped-data stub).
{
  const rel = `scripts/__authoring_gate_${process.pid}.ts`
  const abs = path.join(resolveRepoRoot(), rel)
  try {
    const mission = (text: string) => ({ userRequest: `Create the new file ${rel}. ${text}`, toolCalls: [{ tool: 'file.write', ok: true }, { tool: 'lint.run', ok: true }, { tool: 'typecheck.run', ok: true }], engineering: undefined } as never)
    writeFileSync(abs, ['export function load(source: { items?: string[] }) {', '  const tasks = source.items', '  return { tasks: [] }', '}', ''].join('\n'))
    const stubbed = authoringProgress(mission('stub'))
    assert.ok(stubbed && stubbed.phase === 'WRITE' && stubbed.fixing && /^TypeScript found problems/.test(stubbed.detail) && /stub:EMPTY_VALUE/.test(stubbed.detail), `not DONE while a stub remains: ${stubbed?.phase} ${stubbed?.detail.slice(0, 120)}`)
    writeFileSync(abs, ['export function load(source: { items?: string[] }) {', '  const tasks = source.items', '  return { tasks: tasks ?? [] }', '}', ''].join('\n'))
    const clean = authoringProgress(mission('clean'))
    assert.ok(clean && clean.phase !== 'WRITE', `a clean file moves on to review: ${clean?.phase}`)
    ok('authoring gate: a file with a stub (or runtime-breaking import) that lint/typecheck pass is routed to repair, not DONE')
  } finally { rmSync(abs, { force: true }) }
}

// 14. An anchorless replace_unique that cannot resolve an anchor on a short file is told to rewrite the file whole; anything else is left alone.
{
  const short = Array.from({ length: 64 }, (_, i) => `line ${i}`).join('\n')
  const long = Array.from({ length: WHOLE_FILE_WRITE_MAX_LINES + 5 }, (_, i) => `line ${i}`).join('\n')
  const notFound = 'ANCHOR_NOT_FOUND: file.read a focused region to acquire a current EDIT_ANCHOR.'
  const ambiguous = 'ANCHOR_AMBIGUOUS: select one anchorId from the last file.read. Do not guess.'
  for (const error of [notFound, ambiguous]) {
    const advice = wholeFileWriteAdvice({ path: 'lib/x.ts' }, short, error)
    assert.ok(advice && /^WHOLE_FILE_WRITE_REQUIRED/.test(advice) && /file\.write/.test(advice) && advice.includes(error.split(':')[0]), `short file, no anchor: ${advice}`)
  }
  assert.equal(wholeFileWriteAdvice({ path: 'lib/x.ts', anchorId: 'A1' }, short, notFound), null, 'a named anchor that fails is a stale/foreign anchor, not this case')
  assert.equal(wholeFileWriteAdvice({ path: 'lib/x.ts' }, long, notFound), null, 'a long file keeps the anchor workflow')
  assert.equal(wholeFileWriteAdvice({ path: 'lib/x.ts' }, short, 'STALE_EDIT_ANCHOR expected=a actual=b'), null, 'other errors are not rewritten')
  assert.equal(WHOLE_FILE_WRITE_MAX_LINES, 200, 'the documented limit')
  ok('short file without an anchor: replace_unique failure becomes a whole-file write instruction; anchored, long-file and other errors are untouched')
}

// 15. A declared file that already exists and passes every check is not "done" until this mission has written it.
{
  const rel = `scripts/__authoring_noop_${process.pid}.ts`
  const abs = path.join(resolveRepoRoot(), rel)
  try {
    writeFileSync(abs, 'export const value: number = 1\n')
    const calls = (withWrite: boolean) => [...(withWrite ? [{ tool: 'file.write', ok: true }] : []), { tool: 'lint.run', ok: true }, { tool: 'typecheck.run', ok: true }, { tool: 'engineering.review', ok: true }]
    const mission = (withWrite: boolean) => ({ userRequest: `Create the new file ${rel}. Export value as the number 2.`, toolCalls: calls(withWrite), engineering: { selfReview: { status: 'PASS', findings: [] } } } as never)
    const untouched = authoringProgress(mission(false))
    assert.ok(untouched && untouched.phase === 'WRITE' && !untouched.fixing && /nothing has been written yet/.test(untouched.detail), `an untouched valid file is not DONE: ${untouched?.phase} ${untouched?.detail}`)
    const written = authoringProgress(mission(true))
    assert.ok(written && written.phase === 'DONE', `after this mission wrote it: ${written?.phase}`)
    const confirmed = authoringProgress({ userRequest: `Create the new file ${rel}. Export value as the number 2.`, toolCalls: [{ tool: 'file.write', ok: false, error: 'NO_CHANGE: the content is identical to the file as it already is on disk.' }, ...calls(false)], engineering: { selfReview: { status: 'PASS', findings: [] } } } as never)
    assert.ok(confirmed && confirmed.phase === 'DONE', `a write rejected as NO_CHANGE means the file already is what was requested: ${confirmed?.phase}`)
    const otherFailure = authoringProgress({ userRequest: `Create the new file ${rel}. Export value as the number 2.`, toolCalls: [{ tool: 'file.write', ok: false, error: 'PATCH_REJECTED: the replacement is over 80 lines.' }, ...calls(false)], engineering: { selfReview: { status: 'PASS', findings: [] } } } as never)
    assert.ok(otherFailure && otherFailure.phase === 'WRITE', `any other rejected write is not a confirmation: ${otherFailure?.phase}`)
    ok('authoring gate: an existing valid file the mission never wrote is routed to WRITE, not DONE; once written it is DONE')
  } finally { rmSync(abs, { force: true }) }
}

// 16. spawn('node', [literal flags...]) in app-reachable code breaks the production build (Turbopack tries to bundle '--loader' as a module); process.execPath callers build fine.
{
  const libDir = path.join(resolveRepoRoot(), 'lib', 'native-builder')
  const pattern = /spawn(?:Sync)?\(\s*(?:'node'|"node")\s*,\s*\[\s*['"]--/
  const offenders = readdirSync(libDir)
    .filter(name => name.endsWith('.ts') && !/\.(?:validation|proof)\.ts$/.test(name))
    .filter(name => pattern.test(readFileSync(path.join(libDir, name), 'utf8')))
  assert.deepEqual(offenders, [], `literal node flag arrays fail the Turbopack build: ${offenders.join(', ')}`)
  ok('no production module spawns node with a literal flag array (Turbopack build guard)')
}

// 17. A model that keeps asking to COMPLETE while a read-only evidence tool is required has that step run by the controller; it never drives anything that writes.
{
  const table = (nextRequiredAction: string, recommendedToolClass: string | null) => ({ nextRequiredAction, recommendedToolClass })
  assert.equal(DRIVE_AFTER_COMPLETE_REFUSALS, 2, 'the documented threshold')
  assert.equal(gateDrivenToolDecision({ table: table('TOOL', 'code.impact'), refusals: 1, goal: 'g' }), null, 'one refusal is not enough')
  const impact = gateDrivenToolDecision({ table: table('TOOL', 'code.impact'), refusals: 2, goal: 'fix add' })
  assert.ok(impact && impact.decision === 'TOOL' && impact.tool?.name === 'code.impact' && Object.keys(impact.tool.args).length === 0, JSON.stringify(impact))
  const owners = gateDrivenToolDecision({ table: table('TOOL', 'code.owners'), refusals: 3, goal: 'fix add' })
  assert.deepEqual(owners?.tool, { name: 'code.owners', args: { query: 'fix add' } })
  assert.ok(gateDrivenToolDecision({ table: table('TOOL', 'engineering.baseline'), refusals: 2, goal: 'g' }))
  for (const writer of ['file.write', 'file.replace_unique', 'file.patch', 'terminal.execute', 'build.run', 'installer.activate']) {
    assert.equal(gateDrivenToolDecision({ table: table('TOOL', writer), refusals: 9, goal: 'g' }), null, `${writer} is never driven by the controller`)
    assert.ok(!(DRIVABLE_GATE_TOOLS as readonly string[]).includes(writer))
  }
  assert.equal(gateDrivenToolDecision({ table: table('COMPLETE', 'code.impact'), refusals: 9, goal: 'g' }), null, 'only while a tool is the next required action')
  assert.equal(gateDrivenToolDecision({ table: table('TOOL', null), refusals: 9, goal: 'g' }), null)
  const controller = readFileSync(path.join(resolveRepoRoot(), 'lib/native-builder/foundryMissionController.ts'), 'utf8')
  assert.ok(/gateDrivenToolDecision\(\{ table: buildEngineeringGateTable\(mission\), refusals: completeRefusedForTool/.test(controller) && /response\.decision = driven/.test(controller) && /completeRefusedForTool \+= 1/.test(controller), 'the controller hooks the helper into the COMPLETE branch')
  ok('a model refusing a required read-only evidence tool has it run by the controller; writes are never driven')
}

rmSync(dir, { recursive: true, force: true })
console.log(`FOUNDRY_AUTHORING_ROBUSTNESS_VALIDATION ${passed}/17`)
