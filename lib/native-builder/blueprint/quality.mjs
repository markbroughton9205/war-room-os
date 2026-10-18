/** Mapping of LIVE quality tools into the isolated host-owned check registry / stage model, plus a fixed-argv command check for hermetic fixtures. Read-only toward live.
 *
 * Live: qualityTools.ts (typecheckRun, lintRun, buildRun, testRun, listTestSuites) and packageTool.ts packageRun all go through validationRunner.runValidationOperationStreaming({id, targets}),
 * which maps an operation id to a FIXED argv (pnpm exec tsc --noEmit; pnpm exec eslint --max-warnings=0 -- <files>; pnpm run build; node scripts/prepare-desktop-runtime.mjs; npm run desktop:dist:linux;
 * pnpm run validate:<suite> (never :live)). Results are {ok, exitCode, durationMs, ranAt, timedOut, stdout, stderr} (redacted, truncated) with NO tool identity/version or implementation digest. */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { BlueprintError, hash, canonical } from './base.mjs'
import { scrub } from './stages.mjs'

export const LIVE_QUALITY_MAP = Object.freeze({
  typecheck: Object.freeze({ liveFn: 'qualityTools.typecheckRun', role: 'typecheck', kind: 'check', note: 'whole-repo tsc --noEmit; the known baseline of pre-existing errors must be encoded in the HOST check, never accepted from the package' }),
  eslint_targeted: Object.freeze({ liveFn: 'qualityTools.lintRun', role: 'source-policy', kind: 'check', note: 'eslint --max-warnings=0 over package-touched files only' }),
  validate_suite: Object.freeze({ liveFn: 'qualityTools.testRun', role: 'focused-test', kind: 'check', note: 'one named validate:<suite> script; ":live" suites are never registrable' }),
  build: Object.freeze({ liveFn: 'qualityTools.buildRun', role: 'build', kind: 'stage:build', note: 'success = exit 0 AND BUILD_ID/standalone/static present; outputs are in-tree (.next)' }),
  prepare_desktop_runtime: Object.freeze({ liveFn: 'packageTool.packageRun', role: 'build', kind: 'stage:package', note: 'part of packaging' }),
  package_desktop_linux: Object.freeze({ liveFn: 'packageTool.packageRun', role: 'build', kind: 'stage:package', note: 'AppImage/deb/linux-unpacked under desktop/dist-release' }),
})
/** Live operations / tools that must NEVER be registrable by this adapter. `package_install` is `<pm> install` (unpinned, lifecycle scripts, lockfile mutation). */
export const FORBIDDEN_LIVE_OPS = Object.freeze(['package_install', 'package_script', 'git_diff_check', 'http_probe', 'installer.install_production', 'installer.activate', 'installer.active_status'])
export function assertRegistrable(opId, { suite = null } = {}) {
  if (FORBIDDEN_LIVE_OPS.includes(opId) || !Object.hasOwn(LIVE_QUALITY_MAP, opId)) throw new BlueprintError('UNAPPROVED_RECIPE', 'registry', `Live operation ${String(opId).slice(0, 60)} cannot be registered as a blueprint check or stage`)
  if (opId === 'validate_suite' && (typeof suite !== 'string' || !/^validate:[\w:-]{1,80}$/.test(suite) || suite.endsWith(':live'))) throw new BlueprintError('UNAPPROVED_RECIPE', 'registry', 'Only validate:<suite> (never :live) can be registered')
  return LIVE_QUALITY_MAP[opId]
}

/** Fixed-argv command check for hermetic fixtures: no shell, minimal env, AbortSignal kill, bounded redacted evidence. The implementation digest binds argv + script content. */
export function createCommandCheck({ id, version, role, scope = 'workspace-read', cmd, args, scriptPath = null, timeoutMs = 10_000, env = {} }) {
  if (!path.isAbsolute(cmd) || !Array.isArray(args) || args.some(a => typeof a !== 'string')) throw new Error('Invalid command check')
  const scriptDigest = scriptPath ? hash(fs.readFileSync(scriptPath)) : null
  const implementationDigest = hash(canonical({ cmdName: path.basename(cmd), args, scriptDigest, id, version, role, envNames: Object.keys(env).sort() }))
  return { id, version, role, scope, timeoutMs, cancellable: true, implementationDigest, run: ({ root, signal }) => new Promise(resolve => {
    let out = '', err = ''; const child = spawn(cmd, args, { cwd: root, shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH ?? '', LC_ALL: 'C', ...env } })
    const onAbort = () => { try { child.kill('SIGKILL') } catch { /* gone */ } }; signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout.on('data', d => { if (out.length < 4000) out += d }); child.stderr.on('data', d => { if (err.length < 4000) err += d })
    child.on('error', () => resolve({ status: 'ERROR', evidence: 'tool could not be started' }))
    child.on('close', code => { signal?.removeEventListener('abort', onAbort); resolve({ status: code === 0 ? 'PASS' : 'FAIL', evidence: scrub(`${out}\n${err}`.trim() || `exit ${code}`, [root]) }) })
  }) }
}
