/**
 * Test/proof support for the blueprint integration (validators and the controlled live proof). NEVER imported by routes.
 * Seeds a SANDBOX War Room data root with the REAL stores the live adapters read: a git workspace registered in the workspace registry, a real Foundry mission
 * record (built with the live mission builder, bound to the workspace, moved to EXECUTING through the live legal transitions, with an established write set), and a
 * real Agent Ops agent + RUNNING assignment (created through the live registry/assignment functions). It never touches the real data root: callers must configure
 * the sandbox environment first (configureSandboxEnv).
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentOpsLog } from '@/lib/agents/ops/log'
import { AgentRegistry } from '@/lib/agents/ops/registry'
import { assign, startAssignment } from '@/lib/agents/ops/engineering/assignments'
import { ALL_TOOLS, C, addAgent, draftFor } from '@/lib/agents/ops/engineering/engtestkit'
import { startMissionInput } from '../foundryMissionController'
import { saveMission, transitionMission } from '../foundryMissionStore'
import { establishMissionWriteSet, persistMissionWriteSet } from '../foundryMissionWriteSet'
import { resolveWorkspaceBinding } from '../foundryWorkspaceBinding'
import { openExistingProjectWorkspace } from '../workspaceRegistry'
import { hash } from './base.mjs'

export type SandboxPaths = { root: string; dataDir: string; projectsRoot: string; repoRoot: string }

export function createSandboxRoot(prefix = 'wr-blueprint-sandbox-'): SandboxPaths {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
  const paths = { root, dataDir: path.join(root, 'data'), projectsRoot: path.join(root, 'WarRoomProjects'), repoRoot: path.join(root, 'repo-root') }
  for (const d of [paths.dataDir, paths.projectsRoot, paths.repoRoot]) fs.mkdirSync(d, { recursive: true })
  return paths
}

/** Redirects every War Room store the blueprint adapters touch into the sandbox (process-wide env; call before importing/using the stores). */
export function configureSandboxEnv(p: SandboxPaths): void {
  process.env.WAR_ROOM_LOCAL_DATA_DIR = p.dataDir
  process.env.WAR_ROOM_PROJECTS_ROOT = p.projectsRoot
  process.env.REPO_ROOT = p.repoRoot
  process.env.FOUNDRY_PROJECTS_ROOT = path.join(p.root, 'FoundryProjects')
  delete process.env.WAR_ROOM_AGENT_FOUNDRY_DIR
  delete process.env.WAR_ROOM_LEARNING_DIR
}

export const FIXTURE_A0 = 'export const a = 1\n'
export const FIXTURE_A1 = 'export const a = 2\n'
export const FIXTURE_GREETING = "import dep from 'tiny-dep'\nexport const greeting = dep.describe()\n"
const GIT_ENV = (home: string) => ({ PATH: process.env.PATH ?? '', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', HOME: home })
export function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=blueprint-fixture', '-c', 'user.email=blueprint-fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, env: GIT_ENV(cwd) as unknown as NodeJS.ProcessEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

export function writeFixtureWorkspace(root: string, { withDependency = true } = {}): void {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/a.mjs'), FIXTURE_A0)
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n')
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'blueprint-fixture', version: '0.0.0', private: true, dependencies: withDependency ? { 'tiny-dep': '1.2.3' } : {} }, null, 2))
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: withDependency ? { 'node_modules/tiny-dep': { version: '1.2.3', integrity: 'sha512-blueprint-fixture' } } : {} }, null, 2))
  if (withDependency) {
    const d = path.join(root, 'node_modules/tiny-dep')
    fs.mkdirSync(d, { recursive: true })
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'tiny-dep', version: '1.2.3', main: 'index.js' }))
    fs.writeFileSync(path.join(d, 'index.js'), "module.exports = { describe: () => 'tiny-dep@1.2.3' }\n")
  }
  git(root, ['init', '-q', '-b', 'main'])
  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', 'fixture baseline'])
}

export type SeedResult = { workspaceId: string; workspaceRoot: string; missionId: string; assignmentId: string; agentId: string; writeScope: string[] }

