/** Build / package / artifact-verification STAGE contract (isolated). Stages are host-owned recipes; a package never supplies a command, script or argv.
 * sourceValidated / built / packaged / installed / taskComplete are DERIVED separately and no stage can imply a later one.
 *
 * Live reference (read only): qualityTools.ts buildRun (`pnpm run build`, success = exit 0 AND .next/BUILD_ID + standalone + static present), packageTool.ts packageRun
 * (prepare-desktop-runtime + `npm run desktop:dist:linux`, then artifact checks), validationRunner.ts (fixed argv per operation id, redacted bounded output). The live results carry no tool
 * identity/version, no implementation digest and no source/base binding; the contract below adds them. NO live build/package/install is invoked here. */
import fs from 'node:fs'
import path from 'node:path'
import { BlueprintError, canonical, hash, refuse } from './base.mjs'
import { safeRelPath, ARTIFACT_KINDS } from './artifacts.mjs'

export const STAGE_NAMES = Object.freeze(['validateSource', 'build', 'package', 'verifyArtifact'])
export const STAGE_STATUSES = Object.freeze(['PASS', 'FAIL', 'ERROR', 'REFUSED', 'UNKNOWN', 'NOT_RUN', 'NOT_IMPLEMENTED', 'INCONCLUSIVE'])
export const STAGE_ORDER = Object.freeze({ build: ['validateSource'], package: ['validateSource', 'build'], verifyArtifact: ['validateSource', 'build', 'package'] })
/** Install is DEFINED here but intentionally unimplementable by this slice (see INSTALL_REQUIREMENTS). */
export const INSTALL_REQUIREMENTS = Object.freeze(['explicit host authorization (separate Commander approval)', 'verified artifact manifest (PASS verifyArtifact)', 'rollback identity (previous active install)', 'installed-runtime target (never the source workspace)', 'installed build identity', 'post-install acceptance by the host mission engine'])

const SECRETISH = /((?:token|secret|password|passwd|authorization|cookie|api[_-]?key|private[_-]?key)\s*[:=]\s*)\S+/gi
export const scrub = (text, roots = []) => { let t = String(text ?? '').replace(/(?:\/[\w.@+~-]+){2,}\/?/g, '<path>').replace(SECRETISH, '$1[REDACTED]').replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').replace(/-----BEGIN [A-Z ]+-----[\s\S]*?(?:-----END [A-Z ]+-----|$)/g, '[REDACTED KEY]'); for (const r of roots) if (r) t = t.split(r).join('<path>'); return t.slice(0, 2000) }

/** Strict stage result. Unknown keys are refused; evidence is scrubbed + bounded; artifactRefs are only NAMES (the broker hashes the files itself). */
const RESULT_KEYS = ['status', 'evidence', 'artifactRefs', 'startedAt', 'finishedAt', 'toolIdentity', 'toolVersion', 'artifact', 'failureCode', 'exitCode', 'timedOut']
export function normalizeStageResult(raw, { stage, now = Date.now, roots = [] }) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const bad = Object.keys(r).filter(k => !RESULT_KEYS.includes(k)); const t = now()
  const refs = Array.isArray(r.artifactRefs) ? r.artifactRefs.filter(a => a && typeof a === 'object' && typeof a.logicalName === 'string' && safeRelPath(a.relPath) && ARTIFACT_KINDS.includes(a.kind)).map(a => ({ logicalName: a.logicalName, relPath: a.relPath, kind: a.kind })) : []
  const status = bad.length ? 'ERROR' : STAGE_STATUSES.includes(r.status) ? r.status : 'INCONCLUSIVE'
  return Object.freeze({ stage, status, evidence: scrub(bad.length ? 'stage returned unexpected fields' : r.evidence, roots), artifactRefs: Object.freeze(refs), startedAt: Number.isFinite(r.startedAt) ? r.startedAt : t, finishedAt: Number.isFinite(r.finishedAt) ? r.finishedAt : t,
    toolIdentity: typeof r.toolIdentity === 'string' ? r.toolIdentity.slice(0, 120).replace(/[^\w.:@/+-]/g, '_') : 'UNKNOWN', toolVersion: typeof r.toolVersion === 'string' ? r.toolVersion.slice(0, 60).replace(/[^\w.+-]/g, '_') : 'UNKNOWN',
    failureCode: typeof r.failureCode === 'string' && /^[A-Z_]{3,60}$/.test(r.failureCode) ? r.failureCode : null, exitCode: Number.isInteger(r.exitCode) ? r.exitCode : null, timedOut: r.timedOut === true })
}

/** Claims derived ONLY from recorded stage facts; every later state requires the earlier one plus its own proof; install/task/mission/assignment completion are never derived here. */
export function deriveClaims({ sourceValidated, stages = {} }) {
  const cur = x => x?.currentStatus === 'CURRENT' // a historical PASS that is not CURRENT proves nothing about now
  const built = sourceValidated === true && stages.build?.status === 'PASS' && cur(stages.build) && stages.verifyArtifact?.builtVerified === true
  const packaged = built && stages.package?.status === 'PASS' && cur(stages.package) && stages.verifyArtifact?.status === 'PASS' && stages.verifyArtifact?.packagedVerified === true
  return { sourceValidated: sourceValidated === true, built, packaged, installed: false, taskComplete: false, missionComplete: false, assignmentComplete: false }
}

