/**
 * Workspace-scoped Foundry missions: a coding mission is bound to a validated workspace root and every operation below resolveRepoRoot() lands there.
 * Runs against real tools (file.read / file.write), the real workspace registry and real directories in an isolated temp base; nothing touches the user's data.
 */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let passed = 0
const ok = (name: string) => { passed += 1; console.log(`PASS ${name}`) }

const tmp = mkdtempSync(path.join(os.tmpdir(), 'wsbind-'))
const base = path.join(tmp, 'base') // stands in for the installed server's own root
const projects = path.join(tmp, 'projects')
const outside = path.join(tmp, 'outside')
for (const dir of [base, projects, outside]) mkdirSync(dir, { recursive: true })
process.env.REPO_ROOT = base
process.env.FOUNDRY_PROJECTS_ROOT = projects
process.env.WAR_ROOM_PROJECTS_ROOT = path.join(tmp, 'war-room-projects')
process.env.WAR_ROOM_ENGINEER_ALLOWED_ROOTS = projects
process.env.WAR_ROOM_LOCAL_DATA_DIR = path.join(tmp, 'app-data') // isolated app data: the code index and engineering memory never touch the user's real data

const { openExistingProjectWorkspace } = await import('./workspaceRegistry')
const { runWithWorkspaceRoot } = await import('@/lib/repo/workspaceContext')
const { resolveRepoRoot } = await import('@/lib/repo/paths')
const { executeEngineerTool } = await import('./engineerTools')
const { startMissionInput } = await import('./foundryMissionController')
const { buildCodeIndex, mapOwnership } = await import('./foundryCodeIntelligence')
const { runValidationOperation } = await import('./validationRunner')
const { sourceSyntaxProblem } = await import('./foundrySyntaxGuard')
const { isWarRoomSourceTree } = await import('./foundryWorkspaceKind')
const { foundryDataHierarchy } = await import('./foundryPaths')
const { WorkspaceBindingError, missionIsWriteCapable, missionWorkspaceScope, resolveWorkspaceBinding, validateWorkspaceRoot } = await import('./foundryWorkspaceBinding')

/** sha256 of every file under a directory except the runtime state directory, as path -> hash. */
function manifest(dir: string, skip = '.war-room'): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === skip) continue
      const abs = path.join(current, entry.name)
      if (entry.isDirectory()) walk(abs)
      else out[path.relative(dir, abs)] = createHash('sha256').update(readFileSync(abs)).digest('hex')
    }
  }
  walk(dir)
  return out
}

const makeProject = (name: string, files: Record<string, string>) => {
  const dir = path.join(projects, name)
  mkdirSync(dir, { recursive: true })
  for (const [rel, body] of Object.entries(files)) writeFileSync(path.join(dir, rel), body)
  return dir
}
const mission = (binding?: Awaited<ReturnType<typeof resolveWorkspaceBinding>>, permissions?: Partial<ReturnType<typeof startMissionInput>['permissions']>) => {
  const record = startMissionInput('Fix the add function and run the tests', 'ws test', {})
  record.permissions = { ...record.permissions, filesystem: true, terminal: true, ...permissions }
  if (binding) record.workspaceBinding = binding
  return record
}
const writeIn = async (scope: { root?: string; workspaceId?: string }, rel: string, content: string) => {
  assert.ok(scope.root, 'the mission has a scope root')
  return runWithWorkspaceRoot(scope.root, () => executeEngineerTool({ tool: 'file.write', input: { path: rel, content, reason: 'workspace binding validation' } }, { repairId: `ws-${randomUUID().slice(0, 8)}` }), scope.workspaceId)
}

const dirA = makeProject('A', { 'calc.mjs': 'export const add = (a, b) => a - b\n' })
const dirB = makeProject('B', { 'calc.mjs': 'export const add = (a, b) => a - b\n' })
const wsA = await openExistingProjectWorkspace(dirA, 'A')
const wsB = await openExistingProjectWorkspace(dirB, 'B')
const bindingA = await resolveWorkspaceBinding({ workspaceId: wsA.id })
const bindingB = await resolveWorkspaceBinding({ workspaceId: wsB.id })
assert.ok(bindingA && bindingB)
const baseBefore = manifest(base)
const aBefore = manifest(dirA)

