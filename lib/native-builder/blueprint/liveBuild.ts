/**
 * Live blueprint build kit: host-owned recipes, host-owned checks, build-environment identity and the stage pipeline.
 *
 * Hardening relative to the existing broad tools (qualityTools.buildRun / packageTool.packageRun): recipes are FIXED host policy (a package can only request an id+version),
 * every run gets a fresh run-owned output directory OUTSIDE the workspace, runs under Node's permission model (reads limited to the workspace/input, writes limited to the
 * run's output dir, no child processes, no symlinks), outputs are hashed into a manifest bound to the exact source/dependency/recipe/environment, and success is never
 * selected by modification time. The War Room desktop build (`pnpm run build`, electron-builder) is intentionally NOT a registered recipe here: it needs child processes and
 * network access that this sandbox cannot confine, and it writes in-tree.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createCheckRegistry } from './adapters.mjs'
import { atomicWrite, hash } from './base.mjs'
import { EMBEDDED_TOOLS } from './embeddedTools.generated'
import { createEnvironmentIdentity } from './envid.mjs'
import { createCommandCheck } from './quality.mjs'
import { createBuildPipeline, createRecipe } from './stages.mjs'
import type { LiveDependencyVerifier } from './liveDependencies'

export const BLUEPRINT_PIPELINE_KIND = 'war-room-blueprint-workspace'
/** Bump when the logic of a host check changes: it changes the implementation digest and therefore stales approvals/lineage that were bound to the old one. */
const CHECK_IMPL_VERSION = 1

export type ToolFile = { path: string; sha256: string }

/** Materialize the hash-pinned tool scripts (bundled runtimes cannot rely on import.meta.url/file tracing). Existing files are verified, never trusted. */
export function materializeTools(toolsDir: string): Record<string, ToolFile> {
  fs.mkdirSync(toolsDir, { recursive: true, mode: 0o700 })
  const out: Record<string, ToolFile> = {}
  for (const [name, { source, sha256 }] of Object.entries(EMBEDDED_TOOLS)) {
    const file = path.join(toolsDir, `${name.replace(/\.mjs$/, '')}-${sha256.slice(0, 12)}.mjs`)
    let ok = false
    try { ok = hash(fs.readFileSync(file)) === sha256 } catch { ok = false }
    if (!ok) { atomicWrite(file, source, 0o600); if (hash(fs.readFileSync(file)) !== sha256) throw new Error(`Tool ${name} could not be materialized`) }
    out[name] = { path: file, sha256 }
  }
  return out
}

/** A Node able to run `--permission` scripts: plain node, or the Electron binary in run-as-node mode (verified to enforce the permission model on Electron's Node 22). */
export function blueprintNode(): { cmd: string; env: Record<string, string> } {
  const plain = /^node(js)?(\.exe)?$/i.test(path.basename(process.execPath))
  return { cmd: process.execPath, env: plain ? {} : { ELECTRON_RUN_AS_NODE: '1' } }
}

function runNodeCheck(node: { cmd: string; env: Record<string, string> }, file: string, signal?: AbortSignal): Promise<boolean> {
  return new Promise(resolve => {
    const child = spawn(node.cmd, ['--check', file], { shell: false, stdio: 'ignore', env: { PATH: process.env.PATH ?? '', LC_ALL: 'C', ...node.env } as unknown as NodeJS.ProcessEnv })
    const kill = () => { try { child.kill('SIGKILL') } catch { /* gone */ } }
    signal?.addEventListener('abort', kill, { once: true })
    child.on('error', () => resolve(false))
    child.on('close', (code: number | null) => { signal?.removeEventListener('abort', kill); resolve(code === 0) })
  })
}

type CheckInput = { root: string; package: { workspace: { id: string }; dependencies: { name: string; version: string }[]; changes: { path: string; operation: string }[] }; signal?: AbortSignal }

