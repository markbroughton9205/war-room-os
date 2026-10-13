/* eslint-disable @typescript-eslint/no-unused-vars -- reference suite ported verbatim from the isolated implementation (terse style) */
// Shared by tests and by crash-test CHILD PROCESSES: builds an isolated fixture workspace + host (pipeline, dependency verifier, checks). NOT a War Room implementation.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCheckRegistry } from '../../lib/native-builder/blueprint/adapters.mjs'
import { hash } from '../../lib/native-builder/blueprint/base.mjs'
import { createWorkspaceDependencyVerifier } from '../../lib/native-builder/blueprint/depverify.mjs'
import { createEnvironmentIdentity } from '../../lib/native-builder/blueprint/envid.mjs'
import { createCommandCheck } from '../../lib/native-builder/blueprint/quality.mjs'
import { createBuildPipeline, createRecipe } from '../../lib/native-builder/blueprint/stages.mjs'
import { createFakeHost } from './fake-host.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
export const A0 = 'export const a = 1\n', A1 = 'export const a = 2\n', B1 = "import dep from 'tiny-dep'\nexport const b = dep.describe()\n"
export const CTX = { missionId: 'm-1', assignmentId: 'a-1', workspaceId: 'ws-1', requestingSubsystem: 'foundry' }
export const PKG = (over = {}) => JSON.stringify({ version: 1, id: 'pkg-1', goal: 'Bump a and add b', workspace: { id: 'ws-1', baseRevision: 'rev1' },
  changes: [{ path: 'src/a.mjs', operation: 'replace', beforeHash: hash(A0), content: A1 }, { path: 'src/b.mjs', operation: 'create', beforeHash: null, content: B1 }],
  dependencies: [{ name: 'tiny-dep', version: '1.2.3' }], checks: [{ id: 'audit', version: '1' }, { id: 'behavior', version: '1' }], permissions: { writePaths: ['src/a.mjs', 'src/b.mjs'] },
  artifact: { path: 'src/a.mjs', sha256: hash(A1), kind: 'source-file' }, research: [], recipe: { id: 'r', version: '1', applicability: 'demo', provenance: 'manual' }, build: { recipeId: 'fixture-build', recipeVersion: '1' }, ...over })