// A. A mission bound to workspace A writes only inside A.
{
  const scope = await missionWorkspaceScope(mission(bindingA))
  assert.ok(scope.ok && scope.root === bindingA.workspaceRoot)
  const written = await writeIn(scope, 'only-in-a.txt', 'written for A\n')
  assert.equal(written.ok, true, String(written.error))
  assert.equal(readFileSync(path.join(dirA, 'only-in-a.txt'), 'utf8'), 'written for A\n')
  assert.equal(existsSync(path.join(dirB, 'only-in-a.txt')), false, 'not in B')
  assert.equal(existsSync(path.join(base, 'only-in-a.txt')), false, 'not in the base root')
  assert.equal(resolveRepoRoot(), base, 'outside the scope the root is unchanged')
  // The mission baseline (git state + file hashes, the step that failed in the installed smoke) is taken in the bound workspace, not the process root.
  const { recordMissionBaseline } = await import('./foundryWriteIsolation')
  const baselineMission = mission(bindingA)
  const baseline = await runWithWorkspaceRoot(bindingA.workspaceRoot, () => recordMissionBaseline(baselineMission, ['calc.mjs']), bindingA.workspaceId)
  assert.equal(baseline.fileHashes['calc.mjs'], createHash('sha256').update(readFileSync(path.join(dirA, 'calc.mjs'))).digest('hex'), 'the baseline hashes the workspace file')
  ok('A: a mission bound to workspace A writes only inside A')
}

// B. A mission bound to workspace B does not touch workspace A.
{
  const aMid = manifest(dirA)
  const scope = await missionWorkspaceScope(mission(bindingB))
  assert.ok(scope.ok && scope.root === bindingB.workspaceRoot)
  const written = await writeIn(scope, 'only-in-b.txt', 'written for B\n')
  assert.equal(written.ok, true, String(written.error))
  assert.equal(existsSync(path.join(dirB, 'only-in-b.txt')), true)
  assert.equal(existsSync(path.join(dirA, 'only-in-b.txt')), false)
  assert.deepEqual(manifest(dirA), aMid, 'workspace A is byte-identical after the B mission')
  ok('B: a mission bound to workspace B does not touch workspace A')
}

// C. A write-capable mission with no binding is BLOCKED on an installed runtime; it never defaults to the process root.
{
  const blocked = await missionWorkspaceScope(mission(), { baseRoot: base, classify: () => 'INSTALLED_RUNTIME' })
  assert.equal(blocked.ok, false)
  if (!blocked.ok) {
    assert.equal(blocked.code, 'WORKSPACE_BINDING_REQUIRED')
    assert.ok(/installed War Room runtime/.test(blocked.blocker.evidence) && /workspaceId/.test(blocked.blocker.unblock), blocked.blocker.evidence)
  }
  const dev = await missionWorkspaceScope(mission(), { baseRoot: base, classify: () => 'WAR_ROOM_SOURCE' })
  assert.ok(dev.ok && dev.root === undefined, 'a War Room source checkout keeps its existing behaviour')
  const readOnly = mission(undefined, { filesystem: false, terminal: false })
  assert.equal(missionIsWriteCapable(readOnly), false)
  const readOnlyScope = await missionWorkspaceScope(readOnly, { baseRoot: base, classify: () => 'INSTALLED_RUNTIME' })
  assert.ok(readOnlyScope.ok, 'a mission that cannot write is not blocked')
  ok('C: a write-capable mission with no binding is blocked on the installed runtime, never defaulted to the process root')
}