export function createLiveBuildKit(opts: { toolsDir: string; verifier: LiveDependencyVerifier; /** host-only recipe argv (tests); packages can never set these */ buildArgs?: string[]; packArgs?: string[]; hooks?: { fault?: (point: string, stage?: string) => void } }) {
  const tools = materializeTools(opts.toolsDir)
  const node = blueprintNode()
  const recipes = {
    build: createRecipe({ id: 'wr-bundle-build', version: '1', stage: 'build', cmd: node.cmd, args: opts.buildArgs ?? ['--progress'], scriptPath: tools['wr-bundle-build.mjs'].path, inputRoots: ['src'], readScopes: ['workspace'], envFixed: node.env,
      progress: 'bp-json', timeoutMs: 180_000, graceMs: 2000, outputs: [{ logicalName: 'bundle', relPath: 'bundle.mjs', kind: 'bundle' }, { logicalName: 'build-info', relPath: 'build-info.json', kind: 'report' }] }),
    package: createRecipe({ id: 'wr-bundle-pack', version: '1', stage: 'package', cmd: node.cmd, args: opts.packArgs ?? [], scriptPath: tools['wr-bundle-pack.mjs'].path, readScopes: ['input'], workdir: 'input', envFixed: node.env,
      requires: ['source', 'dependencies', 'build'], timeoutMs: 180_000, graceMs: 2000, outputs: [{ logicalName: 'app', relPath: 'app.pkg', kind: 'package' }] }),
  }
  const environment = createEnvironmentIdentity({ tools: [{ id: 'node', cmd: node.cmd, versionArgs: ['--version'], env: node.env }], envNames: [], mode: BLUEPRINT_PIPELINE_KIND })
  const pipeline = createBuildPipeline({ authorized: ['build', 'package'], recipes, environment, stageChecks: { build: ['wr-bundle-syntax'], package: ['wr-pack-verify'] }, kind: BLUEPRINT_PIPELINE_KIND, hooks: opts.hooks ?? {} })

  // ---- host-owned checks (a package may only reference these ids/versions)
  const dependencyAudit = {
    id: 'wr-dependency-audit', version: '1', role: 'dependency-audit', scope: 'workspace-read', timeoutMs: 60_000, cancellable: true,
    implementationDigest: hash(`wr-dependency-audit@1:impl:${CHECK_IMPL_VERSION}`),
    async run({ package: p }: CheckInput) {
      const declared = p.dependencies.map(d => ({ name: d.name, version: d.version }))
      const v = await opts.verifier.verify(p.workspace.id, declared)
      return v.allUsable ? { status: 'PASS', evidence: `${declared.length} declared dependenc${declared.length === 1 ? 'y' : 'ies'} VERIFIED_USABLE` } : { status: 'FAIL', evidence: `dependencies are not all VERIFIED_USABLE: ${JSON.stringify(v.counts)}` }
    },
  }
  const syntax = {
    id: 'wr-syntax', version: '1', role: 'syntax', scope: 'package-files-read', timeoutMs: 60_000, cancellable: true,
    implementationDigest: hash(`wr-syntax@1:impl:${CHECK_IMPL_VERSION}`),
    async run({ root, package: p, signal }: CheckInput) {
      let checked = 0, skipped = 0
      for (const c of p.changes) {
        const rel = c.path, abs = path.join(root, rel)
        if (/\.(mjs|cjs)$/.test(rel)) { if (!(await runNodeCheck(node, abs, signal))) return { status: 'FAIL', evidence: `syntax error in ${rel}` }; checked++ }
        else if (/\.json$/.test(rel)) { try { JSON.parse(fs.readFileSync(abs, 'utf8')); checked++ } catch { return { status: 'FAIL', evidence: `invalid JSON in ${rel}` } } }
        else skipped++ // .js (module type ambiguous), .ts, .md, .css, .txt: not checked here - stated, never claimed
      }
      return { status: 'PASS', evidence: `${checked} file(s) syntax-checked, ${skipped} not checkable by this host check` }
    },
  }
  const bundleSyntax = createCommandCheck({ id: 'wr-bundle-syntax', version: '1', role: 'syntax', cmd: node.cmd, args: ['--check', 'bundle.mjs'], timeoutMs: 20_000, env: node.env })
  const packVerify = {
    id: 'wr-pack-verify', version: '1', role: 'artifact-verification', timeoutMs: 20_000, cancellable: false,
    implementationDigest: hash(`wr-pack-verify@1:impl:${CHECK_IMPL_VERSION}`),
    async run({ root, inDir }: { root: string; inDir: string }) {
      try {
        const raw = fs.readFileSync(path.join(root, 'app.pkg'), 'utf8'), nl = raw.indexOf('\n'), head = JSON.parse(raw.slice(0, nl)) as { files: { sha256: string }[] }, body = raw.slice(nl + 1), bundle = fs.readFileSync(path.join(inDir, 'bundle.mjs'), 'utf8')
        return head.files[0].sha256 === hash(bundle) && hash(body) === hash(bundle) ? { status: 'PASS', evidence: 'package content equals the current build bundle' } : { status: 'FAIL', evidence: 'package content does not match the current build bundle' }
      } catch { return { status: 'FAIL', evidence: 'package unreadable' } }
    },
  }
  const checks = createCheckRegistry([dependencyAudit, syntax, bundleSyntax, packVerify])
  return { tools, node, recipes, environment, pipeline, checks }
}
export type LiveBuildKit = ReturnType<typeof createLiveBuildKit>