/** Seed a registered workspace + EXECUTING mission (established write set) + RUNNING assignment owned by an ACTIVE agent. */
export async function seedBlueprintSandbox(p: SandboxPaths, opts: { name?: string; writeScope?: string[]; withDependency?: boolean } = {}): Promise<SeedResult> {
  const root = path.join(p.projectsRoot, opts.name ?? 'blueprint-fixture')
  fs.mkdirSync(root, { recursive: true })
  writeFixtureWorkspace(root, { withDependency: opts.withDependency !== false })
  const ws = await openExistingProjectWorkspace(root, 'Blueprint fixture workspace')
  const writeScope = opts.writeScope ?? ['src/a.mjs', 'src/greeting.mjs', 'src/extra-allowed.mjs']
  const mission = startMissionInput('Add a small greeting utility module to the fixture workspace', 'Blueprint fixture feature', { workspaceId: ws.id })
  const binding = await resolveWorkspaceBinding({ workspaceId: ws.id })
  if (!binding) throw new Error('workspace binding did not resolve')
  mission.workspaceBinding = binding
  mission.workspace = binding.workspaceRoot
  mission.repoIdentity = binding.workspaceRoot
  if (mission.kind === 'app_builder') throw new Error('seed mission was classified app_builder; adjust the request text')
  await saveMission(mission)
  for (const next of ['UNDERSTANDING', 'PLANNING', 'EXECUTING'] as const) await transitionMission(mission, next, 'blueprint sandbox seed')
  establishMissionWriteSet(mission, { paths: writeScope, reason: 'blueprint fixture write scope', ownerEvidence: 'blueprint sandbox seed', sourceStep: 'BLUEPRINT_SEED' })
  await persistMissionWriteSet(mission)
  await saveMission(mission)

  const log = new AgentOpsLog()
  const reg = new AgentRegistry(log)
  const agentId = `blueprint-agent-${hash(ws.id).slice(0, 8)}`
  addAgent({ dir: '', log, reg }, agentId, 'feature_implementation', ALL_TOOLS)
  const draft = draftFor(agentId, mission.missionId, 'Add greeting utility through a reviewed blueprint package', { workspace: { id: ws.id, root: binding.workspaceRoot, kind: 'project' } })
  const { assignment } = assign(log, draft, C, new Date())
  startAssignment(log, assignment.id, 'system:runner', new Date())
  return { workspaceId: ws.id, workspaceRoot: binding.workspaceRoot, missionId: mission.missionId, assignmentId: assignment.id, agentId, writeScope }
}

/** The bounded, safe package used by the controlled proof: replaces src/a.mjs, creates src/greeting.mjs (uses the verified tiny-dep), requests the host recipe. */
export function fixturePackage(input: { workspaceId: string; baseRevision: string; over?: Record<string, unknown> }): string {
  const changes = [
    { path: 'src/a.mjs', operation: 'replace', beforeHash: hash(FIXTURE_A0), content: FIXTURE_A1 },
    { path: 'src/greeting.mjs', operation: 'create', beforeHash: null, content: FIXTURE_GREETING },
  ]
  return JSON.stringify({
    version: 1, id: 'wr-blueprint-proof-1', goal: 'Bump a and add a greeting utility backed by the verified tiny-dep',
    workspace: { id: input.workspaceId, baseRevision: input.baseRevision }, changes,
    dependencies: [{ name: 'tiny-dep', version: '1.2.3' }], checks: [{ id: 'wr-dependency-audit', version: '1' }, { id: 'wr-syntax', version: '1' }],
    permissions: { writePaths: changes.map(c => c.path) }, artifact: { path: 'src/a.mjs', sha256: hash(FIXTURE_A1), kind: 'source-file' }, research: [],
    recipe: { id: 'wr-blueprint-proof', version: '1', applicability: 'fixture workspace bundle', provenance: 'manual-package-import' },
    build: { recipeId: 'wr-bundle-build', recipeVersion: '1' }, ...(input.over ?? {}),
  })
}