// D. Traversal and untrusted roots are rejected.
{
  const codes = async (candidate: string) => { const r = await validateWorkspaceRoot(candidate); return r.ok ? 'OK' : r.code }
  assert.equal(await codes(`${dirA}/../..`), 'WORKSPACE_PATH_TRAVERSAL')
  assert.equal(await codes('relative/path'), 'WORKSPACE_ROOT_NOT_ABSOLUTE')
  assert.equal(await codes(''), 'WORKSPACE_ROOT_MISSING')
  assert.equal(await codes(path.join(projects, 'does-not-exist')), 'WORKSPACE_ROOT_MISSING')
  assert.equal(await codes(outside), 'WORKSPACE_OUTSIDE_ALLOWED_ROOTS')
  assert.equal(await codes('/etc'), 'WORKSPACE_OUTSIDE_ALLOWED_ROOTS')
  const inTree = await validateWorkspaceRoot(dirA, { classify: () => 'INSTALLED_RUNTIME' })
  assert.ok(!inTree.ok && inTree.code === 'WORKSPACE_INSTALL_TREE', 'the install tree is refused')
  await assert.rejects(() => resolveWorkspaceBinding({ workspaceId: 'not-a-registered-workspace' }), (error: unknown) => error instanceof WorkspaceBindingError && error.code === 'WORKSPACE_UNKNOWN' && error.status === 404)
  ok('D: traversal, relative, missing, outside-root, install-tree and unknown-workspace requests are rejected')
}

// E. A symlink that leaves the allowed root is rejected, at binding time and when a bound root is later swapped for one.
{
  const escape = path.join(projects, 'escape')
  symlinkSync(outside, escape)
  const direct = await validateWorkspaceRoot(escape)
  assert.ok(!direct.ok && direct.code === 'WORKSPACE_SYMLINK_ESCAPE', JSON.stringify(direct))
  const dirC = makeProject('C', { 'x.txt': 'x\n' })
  const wsC = await openExistingProjectWorkspace(dirC, 'C')
  const bindingC = await resolveWorkspaceBinding({ workspaceId: wsC.id })
  assert.ok(bindingC)
  renameSync(dirC, `${dirC}.moved`)
  symlinkSync(outside, dirC)
  const swapped = await missionWorkspaceScope(mission(bindingC))
  assert.ok(!swapped.ok && swapped.code === 'WORKSPACE_SYMLINK_ESCAPE', JSON.stringify(swapped))
  ok('E: a symlink escape is rejected at binding time and when a bound root is swapped for one')
}

// F. Resume restores the same binding, and re-validates it.
{
  const saved = JSON.parse(JSON.stringify(mission(bindingA))) as ReturnType<typeof mission>
  const restored = await missionWorkspaceScope(saved)
  assert.ok(restored.ok && restored.root === bindingA.workspaceRoot && restored.workspaceId === bindingA.workspaceId)
  const dirD = makeProject('D', { 'y.txt': 'y\n' })
  const wsD = await openExistingProjectWorkspace(dirD, 'D')
  const bindingD = await resolveWorkspaceBinding({ workspaceId: wsD.id })
  assert.ok(bindingD)
  const alias = path.join(projects, 'alias-of-d')
  symlinkSync(dirD, alias)
  const aliasScope = await missionWorkspaceScope(mission({ ...bindingD, workspaceRoot: alias }))
  assert.ok(!aliasScope.ok && aliasScope.code === 'WORKSPACE_ROOT_CHANGED', JSON.stringify(aliasScope))
  renameSync(dirD, `${dirD}.gone`)
  const gone = await missionWorkspaceScope(JSON.parse(JSON.stringify(mission(bindingD))))
  assert.ok(!gone.ok && gone.code === 'WORKSPACE_ROOT_MISSING', JSON.stringify(gone))
  ok('F: resume restores the same binding and re-validates it (a moved or retargeted root blocks the mission)')
}

// G. Child and background work inherits the parent binding; an invalid request never falls back to another root.
{
  const child = await resolveWorkspaceBinding({ parentBinding: bindingA })
  assert.ok(child && child.workspaceRoot === bindingA.workspaceRoot && child.workspaceId === bindingA.workspaceId && child.source === 'PARENT')
  const inContext = await runWithWorkspaceRoot(bindingB.workspaceRoot, () => resolveWorkspaceBinding({}), bindingB.workspaceId)
  assert.ok(inContext && inContext.workspaceRoot === bindingB.workspaceRoot && inContext.source === 'CONTEXT')
  await assert.rejects(() => resolveWorkspaceBinding({ workspaceId: 'nope', parentBinding: bindingA }), WorkspaceBindingError)
  assert.equal(await resolveWorkspaceBinding({}), null, 'nothing to bind to')
  const runtime = readFileSync(path.join(process.cwd(), 'lib/native-builder/foundryMissionExecutiveRuntime.ts'), 'utf8')
  assert.ok(/cwd: resolveBaseRepoRoot\(\)/.test(runtime) && /PROJECT_WRITE:\$\{root\}/.test(runtime), 'child jobs run the runner from the War Room root and claim writes in the workspace')
  ok('G: child and background work inherits the parent binding; an invalid request never falls back to another root')
}