export function createWorkspace(ws, { dep = true } = {}) {
  fs.mkdirSync(path.join(ws, 'src'), { recursive: true }); fs.writeFileSync(path.join(ws, 'src/a.mjs'), A0)
  fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ name: 'fixture', version: '0.0.0', dependencies: dep ? { 'tiny-dep': '1.2.3' } : {} }))
  fs.writeFileSync(path.join(ws, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: dep ? { 'node_modules/tiny-dep': { version: '1.2.3', integrity: 'sha512-fixture' } } : {} }))
  if (dep) installTinyDep(ws)
}
export function installTinyDep(ws, { version = '1.2.3', body = "module.exports = { describe: () => 'tiny-dep@" + version + "' }\n", bin = false } = {}) {
  const d = path.join(ws, 'node_modules/tiny-dep'); fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'tiny-dep', version, main: 'index.js', ...(bin ? { bin: { 'tiny-dep': 'cli.js' } } : {}) })); fs.writeFileSync(path.join(d, 'index.js'), body)
  if (bin) fs.writeFileSync(path.join(d, 'cli.js'), '#!/usr/bin/env node\n')
}
export function copyRecipes(dir) {
  const r = path.join(dir, 'recipes'); fs.mkdirSync(r, { recursive: true })
  for (const f of ['build.mjs', 'package.mjs', 'tool-version.mjs']) fs.copyFileSync(path.join(here, 'fixture-recipes', f), path.join(r, f))
  fs.writeFileSync(path.join(r, 'tool-version.txt'), 'fixture-tool 1.0.0\n'); return r
}
export function makePipeline(rdir, { buildArgs = ['--use-dep', '--progress'], pkgArgs = [], authorized = ['build', 'package'], buildOpts = {}, pkgOpts = {}, envNames = [], toolVersionFile = true, hooks = {} } = {}) {
  const recipes = {
    build: createRecipe({ id: 'fixture-build', version: '1', stage: 'build', cmd: process.execPath, args: buildArgs, scriptPath: path.join(rdir, 'build.mjs'), inputRoots: ['src'], readScopes: ['workspace'], requiredDeps: [{ name: 'tiny-dep', version: '1.2.3' }], progress: 'bp-json', timeoutMs: 15000, graceMs: 600, envNames,
      outputs: [{ logicalName: 'bundle', relPath: 'bundle.mjs', kind: 'bundle' }, { logicalName: 'build-info', relPath: 'build-info.json', kind: 'report' }], ...buildOpts }),
    package: createRecipe({ id: 'fixture-package', version: '1', stage: 'package', cmd: process.execPath, args: pkgArgs, scriptPath: path.join(rdir, 'package.mjs'), readScopes: ['input'], workdir: 'input', requires: ['source', 'dependencies', 'build'], timeoutMs: 15000, graceMs: 600,
      outputs: [{ logicalName: 'app', relPath: 'app.pkg', kind: 'package' }], ...pkgOpts }),
  }
  const environment = createEnvironmentIdentity({ tools: [{ id: 'node', cmd: process.execPath, versionArgs: ['--version'] }, ...(toolVersionFile ? [{ id: 'fixture-tool', cmd: process.execPath, versionArgs: [path.join(rdir, 'tool-version.mjs')] }] : [])], envNames, mode: 'isolated-fixture' })
  return createBuildPipeline({ authorized, recipes, environment, stageChecks: { build: ['bundle-syntax'], package: ['pkg-verify'] }, kind: 'isolated-fixture', hooks })
}
export const stageCheckDefs = () => [
  createCommandCheck({ id: 'bundle-syntax', version: '1', role: 'syntax', cmd: process.execPath, args: ['--check', 'bundle.mjs'], timeoutMs: 8000 }),
  { id: 'pkg-verify', version: '1', role: 'artifact-verification', source: 'pkg-verify-v1', cancellable: false, run: async ({ root, inDir }) => {
    try { const raw = fs.readFileSync(path.join(root, 'app.pkg'), 'utf8'), nl = raw.indexOf('\n'), head = JSON.parse(raw.slice(0, nl)), body = raw.slice(nl + 1), bundle = fs.readFileSync(path.join(inDir, 'bundle.mjs'), 'utf8')
      return head.files[0].sha256 === hash(bundle) && hash(body) === hash(bundle) ? { status: 'PASS', evidence: 'package content equals the current build bundle' } : { status: 'FAIL', evidence: 'package content does not match the current build bundle' } } catch { return { status: 'FAIL', evidence: 'package unreadable' } } } },
]
export const baseChecks = () => [
  { id: 'audit', version: '1', role: 'dependency-audit', source: 'audit-impl-v1', run: async () => ({ status: 'PASS', evidence: 'audit ok' }) },
  { id: 'behavior', version: '1', role: 'behavior', source: 'behavior-impl-v1', run: async ({ root }) => ({ status: 'PASS', evidence: `a=${fs.readFileSync(path.join(root, 'src/a.mjs'), 'utf8').trim()}` }) },
]
export function createExecHost({ ws, rdir, now = Date.now, approved = () => true, pipelineOpts = {}, hostOpts = {} }) {
  const host = createFakeHost({ now, workspaces: { 'ws-1': { id: 'ws-1', root: ws } }, checks: [...baseChecks(), ...stageCheckDefs()], ...hostOpts })
  host.pipeline = makePipeline(rdir, pipelineOpts); host.dependencies = createWorkspaceDependencyVerifier({ rootOf: () => ({ root: ws }), approved })
  host.issue('tok-cmd', { actorId: 'cmd1', sessionId: 'sess-cmd-0001' }); host.issue('tok-view', { actorId: 'v1', role: 'viewer', sessionId: 'sess-view-001' }); host.assignments.add('m-1|a-1|ws-1')
  return host
}