// ------------------------------------------------------------------ host-owned recipes
/** A recipe is HOST policy, never package content. It fixes: the one executable + argv, working-directory policy, readable scopes, environment NAMES (+ fixed values), the approved
 * output files, timeout/grace, cancellation support, expected artifact classes and required upstream validation. The script content is hashed into the recipe identity and re-hashed before
 * every run (TOOL_DRIFT). Execution (engine) runs it under Node's permission model: fs reads limited to the declared scopes, fs writes limited to the run's own output dir, no child
 * processes/workers. NOTE: this Node has no network permission flag, so `network: 'none'` is enforced only by policy (no package manager, sanitized env, digest-pinned scripts) - documented limit. */
export function createRecipe({ id, version, stage, cmd, args, scriptPath, timeoutMs = 20_000, graceMs = 1000, inputRoots = [], outputs, workdir = 'workspace', readScopes = ['workspace'], envNames = [], envFixed = {}, cancellable = true,
  requires = ['source', 'dependencies'], requiredDeps = [], progress = null, maxAttempts = 2, retryableCodes = ['STAGE_TIMEOUT', 'TOOL_UNAVAILABLE'] }) {
  if (!/^[\w.-]{1,60}$/.test(id) || typeof version !== 'string' || !/^[\w.-]{1,40}$/.test(version) || !['build', 'package'].includes(stage) || !path.isAbsolute(cmd) || !Array.isArray(args) || args.some(a => typeof a !== 'string')) throw new Error('Invalid recipe')
  if (!(timeoutMs > 0 && timeoutMs <= 600_000) || !(graceMs >= 0 && graceMs <= 30_000) || !Array.isArray(outputs) || outputs.length === 0 || !outputs.every(o => safeRelPath(o.relPath) && /^[\w.-]{1,80}$/.test(o.logicalName) && ARTIFACT_KINDS.includes(o.kind)) || !inputRoots.every(safeRelPath)) throw new Error('Invalid recipe outputs/inputs')
  if (!['workspace', 'input'].includes(workdir) || !readScopes.every(x => ['workspace', 'input'].includes(x)) || !envNames.every(n => /^[A-Z][A-Z0-9_]{0,40}$/.test(n)) || ![null, 'bp-json'].includes(progress) || !(maxAttempts >= 1 && maxAttempts <= 3)) throw new Error('Invalid recipe policy')
  if (stage === 'package' && !readScopes.includes('input')) throw new Error('package recipes must read the build output scope')
  const scriptDigestOf = () => { try { return hash(fs.readFileSync(scriptPath)) } catch { return null } }
  const scriptDigest = scriptDigestOf(); if (!scriptDigest) throw new Error('Recipe script unreadable')
  const o = Object.freeze(outputs.map(x => Object.freeze({ logicalName: x.logicalName, relPath: x.relPath, kind: x.kind })))
  const policy = { id, version, stage, args: [...args], scriptDigest, timeoutMs, graceMs, inputRoots: [...inputRoots].sort(), outputs: o, workdir, readScopes: [...readScopes].sort(), envNames: [...envNames].sort(), envFixed: Object.fromEntries(Object.entries(envFixed).sort()), cancellable, requires: [...requires].sort(),
    requiredDeps: requiredDeps.map(d => ({ name: d.name, version: d.version })).sort((a, b) => a.name.localeCompare(b.name)), progress, maxAttempts, retryableCodes: [...retryableCodes].sort(), cmdName: path.basename(cmd), network: 'none', sandbox: 'node-permission-model', expectedClasses: [...new Set(o.map(x => x.kind))].sort() }
  return Object.freeze({ ...policy, args: Object.freeze([...args]), cmd, scriptPath, envFixed: Object.freeze({ ...envFixed }), digest: hash(canonical(policy)), currentScriptDigest: scriptDigestOf })
}

/** Host pipeline = which stages the host AUTHORIZES + the recipes/checks/environment behind them. `binding()` is part of every approval; drift => TOOL_DRIFT / stale lineage.
 * Install is not a member and cannot be added. `kind` labels what passing here proves ('isolated-fixture' establishes ISOLATED_* only). */
export function createBuildPipeline({ authorized, recipes, stageChecks = {}, environment, verifyExtra = null, kind = 'isolated-fixture', hooks = {} }) {
  const stages = new Set(authorized)
  for (const x of stages) if (!['build', 'package'].includes(x)) throw new Error(`Stage ${x} cannot be authorized (verification is part of each stage; install is never authorizable)`)
  if (stages.has('package') && !stages.has('build')) throw new Error('package requires build')
  for (const x of stages) if (recipes?.[x]?.stage !== x) throw new Error(`Missing recipe for ${x}`)
  if (!environment || typeof environment.identity !== 'function') throw new Error('environment identity provider required')
  const sc = Object.freeze({ build: Object.freeze([...(stageChecks.build ?? [])]), package: Object.freeze([...(stageChecks.package ?? [])]) })
  const binding = () => hash(canonical({ authorized: [...stages].sort(), recipes: Object.fromEntries([...stages].map(x => [x, recipes[x].digest])), stageChecks: sc, environmentPolicy: environment.policyDigest ?? null, verifyExtra: typeof verifyExtra === 'function' ? 'host' : null, kind }))
  return Object.freeze({ kind, authorized: () => [...stages].sort(), has: x => stages.has(x), recipe: x => recipes?.[x] ?? null, stageChecks: x => sc[x] ?? [], environment, binding, verifyExtra, hooks })
}
export { BlueprintError, refuse }