// I. Ownership and impact answer for the BOUND workspace: its own files, never the War Room product tree. The index is cached per root, and remembered owners from another tree never leak in.
{
  const indexIn = async (binding: NonNullable<typeof bindingA>) => {
    try { return await runWithWorkspaceRoot(binding.workspaceRoot, () => buildCodeIndex(), binding.workspaceId) } catch (error) { return assert.fail(`the project index could not be built: ${String(error).slice(0, 140)}`) }
  }
  const indexA = await indexIn(bindingA)
  assert.equal(indexA.root, bindingA.workspaceRoot, 'the index records the root it describes')
  assert.ok(indexA.files['calc.mjs'], 'a project with its source at the root is indexed')
  assert.ok(!Object.keys(indexA.files).some(file => file.startsWith('lib/native-builder') || file.startsWith('components/war-room')), 'no War Room product file in the index')
  const dirE = makeProject('E', { 'other.mjs': 'export const other = () => 1\n' })
  const wsE = await openExistingProjectWorkspace(dirE, 'E')
  const bindingE = await resolveWorkspaceBinding({ workspaceId: wsE.id })
  assert.ok(bindingE)
  const indexE = await indexIn(bindingE)
  assert.ok(indexE.files['other.mjs'] && !indexE.files['calc.mjs'], 'workspace E gets its own index, not A\'s cached one')
  const memoryDir = foundryDataHierarchy().engineeringMemory
  mkdirSync(memoryDir, { recursive: true })
  writeFileSync(path.join(memoryDir, 'index.json'), JSON.stringify({ updatedAt: new Date().toISOString(), facts: [], features: [{ feature: 'calc add function', owners: ['lib/native-builder/foundryWorkbenchW5.ts'], tests: [], sourceMission: 'war-room-source-mission', timestamp: new Date().toISOString(), confidence: 'high', lastVerified: new Date().toISOString() }] }))
  const owned = await runWithWorkspaceRoot(bindingA.workspaceRoot, () => mapOwnership('add calc function'), bindingA.workspaceId)
  assert.ok(owned.owners.includes('calc.mjs'), `the bound workspace's own file owns the request: ${owned.owners.join(',')}`)
  assert.ok(!owned.owners.some(file => file.startsWith('lib/native-builder')), `a remembered War Room owner must not leak into another workspace: ${owned.owners.join(',')}`)
  ok('I: ownership and impact answer for the bound workspace (per-root index, whole-project indexing, no remembered-owner leak)')
}

// J. The test step works inside a bound project: node_test accepts that project's own test files (not only War Room's scripts/foundry), still rejects non-test and escaping targets.
{
  const dirF = makeProject('F', {
    'calc.mjs': 'export const add = (a, b) => a + b\n',
    'calc.test.mjs': "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { add } from './calc.mjs'\ntest('add', () => { assert.equal(add(2, 3), 5) })\n",
  })
  const wsF = await openExistingProjectWorkspace(dirF, 'F')
  const bindingF = await resolveWorkspaceBinding({ workspaceId: wsF.id })
  assert.ok(bindingF)
  const inF = <T>(fn: () => Promise<T>) => runWithWorkspaceRoot(bindingF.workspaceRoot, fn, bindingF.workspaceId) as Promise<T>
  const passed1 = await inF(() => runValidationOperation({ id: 'node_test', targets: ['calc.test.mjs'] }))
  assert.equal(passed1.ok, true, `${passed1.stderr} ${passed1.stdout.slice(0, 200)}`)
  assert.ok(/pass 1/.test(passed1.stdout), passed1.stdout.slice(0, 300))
  const notATest = await inF(() => runValidationOperation({ id: 'node_test', targets: ['calc.mjs'] }))
  assert.equal(notATest.ok, false)
  assert.ok(/\*\.test\.\* or \*\.spec\.\* files inside the workspace/.test(notATest.stderr), notATest.stderr)
  await assert.rejects(() => inF(() => runValidationOperation({ id: 'node_test', targets: ['../outside.test.mjs'] })), 'a target that leaves the workspace is refused')
  const fake = path.join(tmp, 'fake-war-room')
  mkdirSync(path.join(fake, 'lib', 'native-builder'), { recursive: true })
  mkdirSync(path.join(fake, 'app', 'api'), { recursive: true })
  assert.equal(isWarRoomSourceTree(fake), true)
  assert.equal(isWarRoomSourceTree(dirF), false)
  ok('J: node_test runs a bound project\'s own test files; non-test and escaping targets are refused; the War Room tree keeps its convention')
}

// K. An edit that would turn a parseable file into a broken one is refused before anything is written.
{
  assert.equal(sourceSyntaxProblem('calc.mjs', 'export function add(a, b) {\n  return a + b\n}\n'), null)
  const broken = sourceSyntaxProblem('calc.mjs', 'export export function add(a, b) {\n  return a + b\n}(a, b) {\n  return a - b\n}\n')
  assert.ok(broken && /^syntax error/.test(broken), String(broken))
  assert.equal(sourceSyntaxProblem('notes.md', 'export export ((('), null, 'non-source files are not parsed')
  const edit = readFileSync(path.join(process.cwd(), 'lib/native-builder/foundryBoundedEdit.ts'), 'utf8')
  const guard = edit.indexOf('if (brokenAfter && !sourceSyntaxProblem(input.path, current.content))')
  const apply = edit.indexOf('const applied = await applyProposal(ctx.repairId, proposal)')
  assert.ok(guard > 0 && apply > guard, 'the syntax guard runs before the patch is applied')
  assert.ok(/brokenAfter && !sourceSyntaxProblem\(input\.path, current\.content\)/.test(edit), 'only an edit that breaks a parseable file is refused')
  ok('K: an edit that would leave a parseable source file unparseable is refused before it is written')
}

// H. The installed runtime root is untouched by scratch-project missions (it only gains the workspace registry).
{
  const baseAfter = manifest(base)
  assert.deepEqual(baseAfter, baseBefore, 'no file outside .war-room changed in the base root')
  assert.deepEqual(Object.keys(baseAfter), [], 'the base root holds no product files created by missions')
  const state = existsSync(path.join(base, '.war-room')) ? readdirSync(path.join(base, '.war-room')).sort() : []
  assert.deepEqual(state, ['workspaces'], `the base root gained only the workspace registry, got ${state.join(',')}`)
  assert.equal(statSync(base).isDirectory(), true)
  assert.ok(Object.keys(manifest(dirA)).length > Object.keys(aBefore).length, 'the work happened in the scratch workspace')
  ok('H: the installed runtime root is untouched by scratch-project missions (only the workspace registry state appears)')
}

// Wiring guards: the binding is persisted at start, every run re-binds, and the base-root misuse is gone.
{
  const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8')
  const controller = read('lib/native-builder/foundryMissionController.ts')
  assert.ok(/mission\.workspaceBinding = binding/.test(controller) && /resolveWorkspaceBinding\(/.test(controller), 'startMission persists the binding')
  assert.ok(/const run = runModelMissionInWorkspace\(missionId, suppliedRouter\)/.test(controller), 'every run goes through the workspace wrapper')
  assert.ok(/runWithWorkspaceRoot\(root, \(\) => runModelMissionUnlocked/.test(controller), 'the run executes inside the bound root')
  assert.ok(!/resolveBaseRepoRoot/.test(read('lib/native-builder/foundryWriteIsolation.ts')), 'write isolation uses the active root')
  assert.ok(/workspaceId: body\.workspaceId/.test(read('app/api/foundry/missions/route.ts')), 'the missions route accepts workspaceId')
  ok('wiring: the binding is persisted at start, every run re-binds, and write isolation uses the active root')
}

rmSync(tmp, { recursive: true, force: true })
console.log(`FOUNDRY_WORKSPACE_BINDING_VALIDATION ${passed}/12`)
