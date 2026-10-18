/** Isolated blueprint core (first slice). Reviewed/hardened from the untested Codex draft (kept verbatim at
 * artifacts/core.codex-draft.mjs).
 *
 * TRUST BOUNDARIES (host/broker must provide; this module cannot):
 *  - caller authentication: `approve(actor)` trusts the host-supplied actor string.
 *  - exclusive workspace lease: `verifyLease()` is a host callback; it is only sampled, not enforced by the OS.
 *  - trustworthy base identity: `workspace.getBaseRevision()` is a host callback.
 *  - checks: registered, host-owned callbacks. A package can only reference them by id+version.
 *  - filesystem TOCTOU: paths are lstat-checked immediately before use, but a hostile local process that can write
 *    inside the workspace between check and use is only excluded by the host lease.
 * Step-1 control plane (control.mjs): durable approvals, lease, cancel, effect ledger; recovery (classify/reconcile/restore/resume).
 *  - lease files are logical exclusivity among cooperating holders, NOT OS-level exclusion.
 * No network, model, shell, installer or project-script execution. Source validation only: this never claims
 * build, packaging, installation or whole-task completion.
 */
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'
import { BlueprintError, atomicWrite as atomic, canonical, checkBindingOf, createExclusive, describeError, hash, readJson, refuse, UUID } from './base.mjs'
import { createControlPlane } from './control.mjs'
export { BlueprintError, describeError, hash }

// ---- intake schema
const DENY_BUILTINS = new Set(['child_process', 'cluster', 'worker_threads', 'vm', 'net', 'dgram', 'dns', 'http', 'https', 'http2', 'tls', 'inspector', 'repl', 'wasi', 'v8', 'module'])
const BUILTINS = new Set(builtinModules.map(m => m.replace(/^node:/, '').split('/')[0]))
const CODE_EXT = /\.(?:[cm]?[jt]sx?)$/
const ALLOWED_EXT = /\.(?:[cm]?[jt]sx?|json|md|txt|css)$/ // no shell/batch/config-by-extension/binaries
const DYNAMIC_CODE = /\b(?:eval|Function)\s*\(|\bprocess\s*\.\s*(?:binding|dlopen|mainModule)|\bcreateRequire\b|\bimport\s*\.\s*meta\s*\.\s*resolve/
function object(v, keys, label) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k)))
    refuse('INVALID_PACKAGE', 'intake', `Invalid or unexpected fields: ${label}`)
}
function string(v, label, max = 500) {
  if (typeof v !== 'string' || !v.trim() || v.length > max) refuse('INVALID_PACKAGE', 'intake', `Invalid ${label}`)
}
function array(v, label, max = 40) {
  if (!Array.isArray(v) || v.length > max) refuse('INVALID_PACKAGE', 'intake', `Invalid ${label}`)
}
function safeRel(rel) {
  string(rel, 'relative path')
  if (rel.includes('\\') || path.isAbsolute(rel) || rel.split('/').some(s => !s || s.startsWith('.') || s === 'node_modules' || s !== s.trim() || !/^[\w -]+(?:\.[\w-]+)*$/.test(s)))
    refuse('PATH_ESCAPE', 'preflight', 'Only contained non-hidden relative paths are supported', { path: rel })
  return rel
}
function sha(v) { if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) refuse('INVALID_PACKAGE', 'intake', 'Expected SHA256') }
const SPDX = /^[A-Za-z0-9][A-Za-z0-9.+-]*(?: (?:AND|OR|WITH) [A-Za-z0-9][A-Za-z0-9.+-]*){0,4}$/
// Imports in supplied code must be relative, an allowed node builtin, or a declared dependency. Heuristic text
// scan (not a parser, not a sandbox): conservative on anything it cannot classify.
function scanImports(c, declared) {
  if (!CODE_EXT.test(c.path)) return
  if (DYNAMIC_CODE.test(c.content)) refuse('RESTRICTED_IMPORT', 'preflight', 'Restricted dynamic-code or module-loader construct in supplied code', { path: c.path })
  const specs = []
  const re = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])([^'"\n]*)\1/g
  for (let m; (m = re.exec(c.content));) specs.push(m[2])
  if (/\b(?:import|require)\s*\(\s*(?!['"\s])/.test(c.content))
    refuse('RESTRICTED_IMPORT', 'preflight', 'Dynamic/non-literal import or require is not supported', { path: c.path })
  for (const s of specs) {
    if (s.startsWith('./') || s.startsWith('../')) continue
    if (s.startsWith('node:')) {
      if (DENY_BUILTINS.has(s.slice(5).split('/')[0])) refuse('RESTRICTED_IMPORT', 'preflight', `Restricted builtin: ${s}`, { path: c.path })
      continue
    }
    if (/^(?:\/|#|[a-z][a-z0-9+.-]*:)/i.test(s)) refuse('RESTRICTED_IMPORT', 'preflight', `Unsupported import specifier: ${s.slice(0, 60)}`, { path: c.path })
    const name = s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0]
    if (BUILTINS.has(name)) {
      if (DENY_BUILTINS.has(name)) refuse('RESTRICTED_IMPORT', 'preflight', `Restricted builtin: ${name}`, { path: c.path })
      continue
    }
    if (!declared.has(name)) refuse('UNDECLARED_DEPENDENCY', 'preflight', `Import of undeclared dependency: ${name}`, { path: c.path, observed: name })
  }
}
function parse(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 256_000) refuse('INVALID_PACKAGE', 'intake', 'Expected JSON up to 256KB')
  let p
  try { p = JSON.parse(raw) } catch { refuse('INVALID_PACKAGE', 'intake', 'Invalid JSON') }
  // No approval/authority field exists in the schema: an imported "approved": true is an unexpected field and rejected.
  object(p, ['version','id','goal','workspace','changes','dependencies','checks','permissions','artifact','research','recipe','build'], 'package')
  if (p.version !== 1) refuse('INVALID_PACKAGE', 'intake', 'Unsupported schema version')
  string(p.id, 'id', 200); string(p.goal, 'goal', 4000)
  object(p.workspace, ['id','baseRevision'], 'workspace'); string(p.workspace.id, 'workspace id', 200); string(p.workspace.baseRevision, 'base revision', 200)
  array(p.changes, 'changes', 10); if (!p.changes.length) refuse('INVALID_PACKAGE', 'intake', 'Changes required')
  const seen = new Set(), folded = new Set()
  for (const c of p.changes) {
    object(c, ['path','operation','beforeHash','content'], 'change'); safeRel(c.path)
    if (seen.has(c.path) || folded.has(c.path.toLowerCase())) refuse('INVALID_PACKAGE', 'intake', 'Duplicate change path'); seen.add(c.path); folded.add(c.path.toLowerCase())
    if (!['create','replace'].includes(c.operation)) refuse('INVALID_PACKAGE', 'intake', 'Only create/replace supported')
    if (c.operation === 'replace') sha(c.beforeHash)
    else if (c.beforeHash !== null) refuse('INVALID_PACKAGE', 'intake', 'Create requires null beforeHash')
    if (typeof c.content !== 'string' || Buffer.byteLength(c.content) > 64_000 || c.content.includes('\0')) refuse('INVALID_PACKAGE', 'intake', 'Invalid supplied content')
    if (/^(package\.json|(?:pnpm-lock|yarn\.lock|package-lock|npm-shrinkwrap)|.*\.(?:lock|toml))/.test(path.basename(c.path)))
      refuse('DEPENDENCY_PLAN_REQUIRED', 'preflight', 'Manifest/lockfile changes are outside this slice', { path: c.path })
    if (!ALLOWED_EXT.test(c.path)) refuse('UNSUPPORTED_FILE_TYPE', 'preflight', 'Unsupported file type for this slice', { path: c.path })
  }
  array(p.dependencies, 'dependencies')
  for (const d of p.dependencies) {
    object(d, ['name','version'], 'dependency'); string(d.name, 'dependency name', 214); string(d.version, 'dependency version', 64)
    // Exact registry names/versions only: no ranges, tags, URLs, git or file specifiers.
    if (!/^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(d.name) || !/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(d.version))
      refuse('INVALID_PACKAGE', 'intake', 'Dependencies need a plain package name and exact version')
  }
  if (new Set(p.dependencies.map(d => d.name)).size !== p.dependencies.length) refuse('INVALID_PACKAGE', 'intake', 'Duplicate dependency')
  array(p.checks, 'checks'); if (!p.checks.length) refuse('INVALID_PACKAGE','intake','At least one registered check required')
  for (const c of p.checks) { object(c,['id','version'],'check'); string(c.id,'check id',100); string(c.version,'check version',50) }
  if (new Set(p.checks.map(c => c.id)).size !== p.checks.length) refuse('INVALID_PACKAGE','intake','Duplicate check')
  if (p.build !== undefined) { object(p.build, ['recipeId', 'recipeVersion'], 'build'); string(p.build.recipeId, 'build recipe id', 60); string(p.build.recipeVersion, 'build recipe version', 40); if (!/^[\w.-]{1,60}$/.test(p.build.recipeId) || !/^[\w.-]{1,40}$/.test(p.build.recipeVersion)) refuse('INVALID_PACKAGE', 'intake', 'Invalid build recipe reference') } // a REQUEST for a host-registered recipe id/version; never a command
  object(p.permissions,['writePaths'],'permissions'); array(p.permissions.writePaths,'write paths', 10)
  if (canonical([...p.permissions.writePaths].sort()) !== canonical([...seen].sort())) refuse('WRITE_SCOPE_DENIED','preflight','Write paths must exactly match changes')
  object(p.artifact,['path','sha256','kind'],'artifact'); safeRel(p.artifact.path); sha(p.artifact.sha256)
  if (p.artifact.kind !== 'source-file' || !seen.has(p.artifact.path)) refuse('UNSUPPORTED_ARTIFACT','preflight','First slice returns a changed source-file artifact, not a packaged build')
  const art = p.changes.find(c => c.path === p.artifact.path)
  if (hash(art.content) !== p.artifact.sha256) refuse('ARTIFACT_MISMATCH','preflight','Declared artifact hash does not match supplied content',{path:art.path,expected:p.artifact.sha256,observed:hash(art.content)})
  const declared = new Set(p.dependencies.map(d => d.name))
  for (const c of p.changes) scanImports(c, declared)
  array(p.research,'research',20)
  for (const r of p.research) {
    // Strict data-only references: closed vocabulary, no prose/notes/code/commands/fetched content, never fetched or executed.
    object(r,['url','digest','license','accessedAt'],'research'); sha(r.digest)
    if (typeof r.license !== 'string' || r.license.length > 100 || !SPDX.test(r.license)) refuse('INVALID_PACKAGE','intake','License must be an SPDX-style identifier')
    if (typeof r.accessedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z)?$/.test(r.accessedAt) || Number.isNaN(Date.parse(r.accessedAt))) refuse('INVALID_PACKAGE','intake','accessedAt must be an ISO date')
    string(r.url,'url'); let u; try { u = new URL(r.url) } catch { refuse('INVALID_PACKAGE','intake','Invalid source URL') }
    if (/[\s\x00-\x1f]/.test(r.url) || u.protocol !== 'https:' || u.username || u.password) refuse('INVALID_PACKAGE','intake','Source must be an HTTPS reference without credentials')
  }
  object(p.recipe,['id','version','applicability','provenance'],'recipe')
  for (const key of ['id','version','applicability','provenance']) string(p.recipe[key],`recipe ${key}`,1000)
  return p
}

// ---- filesystem helpers (lstat-per-component; see TOCTOU note in header)
function contained(root, rel) {
  safeRel(rel)
  const parts = rel.split('/')
  let current = root
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i])
    let st
    try { st = fs.lstatSync(current) } catch (e) { if (e.code === 'ENOENT') break; refuse('PATH_ESCAPE', 'preflight', 'Path component not inspectable', { path: rel }) }
    if (st.isSymbolicLink()) refuse('PATH_ESCAPE', 'preflight', 'Symlink path refused', { path: rel })
    if (i < parts.length - 1 && !st.isDirectory()) refuse('PATH_NOT_DIRECTORY', 'preflight', 'Path component is not a directory', { path: rel })
  }
  return path.join(root, ...parts)
}
function bytesAt(file, rel) {
  let st
  try { st = fs.lstatSync(file) } catch (e) { if (e.code === 'ENOENT') return null; throw e }
  if (!st.isFile()) refuse('PATH_NOT_REGULAR', 'preflight', 'Target is not a regular file', { path: rel })
  if (st.size > 1_000_000) refuse('FILE_TOO_LARGE', 'preflight', 'Target file too large', { path: rel })
  return fs.readFileSync(file)
}
const identity = bytes => bytes === null ? null : hash(bytes)
/** Parent dirs that do not exist yet (relative, outermost first): recorded as intent BEFORE any is created. */
function missingParents(root, rel) {
  const out = []; let current = root
  for (const part of rel.split('/').slice(0, -1)) { current = path.join(current, part); if (!fs.existsSync(current)) out.push(path.relative(root, current)) }
  return out
}
/** Creates missing parent dirs one level at a time and returns exactly those it created (for rollback). */
function ensureParents(root, rel, created) {
  const parts = rel.split('/').slice(0, -1)
  let current = root
  for (const part of parts) {
    current = path.join(current, part)
    try { fs.mkdirSync(current); created.push(path.relative(root, current)) } catch (e) { if (e.code !== 'EEXIST') throw e }
  }
}
const withTimeout = (promise, ms, controller) => new Promise((resolve, reject) => {
  const t = setTimeout(() => { controller.abort(); reject(new BlueprintError('CHECK_TIMEOUT', 'validate', 'Check timed out')) }, ms)
  promise.then(v => { clearTimeout(t); resolve(v) }, e => { clearTimeout(t); reject(e) })
})

export function createBlueprintCore({ workspace, stateRoot, controlRoot, control: injectedControl, lease, checks, verifyLease, afterWrite, faultHook, previewRequiresLease = true, now = Date.now, approvalTtlMs = 15 * 60_000, checkTimeoutMs = 30_000, authorityStop = null }) {
  // Trusted host inputs. Never construct these from imported JSON or unauthenticated body fields.
  if (typeof workspace?.getBaseRevision !== 'function' || !workspace?.id) throw new Error('Host workspace id and getBaseRevision are required')
  if (!lease && typeof verifyLease !== 'function') throw new Error('Host lease handle (or verifyLease callback) is required')
  const leaseHandle = lease ?? { verify: verifyLease }
  const root = fs.realpathSync(workspace.root)
  if (path.resolve(workspace.root) !== root) throw new Error('Workspace root must be canonical')
  fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 })
  const state = fs.realpathSync(stateRoot)
  const outside = dir => dir !== root && !dir.startsWith(root + path.sep)
  if (!outside(state)) throw new Error('Evidence must live outside target workspace')
  const control = injectedControl ?? (controlRoot ? createControlPlane({ root: controlRoot, now }) : null)
  if (!control) throw new Error('A durable control plane (control or controlRoot) is required')
  if (!outside(control.root)) throw new Error('Control store must live outside target workspace')
  const ledger = control.effects
  // Registry snapshot: later host-side mutation of the passed object cannot swap a check after approval.
  const registry = new Map()
  for (const [id, c] of Object.entries(checks ?? {})) {
    if (typeof c?.run !== 'function' || typeof c.version !== 'string') throw new Error(`Invalid registered check: ${id}`)
    if (c.digest != null && !/^[a-f0-9]{64}$/.test(c.digest)) throw new Error(`Invalid implementation digest for check: ${id}`)
    const timeoutMs = c.timeoutMs == null ? checkTimeoutMs : Math.min(Number(c.timeoutMs), checkTimeoutMs); if (!(timeoutMs > 0)) throw new Error(`Invalid timeout for check: ${id}`)
    registry.set(id, Object.freeze({ version: c.version, role: c.role, run: c.run, digest: c.digest ?? null, scope: c.scope ?? 'workspace-read', timeoutMs, timeoutDeclared: c.timeoutMs == null ? null : Number(c.timeoutMs), cancellable: c.cancellable === true }))
  }
  let running = false
  const suspectChecks = new Set() // timed-out checks that may still be running: block new work until the host confirms
  const leaseOk = () => { try { return leaseHandle.verify() === true } catch { return false } }
  const touch = () => { try { leaseHandle.heartbeat?.() } catch { /* loss is detected by leaseOk */ } }
  const baseRevision = () => { try { return String(workspace.getBaseRevision()) } catch { refuse('BASE_REVISION_MISMATCH', 'preflight', 'Base identity unavailable from host') } }
  const fault = (point, rel) => faultHook?.(point, rel) // trusted host fault-injection; never package input
  const recipeOf = (p, digest, status, receiptRef = null, importedBy = null) => ({ ...p.recipe, status, demonstratedReuse: false, masteryClaimed: false,
    sourceKind: 'manual-package-import', provenanceClaimVerified: false, importedBy, researchRefs: p.research.map(r => ({ url: r.url, digest: r.digest, license: r.license })),
    sourcePackageId: p.id, sourcePackageDigest: digest, contentHash: hash(canonical({ recipe: p.recipe, changes: p.changes.map(c => [c.path, c.operation, hash(c.content)]), checks: p.checks })), sourceReceipt: receiptRef })
  const seal = obj => control.signer.seal(obj)
  const evidenceAbs = ref => { // ref format is fixed so callers cannot traverse out of the evidence store
    if (typeof ref !== 'string' || !/^[0-9a-f-]{36}\/(?:(?:receipt|package\.original|plan\.canonical)\.json|recovery-\d+\.json|\d+\.before)$/.test(ref) || !UUID.test(ref.slice(0, 36))) refuse('EVIDENCE_UNAVAILABLE', 'evidence', 'Invalid evidence reference')
    return path.join(state, ref)
  }
  const scrub = text => String(text).split(root).join('<workspace>').split(state).join('<evidence>').split(control.root).join('<control>')
  const TERMINAL = new Set(['VERIFIED_SOURCE', 'FAILED_ROLLED_BACK', 'BLOCKED', 'ROLLBACK_INCOMPLETE', 'CANCELLED_ROLLED_BACK', 'CANCELLED_NO_CHANGES', 'CANCELLED_RETAINED', 'CANCELLED_ROLLBACK_INCOMPLETE'])
  const readFileAt = rel => identity(bytesAt(contained(root, rel), rel))

  const checkBinding = p => checkBindingOf(id => registry.get(id), p.checks)
  function preflight(p, applied = new Map(), { lease: needsLease = true } = {}) { // applied: path -> afterHash for effects the ledger records as COMPLETED (resume only)
    if (p.workspace.id !== workspace.id) refuse('WORKSPACE_MISMATCH','preflight','Wrong workspace',{expected:workspace.id,observed:p.workspace.id})
    const actual = baseRevision()
    if (actual !== p.workspace.baseRevision) refuse('BASE_REVISION_MISMATCH','preflight','Refresh the package baseline',{expected:p.workspace.baseRevision,observed:actual})
    if (needsLease && !leaseOk()) refuse('WORKSPACE_BUSY','preflight','Exclusive host workspace lease required')
    const inventory = typeof workspace.getDependencies === 'function' ? workspace.getDependencies(p.dependencies.map(d => d.name)) : (workspace.dependencies ?? {}) // host evidence at CHECK time, never a stale snapshot
    for (const d of p.dependencies) if (!Object.hasOwn(inventory, d.name) || inventory[d.name] !== d.version) refuse('DEPENDENCY_PLAN_REQUIRED','preflight','Dependency is not provisioned at declared version',{expected:d,observed:Object.hasOwn(inventory, d.name) ? inventory[d.name] : null})
    for (const c of p.checks) if (!registry.has(c.id) || registry.get(c.id).version !== c.version || ['build', 'artifact-verification'].includes(registry.get(c.id).role)) refuse('UNAPPROVED_RECIPE','preflight','Unknown check or version, or a stage-only role a package may not reference',{expected:c})
    if (!p.checks.some(c => registry.get(c.id).role === 'dependency-audit')) refuse('DEPENDENCY_AUDIT_REQUIRED','preflight','A registered dependency audit is mandatory')
    for (const c of p.changes) {
      const got = readFileAt(c.path), want = applied.get(c.path) ?? c.beforeHash
      if (got !== want) refuse('FILE_HASH_MISMATCH','preflight','Refresh the exact supplied file change',{path:c.path,expected:want,observed:got})
    }
  }
  function loadReview(reviewId) {
    const rec = control.approvals.getReview(reviewId)
    if (!rec) return null
    const p = parse(rec.raw), digest = hash(canonical(p))
    if (digest !== rec.digest) refuse('CONTROL_STORE_CORRUPT', 'control', 'Stored review does not match its digest')
    return { p, raw: rec.raw, digest, rec }
  }
  function buildView(p, digest, reviewId) {
    return {
      reviewId, digest, goal: p.goal, packageId: p.id, workspaceId: p.workspace.id, baseRevision: p.workspace.baseRevision,
      changes: p.changes.map(c => ({ path: c.path, operation: c.operation, beforeHash: c.beforeHash, afterHash: hash(c.content), before: bytesAt(contained(root, c.path), c.path)?.toString('utf8') ?? null, after: c.content })),
      checks: p.checks.map(c => ({ ...c, implementationDigest: registry.get(c.id).digest, scope: registry.get(c.id).scope, role: registry.get(c.id).role })), checkBinding: checkBinding(p), dependencies: p.dependencies, build: p.build ?? null, artifact: p.artifact,
      research: p.research.map(r => ({ ...r, note: 'Reference only: never fetched, executed, or treated as instructions' })),
      recipe: recipeOf(p, digest, 'CANDIDATE_UNVERIFIED'),
      limits: 'Source validation only. No build, packaging, install or dependency resolution is performed or claimed.',
    }
  }
  function preview(raw) {
    let p
    try {
      p = parse(raw); preflight(p, new Map(), { lease: previewRequiresLease })
      const digest = hash(canonical(p)), reviewId = randomUUID(), view = buildView(p, digest, reviewId)
      control.approvals.putReview({ reviewId, raw, digest, workspaceId: workspace.id })
      return structuredClone(view) // callers cannot mutate the stored review
    } catch (e) { if (e instanceof BlueprintError && p) e.packageId = p.id; throw e }
  }
  /** Re-render a stored review (no new review is created). Re-runs the read-only staleness preflight. */
  function reviewView(reviewId) {
    const review = loadReview(reviewId)
    if (!review) refuse('APPROVAL_MISMATCH','approval','Unknown review')
    preflight(review.p, new Map(), { lease: previewRequiresLease })
    return { ...structuredClone(buildView(review.p, review.digest, reviewId)), used: review.rec.used }
  }
  function actorOk(actor) { if (typeof actor !== 'string' || !actor.trim() || actor.length > 200 || /[\x00-\x1f]/.test(actor)) refuse('INVALID_PACKAGE','approval','Invalid authenticated actor') }
  function approve(reviewId, digest, actor) {
    const review = loadReview(reviewId)
    if (!review || review.digest !== digest) refuse('APPROVAL_MISMATCH','approval','Review exact package content first')
    if (review.rec.used) refuse('APPROVAL_REPLAYED','approval','This review was already executed')
    actorOk(actor); preflight(review.p, new Map(), { lease: previewRequiresLease })
    return control.approvals.issue({ kind: 'execute', reviewId, digest, workspaceId: workspace.id, actor, baseRevision: review.p.workspace.baseRevision, ttlMs: approvalTtlMs, checkBinding: checkBinding(review.p) })
  }
  /** Shared gate for execute/resume approvals. Does not consume. */
  function openApproval(handle, kind, bind) {
    const loaded = control.approvals.load(handle) // throws APPROVAL_FORGED on tampered record
    if (!loaded) refuse('APPROVAL_REQUIRED','approval','Server-issued approval bound to this request required')
    const rec = loaded.record
    if (rec.kind !== kind || rec.workspaceId !== workspace.id || Object.entries(bind).some(([k, v]) => rec[k] !== v)) refuse('APPROVAL_REQUIRED','approval','Server-issued approval bound to this request required')
    if (loaded.consumed) refuse('APPROVAL_REPLAYED','approval','Approval already used')
    if (now() > rec.expiresAt) refuse('APPROVAL_EXPIRED','approval','Approval expired')
    return loaded
  }
  async function execute(reviewId, approvalHandle, { runId: forcedRunId } = {}) {
    if (running) refuse('WORKSPACE_BUSY','preflight','An execution is already active')
    if (suspectChecks.size) refuse('WORKSPACE_BUSY','preflight','A timed-out check may still be running; host must confirm it stopped',{observed:[...suspectChecks]})
    const loaded = openApproval(approvalHandle, 'execute', { reviewId })
    const review = loadReview(reviewId)
    if (!review) refuse('APPROVAL_REQUIRED','approval','Server-issued approval bound to this review required')
    if (review.rec.used) refuse('APPROVAL_REPLAYED','approval','This review was already executed')
    if (loaded.record.digest !== review.digest) refuse('APPROVAL_MISMATCH','approval','Approval is bound to different package content')
    const nowChecks = checkBinding(review.p) // implementation drift of a registered check since approval refuses WITHOUT burning the approval
    if (loaded.record.checkBinding !== nowChecks) refuse('CHECK_DRIFT','approval','A registered check changed after approval',{expected:loaded.record.checkBinding,observed:nowChecks})
    const current = baseRevision() // stale approval: the host base identity moved since approval. Refused WITHOUT burning the approval.
    if (loaded.record.baseRevision !== current || review.p.workspace.baseRevision !== current) refuse('APPROVAL_STALE','approval','Approval was granted against a different base identity',{expected:loaded.record.baseRevision,observed:current})
    if (forcedRunId !== undefined && (typeof forcedRunId !== 'string' || !UUID.test(forcedRunId))) refuse('INVALID_PACKAGE','approval','Invalid run id')
    const runId = forcedRunId ?? randomUUID()
    if (!control.approvals.consume(loaded.handleHash, runId) || !control.approvals.markReviewUsed(reviewId, runId)) refuse('APPROVAL_REPLAYED','approval','Approval already used') // one attempt; fresh review/approval needed for retry
    running = true
    try { return await begin(review, loaded.record, runId, reviewId) } finally { running = false }
  }

  // ------------------------------------------------------------ run lifecycle
  const newCtx = (p, raw, digest, runId, receipt) => {
    const dir = path.join(state, runId)
    const persist = () => atomic(path.join(dir, 'receipt.json'), JSON.stringify(seal(receipt), null, 2), 0o600)
    const stage = name => { receipt.status = name; receipt.events.push({ stage: name, at: new Date().toISOString() }); persist() }
    return { p, raw, digest, runId, receipt, dir, persist, stage, attempted: receipt.files }
  }
  async function begin({ p, raw, digest }, approvalRec, runId, reviewId) {
    const dir = path.join(state, runId), ref = name => `${runId}/${name}`, info = (() => { try { return leaseHandle.info?.() ?? null } catch { return null } })()
    const receipt = { version: 2, runId, reviewId, packageId: p.id, digest, rawPackageHash: hash(raw), actor: approvalRec.actor, status: 'PREFLIGHT',
      approval: { issuedAt: approvalRec.issuedAt, expiresAt: approvalRec.expiresAt, boundDigest: approvalRec.digest }, checkBinding: approvalRec.checkBinding ?? null, // check implementations the ORIGINAL approval covered
      lease: info && { leaseId: info.leaseId, holder: info.holder, epoch: info.epoch },
      workspace: { id: workspace.id, baseRevisionExpected: p.workspace.baseRevision, baseRevisionObserved: null },
      events: [], files: [], checks: [], checksNotRun: [], artifact: null, error: null, rollback: null, cancel: null, resumes: 0,
      recipe: recipeOf(p, digest, 'CANDIDATE_UNVERIFIED', ref('receipt.json'), approvalRec.actor),
      claims: { sourceValidated: false, built: false, packaged: false, installed: false, taskComplete: false },
      evidenceRef: ref('receipt.json') } // refs are relative to the host evidence store: no absolute host paths in receipts
    const ctx = newCtx(p, raw, digest, runId, receipt)
    try { // evidence must be durable BEFORE any workspace mutation; immutable original package + normalized plan
      fs.mkdirSync(dir, { mode: 0o700 })
      for (const [name, body] of [['package.original.json', raw], ['plan.canonical.json', canonical(p)]]) {
        const fd = fs.openSync(path.join(dir, name), 'wx', 0o400); try { fs.writeFileSync(fd, body); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
      }
      ctx.persist()
    } catch { refuse('EVIDENCE_UNAVAILABLE', 'preflight', 'Cannot persist evidence; nothing was applied') }
    return drive(ctx, false)
  }
  const checkStop = (ctx, point) => { // read-only durable cancel check; a corrupt/tampered record throws (fail closed)
    // HOST AUTHORITY WINS: live mission/assignment cancel/pause is observed first and can never be overridden by broker-local state. An unreadable authority pauses (no blind rollback).
    let ext = null; if (authorityStop) { try { ext = authorityStop({ runId: ctx.runId }, point) } catch { ext = { kind: 'PAUSE', reason: 'AUTHORITY_UNREADABLE' } } }
    const iso = t => new Date(t).toISOString()
    if (ext?.kind === 'CANCEL') {
      ctx.receipt.cancel = { request: { actor: 'host-authority', reason: String(ext.reason ?? 'host cancellation').slice(0, 200), disposition: 'ROLLBACK', requestedAt: iso(now()) }, observedAt: iso(now()), stopPoint: point, disposition: null, source: 'host-authority' }
      refuse('CANCELLED', 'cancel', 'Host authority cancelled or revoked this work', { stopPoint: point })
    }
    const req = control.cancels.find({ runId: ctx.runId, reviewId: ctx.receipt.reviewId })
    if (!req && ext?.kind === 'PAUSE') {
      ctx.receipt.pause = { kind: 'PAUSE', actor: 'host-authority', reason: String(ext.reason ?? 'host pause').slice(0, 200), requestedAt: iso(now()), observedAt: iso(now()), stopPoint: point, source: 'host-authority' }
      refuse('PAUSED', 'pause', 'Host authority paused this work', { stopPoint: point })
    }
    if (!req) { // no cancel: honour a pause/stop hold (a tampered pause record throws => fail closed)
      const pz = control.pauses.active({ runId: ctx.runId, reviewId: ctx.receipt.reviewId })
      if (!pz) return
      ctx.receipt.pause = { kind: pz.kind, actor: pz.actor, reason: pz.reason, requestedAt: new Date(pz.requestedAt).toISOString(), observedAt: new Date(now()).toISOString(), stopPoint: point }
      refuse('PAUSED', 'pause', 'Pause requested', { stopPoint: point })
    }
    ctx.receipt.cancel = { request: { actor: req.actor, reason: req.reason, disposition: req.disposition, requestedAt: new Date(req.requestedAt).toISOString() }, observedAt: new Date(now()).toISOString(), stopPoint: point, disposition: null }
    refuse('CANCELLED', 'cancel', 'Cancellation requested', { stopPoint: point })
  }
  const recheckBase = (ctx, point) => { // base identity must be unchanged immediately before every mutation and before final source validation
    const cur = baseRevision(), want = ctx.receipt.workspace.baseRevisionExpected
    if (cur !== want) refuse('BASE_REVISION_MISMATCH', ctx.receipt.status, 'Base identity changed during execution', { expected: want, observed: cur, stepId: point })
  }
  const writeSteps = p => p.changes.map((c, i) => ({ stepId: `write:${i}:${c.path}`, kind: 'file-write' }))

  async function drive(ctx, resume) {
    const { p, digest, runId, receipt, persist, stage, attempted } = ctx
    try {
      if (resume) receipt.pause = null
      let applied = new Map()
      if (resume) for (const [i, c] of p.changes.entries()) if (ledger.get(runId, digest, `write:${i}:${c.path}`)?.state === 'COMPLETED') applied.set(c.path, hash(c.content))
      preflight(p, applied); receipt.workspace.baseRevisionObserved ??= baseRevision()
      checkStop(ctx, 'before-start')
      ledger.planMissing(runId, digest, writeSteps(p)) // consequential effects recorded BEFORE any execution (idempotent: safe on resume/pause)
      stage('APPLYING')
      for (const [i, c] of p.changes.entries()) {
        touch(); checkStop(ctx, `before-file:${c.path}`); recheckBase(ctx, 'before-file')
        if (!leaseOk()) refuse('LEASE_LOST','apply','Workspace lease lost',{path:c.path})
        const stepId = `write:${i}:${c.path}`, decision = ledger.decide(runId, digest, stepId), file = contained(root, c.path), before = bytesAt(file, c.path)
        if (decision === 'SKIP_COMPLETED') { // never repeat a COMPLETED effect; just verify the workspace still reflects it
          if (identity(before) !== hash(c.content)) refuse('FILE_HASH_MISMATCH','apply','Completed effect no longer matches the workspace',{path:c.path,expected:hash(c.content),observed:identity(before)})
          continue
        }
        if (decision === 'RECONCILE_REQUIRED') refuse('RECONCILIATION_REQUIRED','apply','Effect state unknown after crash; reconcile before any replay',{stepId,path:c.path})
        if (decision !== 'EXECUTE') refuse('EXECUTION_FAILED','apply','Effect previously failed and may not be retried automatically',{stepId,path:c.path})
        if (identity(before) !== c.beforeHash) refuse('FILE_HASH_MISMATCH','apply','File changed after review',{path:c.path,expected:c.beforeHash,observed:identity(before)})
        const mode = before === null ? 0o644 : fs.statSync(file).mode & 0o777
        const record = { path: c.path, operation: c.operation, beforeHash: c.beforeHash, afterHash: hash(c.content), mode, createdDirs: missingParents(root, c.path), phase: 'INTENT', snapshot: before === null ? null : `${runId}/${attempted.length}.before` }
        if (record.snapshot) { const fd = fs.openSync(evidenceAbs(record.snapshot), 'wx', 0o600); try { fs.writeFileSync(fd, before); fs.fsyncSync(fd) } finally { fs.closeSync(fd) } }
        attempted.push(record); persist() // durable intent before ANY mutation of this file
        ledger.transition(runId, digest, stepId, 'STARTED')
        fault('after-intent', c.path)
        ensureParents(root, c.path, []); record.phase = 'PARENTS'; persist()
        atomic(file, c.content, mode); record.phase = 'LANDED'; persist()
        fault('after-write-before-ledger', c.path)
        ledger.transition(runId, digest, stepId, 'COMPLETED', { afterHash: record.afterHash })
        afterWrite?.(c.path)
      }
      stage('VALIDATING')
      const landedOk = checkId => {
        for (const c of p.changes) if (readFileAt(c.path) !== hash(c.content)) refuse('POST_VALIDATION_DRIFT','validate','Validated source no longer matches applied package',{path:c.path,checkId})
      }
      for (const c of p.checks) {
        touch(); checkStop(ctx, `before-check:${c.id}`)
        if (!leaseOk()) refuse('LEASE_LOST','validate','Workspace lease lost',{checkId:c.id})
        const entry = registry.get(c.id), stepId = `check:${c.id}:r${receipt.resumes}`
        if (entry.version !== c.version) refuse('UNAPPROVED_RECIPE','validate','Check changed after approval',{checkId:c.id})
        ledger.plan(runId, digest, [{ stepId, kind: 'check' }]); ledger.transition(runId, digest, stepId, 'STARTED')
        let result = null, status, evidence = ''
        const controller = new AbortController()
        try { result = await withTimeout(Promise.resolve().then(() => entry.run({ root, package: structuredClone(p), signal: controller.signal, scope: entry.scope })), entry.timeoutMs, controller) }
        catch (e) {
          status = e?.code === 'CHECK_TIMEOUT' ? 'TIMEOUT' : 'ERROR'; evidence = e instanceof BlueprintError ? e.message : 'Check threw an exception'
          if (status === 'TIMEOUT') suspectChecks.add(c.id)
        }
        if (!status) {
          evidence = scrub(String(result?.evidence ?? '').slice(0, 4000))
          status = ['PASS','FAIL','SKIPPED'].includes(result?.status) ? result.status : 'INCONCLUSIVE'
          if (status === 'PASS' && !evidence) status = 'INCONCLUSIVE' // no evidence, no pass
        }
        receipt.checks.push({ id: c.id, version: c.version, status, evidence, scope: entry.scope, implementationDigest: entry.digest }); persist()
        ledger.transition(runId, digest, stepId, status === 'PASS' ? 'COMPLETED' : 'FAILED', { status, notApplied: true }) // checks mutate nothing the adapter owns: rerunnable
        if (status !== 'PASS') refuse('VALIDATION_FAILED','validate','Required registered check did not provide passing evidence',{checkId:c.id,expected:'PASS',observed:status})
        landedOk(c.id) // a check that mutated applied source invalidates the validation
      }
      checkStop(ctx, 'before-finalize') // cancellation can never be converted into success
      recheckBase(ctx, 'before-finalize')
      if (!leaseOk()) refuse('LEASE_LOST','validate','Workspace lease lost before completion')
      const artifact = bytesAt(contained(root, p.artifact.path), p.artifact.path)
      if (identity(artifact) !== p.artifact.sha256) refuse('ARTIFACT_MISMATCH','artifact','Expected artifact not produced',{path:p.artifact.path,expected:p.artifact.sha256,observed:identity(artifact)})
      receipt.artifact = { kind: 'source-file', path: p.artifact.path, sha256: hash(artifact), bytes: artifact.length }
      receipt.recipe.status = 'VALIDATED_ON_THIS_TASK_ONLY'
      receipt.claims.sourceValidated = true // built/packaged/installed/taskComplete stay false: not performed in this slice
      stage('VERIFIED_SOURCE')
    } catch (e) {
      if (e?.code === 'PAUSED') { // hold at a safe boundary: nothing is rolled back, nothing is claimed, state is durable and resumable
        receipt.error = null; receipt.pauseHistory = [...(receipt.pauseHistory ?? []), receipt.pause]
        try { stage('PAUSED') } catch { receipt.persistError = 'Receipt could not be persisted' }
        return structuredClone(receipt)
      }
      const failedStage = receipt.status, cancelled = e?.code === 'CANCELLED'
      receipt.error = describeError(e, { stage: failedStage, packageId: p.id, evidenceRef: receipt.evidenceRef })
      receipt.checksNotRun = p.checks.map(c => c.id).filter(id => !receipt.checks.some(r => r.id === id && r.status))
      if (suspectChecks.size) receipt.warning = 'A timed-out check may still be running and mutating the workspace; rollback results are not trustworthy until the host confirms it stopped'
      settleStarted(ctx)
      let final
      if (cancelled && receipt.cancel.request.disposition === 'RETAIN' && attempted.length) {
        receipt.rollback = { attempted: 0, retained: attempted.map(r => r.path), errors: [], preserved: [] }
        receipt.cancel.disposition = 'RETAINED_FOR_REVIEW'; final = 'CANCELLED_RETAINED' // applied but NOT validated/verified: never success
      } else {
        const out = restoreFiles(ctx, { requireLease: false, tag: 'rollback' })
        receipt.rollback = { attempted: attempted.length, errors: out.errors, preserved: out.preserved }
        if (cancelled) { receipt.cancel.disposition = out.errors.length ? 'ROLLBACK_INCOMPLETE' : attempted.length ? 'ROLLED_BACK' : 'NO_CHANGES'; final = out.errors.length ? 'CANCELLED_ROLLBACK_INCOMPLETE' : attempted.length ? 'CANCELLED_ROLLED_BACK' : 'CANCELLED_NO_CHANGES' }
        else final = out.errors.length ? 'ROLLBACK_INCOMPLETE' : attempted.length ? 'FAILED_ROLLED_BACK' : 'BLOCKED'
      }
      try { stage(final) } catch { receipt.status = final; receipt.persistError = 'Receipt could not be persisted' }
    }
    return structuredClone(receipt)
  }
  /** Resolve this run's STARTED file-write effects after a handled failure by observing the workspace. */
  function settleStarted(ctx) {
    const { p, digest, runId } = ctx
    try {
      for (const [i, c] of p.changes.entries()) {
        const e = ledger.get(runId, digest, `write:${i}:${c.path}`); if (e?.state !== 'STARTED') continue
        let cur; try { cur = readFileAt(c.path) } catch { cur = 'UNREADABLE' }
        if (cur === hash(c.content)) ledger.transition(runId, digest, e.stepId, 'COMPLETED', { afterHash: cur, settled: 'observed-after' })
        else if (cur === c.beforeHash) ledger.transition(runId, digest, e.stepId, 'FAILED', { notApplied: true, settled: 'observed-before' })
        else ledger.transition(runId, digest, e.stepId, 'UNKNOWN_AFTER_CRASH', { settled: 'observed-drift' })
      }
    } catch { ctx.receipt.ledgerIncomplete = true }
  }

  /** Observation-driven restore shared by in-run rollback (lease optional => deferred) and operator restore (lease REQUIRED).
   * Only restores files whose current hash is exactly this run's applied version; never overwrites anything else. */
  function restoreFiles(ctx, { tag }) {
    const { attempted, runId, digest } = ctx, errors = [], preserved = [], actions = []
    const safe = err => err instanceof BlueprintError ? err.message : `Rollback step failed (${String(err?.code ?? 'error').slice(0, 20)})`
    const led = fn => { try { fn() } catch { ctx.receipt.ledgerIncomplete = true } }
    if (!leaseOk()) { // never mutate without the exclusive lease: defer to operator with snapshot refs
      for (const r of attempted) errors.push({ path: r.path, message: 'Lease lost; rollback deferred', snapshot: r.snapshot })
      return { errors, preserved, actions, deferred: true }
    }
    const latest = new Map(); for (const r of attempted) latest.set(r.path, r) // duplicate records (resume) share before/after
    const seenPaths = new Set()
    for (const [idx, r] of attempted.map((r, idx) => [idx, r]).reverse()) {
      const stepId = `restore:${tag}:${idx}:${r.path}`
      try {
        const file = contained(root, r.path), cur = identity(bytesAt(file, r.path))
        let action = 'ALREADY_BEFORE'
        if (cur === r.afterHash && !(seenPaths.has(r.path))) {
          led(() => { ledger.plan(runId, digest, [{ stepId, kind: 'file-restore' }]); ledger.transition(runId, digest, stepId, 'STARTED') })
          if (r.snapshot) {
            const snap = fs.readFileSync(evidenceAbs(r.snapshot))
            if (hash(snap) !== r.beforeHash) { led(() => ledger.transition(runId, digest, stepId, 'FAILED', { notApplied: true })); throw new BlueprintError('ROLLBACK_INCOMPLETE', 'rollback', 'Snapshot integrity check failed; not restoring') }
            atomic(file, snap, r.mode); action = 'RESTORED'
          } else { fs.unlinkSync(file); action = 'REMOVED' }
          led(() => ledger.transition(runId, digest, stepId, 'COMPLETED', { action }))
        } else if (cur !== r.beforeHash && cur !== r.afterHash) { action = 'PRESERVED_DRIFT'; throw new BlueprintError('ROLLBACK_INCOMPLETE', 'rollback', 'Concurrent edit preserved; not overwritten') }
        else if (cur === r.beforeHash) action = 'ALREADY_BEFORE'
        else action = 'ALREADY_HANDLED'
        seenPaths.add(r.path); actions.push({ path: r.path, action })
        for (const d of [...(r.createdDirs ?? [])].reverse()) { // only dirs this run created, only if now empty
          safeRel(d); const abs = path.join(root, d)
          try { fs.rmdirSync(abs) } catch (err) { if (err.code === 'ENOTEMPTY') preserved.push({ path: d, note: 'Created directory now has other content; left in place' }); else if (err.code !== 'ENOENT') throw err }
        }
      } catch (err) { errors.push({ path: r.path, message: safe(err), snapshot: r.snapshot }); actions.push({ path: r.path, action: 'FAILED' }) }
    }
    return { errors, preserved, actions, deferred: false }
  }

  // ------------------------------------------------------------ recovery
  function loadRun(runId) {
    if (typeof runId !== 'string' || !UUID.test(runId)) refuse('EVIDENCE_UNAVAILABLE', 'evidence', 'Invalid run id')
    const raw = readJson(evidenceAbs(`${runId}/receipt.json`))
    if (!raw) refuse('EVIDENCE_UNAVAILABLE', 'evidence', 'Receipt not readable')
    const receipt = control.signer.open(raw)
    if (receipt.runId !== runId || receipt.workspace?.id !== workspace.id) refuse('WORKSPACE_MISMATCH', 'recovery', 'Run belongs to a different workspace/run')
    let rawPkg
    try { rawPkg = fs.readFileSync(evidenceAbs(`${runId}/package.original.json`), 'utf8') } catch { refuse('EVIDENCE_UNAVAILABLE', 'evidence', 'Original package not readable') }
    if (hash(rawPkg) !== receipt.rawPackageHash) refuse('CONTROL_STORE_CORRUPT', 'recovery', 'Original package does not match receipt hash')
    const p = parse(rawPkg)
    if (hash(canonical(p)) !== receipt.digest) refuse('CONTROL_STORE_CORRUPT', 'recovery', 'Plan digest mismatch')
    const changePaths = new Set(p.changes.map(c => c.path))
    for (const f of receipt.files) { // receipt paths must be the package's own paths, and snapshot refs well-formed
      if (!changePaths.has(f.path)) refuse('CONTROL_STORE_CORRUPT', 'recovery', 'Receipt references a path outside the package', { path: f.path })
      if (f.snapshot) evidenceAbs(f.snapshot)
      for (const d of f.createdDirs ?? []) safeRel(d)
    }
    return { receipt, p, rawPkg, dir: path.join(state, runId) }
  }
  const recoveryReceipts = dir => fs.readdirSync(dir).filter(n => /^recovery-\d+\.json$/.test(n)).sort((a, b) => parseInt(a.slice(9)) - parseInt(b.slice(9)))
  const writeRecovery = (run, body) => {
    const n = recoveryReceipts(run.dir).length + 1, name = `recovery-${n}.json`
    const rec = seal({ version: 1, runId: run.receipt.runId, packageDigest: run.receipt.digest, sequence: n, at: new Date(now()).toISOString(), ...body, claims: { built: false, packaged: false, installed: false, taskComplete: false } })
    if (!createExclusive(path.join(run.dir, name), JSON.stringify(rec, null, 2))) refuse('EVIDENCE_UNAVAILABLE', 'recovery', 'Recovery receipt collision')
    return { ref: `${run.receipt.runId}/${name}`, ...rec }
  }
  /** Read-only. Never mutates workspace, receipt or ledger. */
  function classifyRun(runId) {
    const reasons = [], review = (cls, extra = {}) => ({ runId, classification: cls, reasons, ...extra })
    let run
    try { run = loadRun(runId) } catch (e) { reasons.push(e instanceof BlueprintError ? `${e.code}: ${e.message}` : 'unreadable'); return review('NEEDS_OPERATOR_REVIEW', { status: null, allowed: [], files: [], effects: [] }) }
    const { receipt } = run
    let led; try { led = ledger.read(runId) } catch (e) { reasons.push(`LEDGER: ${e.message}`); return review('NEEDS_OPERATOR_REVIEW', { status: receipt.status, allowed: [], files: [], effects: [] }) }
    const effects = [...led.effects.values()].map(e => ({ stepId: e.stepId, kind: e.kind, state: e.state, irreversible: e.irreversible, notApplied: e.detail?.notApplied === true }))
    const latest = new Map(); for (const f of receipt.files) latest.set(f.path, f)
    const files = [...latest.values()].map(f => {
      let cur; try { cur = identity(bytesAt(contained(root, f.path), f.path)) } catch { cur = 'UNREADABLE' }
      return { path: f.path, observed: cur === 'UNREADABLE' ? 'UNREADABLE' : cur === f.afterHash ? 'AFTER' : cur === f.beforeHash ? 'BEFORE' : 'DRIFTED' }
    })
    const terminal = TERMINAL.has(receipt.status), status = receipt.status
    const base = { status, terminal, files, effects, allowed: [], requiresReconcile: false, honesty: 'VERIFIED_SOURCE is source validation only; no build/package/install claim.' }
    const recs = recoveryReceipts(run.dir).map(n => control.signer.open(readJson(path.join(run.dir, n))))
    const restored = recs.at(-1)?.kind === 'restore' && recs.at(-1).final === 'RESTORED'
    if (['FAILED_ROLLED_BACK', 'BLOCKED', 'CANCELLED_ROLLED_BACK', 'CANCELLED_NO_CHANGES'].includes(status)) { reasons.push(`run terminal: ${status}`); return review('ALREADY_COMPLETE', { ...base, outcome: status }) }
    if (restored && files.every(f => f.observed === 'BEFORE')) { reasons.push('operator restore receipt present and workspace is at BEFORE'); return review('ALREADY_COMPLETE', { ...base, outcome: 'RECOVERED_ROLLED_BACK' }) }
    if (led.torn) { reasons.push('ledger has a torn tail (interrupted append)'); base.requiresReconcile = true; base.allowed = ['RECONCILE', 'ROLLBACK']; return review('NEEDS_OPERATOR_REVIEW', base) }
    const bad = files.filter(f => f.observed === 'DRIFTED' || f.observed === 'UNREADABLE')
    if (bad.length) { reasons.push(`workspace drift: ${bad.map(f => f.path).join(', ')}`); base.allowed = ['ROLLBACK_PRESERVING_DRIFT']; return review('NEEDS_OPERATOR_REVIEW', base) }
    if (status === 'VERIFIED_SOURCE') {
      if (files.every(f => f.observed === 'AFTER')) { reasons.push('verified source still matches applied versions'); return review('ALREADY_COMPLETE', { ...base, outcome: 'VERIFIED_SOURCE' }) }
      reasons.push('verified source no longer matches'); return review('NEEDS_OPERATOR_REVIEW', base)
    }
    const unknown = effects.filter(e => ['STARTED', 'UNKNOWN_AFTER_CRASH'].includes(e.state))
    if (unknown.some(e => e.irreversible)) { reasons.push('irreversible effect with unknown outcome'); return review('NEEDS_OPERATOR_REVIEW', base) }
    const dead = effects.filter(e => e.state === 'FAILED' && e.kind === 'file-write' && !e.notApplied)
    if (dead.length) { reasons.push(`failed effect is not retryable without operator review: ${dead.map(e => e.stepId).join(', ')}`); base.allowed = ['ROLLBACK']; return review('NEEDS_OPERATOR_REVIEW', base) }
    if (unknown.length) { base.requiresReconcile = true; reasons.push(`effects need reconciliation before replay: ${unknown.map(e => e.stepId).join(', ')}`) }
    let cancelReq = null; try { cancelReq = control.cancels.find({ runId, reviewId: receipt.reviewId }) } catch { reasons.push('cancel record unreadable'); return review('NEEDS_OPERATOR_REVIEW', base) }
    let obsBase = null; try { obsBase = baseRevision() } catch { /* below */ }
    if (status === 'CANCELLED_RETAINED') { reasons.push('cancelled with applied work retained for operator decision'); base.allowed = ['ROLLBACK']; return review('NEEDS_OPERATOR_REVIEW', base) }
    if (obsBase !== (receipt.workspace.baseRevisionObserved ?? receipt.workspace.baseRevisionExpected)) { reasons.push('base identity changed since the run started'); base.allowed = ['ROLLBACK']; return review('NEEDS_OPERATOR_REVIEW', base) }
    if (cancelReq || ['ROLLBACK_INCOMPLETE', 'CANCELLED_ROLLBACK_INCOMPLETE'].includes(status) || receipt.error) {
      reasons.push(cancelReq ? 'cancel requested' : 'run already failed; rollback is the safe direction'); base.allowed = ['ROLLBACK']; return review('SAFE_TO_ROLLBACK', base)
    }
    reasons.push('interrupted run; every file is at its BEFORE or AFTER version, no drift'); base.allowed = base.requiresReconcile ? ['RECONCILE', 'ROLLBACK'] : ['RESUME', 'ROLLBACK']
    return review('SAFE_TO_RESUME', { ...base, resumeAfterReconcile: base.requiresReconcile })
  }
  function needLease(stage) {
    if (running) refuse('WORKSPACE_BUSY', stage, 'An execution is already active')
    if (!leaseOk()) refuse('LEASE_LOST', stage, 'A valid exclusive lease is required for this operation')
  }
  /** Settle effects of a dead run by observing the workspace. Requires a valid lease. Never replays. */
  function reconcileRun(runId, actor) {
    needLease('recovery'); actorOk(actor)
    const run = loadRun(runId), { p, receipt } = run, digest = receipt.digest, outcomes = []
    const repaired = ledger.repairTail(runId), marked = ledger.markUnknownAfterCrash(runId)
    for (const e of ledger.read(runId).effects.values()) {
      if (!['STARTED', 'UNKNOWN_AFTER_CRASH'].includes(e.state)) continue
      if (e.irreversible || !e.deterministic) { outcomes.push({ stepId: e.stepId, state: e.state, result: 'LEFT_UNKNOWN_OPERATOR_REQUIRED' }); continue }
      if (e.kind === 'file-write') {
        const i = Number(e.stepId.split(':')[1]), c = p.changes[i]; let cur; try { cur = readFileAt(c.path) } catch { cur = 'UNREADABLE' }
        if (cur === hash(c.content)) { ledger.transition(runId, digest, e.stepId, 'COMPLETED', { reconciled: 'OBSERVED_AFTER', afterHash: cur }); outcomes.push({ stepId: e.stepId, result: 'COMPLETED_OBSERVED_AFTER' }) }
        else if (cur === c.beforeHash) { ledger.transition(runId, digest, e.stepId, 'FAILED', { reconciled: 'OBSERVED_BEFORE', notApplied: true }); outcomes.push({ stepId: e.stepId, result: 'NOT_APPLIED_OBSERVED_BEFORE' }) }
        else outcomes.push({ stepId: e.stepId, state: e.state, result: 'LEFT_UNKNOWN_DRIFT' })
      } else { // file-restore / check: re-derivable from observation, safe to supersede
        ledger.transition(runId, digest, e.stepId, 'FAILED', { reconciled: 'SUPERSEDED', notApplied: true }); outcomes.push({ stepId: e.stepId, result: 'SUPERSEDED' })
      }
    }
    return writeRecovery(run, { kind: 'reconcile', actor, lease: leaseHandle.info?.() ? { leaseId: leaseHandle.info().leaseId, holder: leaseHandle.info().holder, epoch: leaseHandle.info().epoch } : null, tornTailRepaired: repaired, markedUnknown: marked, outcomes, classificationAfter: classifyRun(runId).classification })
  }
  /** Operator restore from snapshots. Lease REQUIRED (no deferred mode here). */
  function restoreRun(runId, actor) {
    needLease('recovery'); actorOk(actor)
    const run = loadRun(runId), cls = classifyRun(runId)
    if (cls.classification === 'ALREADY_COMPLETE') refuse('RECOVERY_NOT_ALLOWED', 'recovery', `Run is already terminal (${cls.outcome}); nothing to restore`)
    const ctx = { attempted: run.receipt.files, runId, digest: run.receipt.digest, receipt: { } }
    const tag = `op${recoveryReceipts(run.dir).length + 1}`
    const out = restoreFiles(ctx, { requireLease: true, tag })
    const info = leaseHandle.info?.()
    return writeRecovery(run, { kind: 'restore', actor, lease: info ? { leaseId: info.leaseId, holder: info.holder, epoch: info.epoch } : null, classificationBefore: cls.classification,
      files: out.actions, errors: out.errors, preserved: out.preserved, ledgerIncomplete: !!ctx.receipt.ledgerIncomplete, final: out.errors.length ? 'RESTORE_INCOMPLETE' : 'RESTORED' })
  }
  /** Resume authority is a fresh server-issued approval bound to the run and plan digest. */
  function approveResume(runId, actor) {
    actorOk(actor)
    const run = loadRun(runId), cls = classifyRun(runId)
    if (cls.classification !== 'SAFE_TO_RESUME') refuse('RECOVERY_NOT_ALLOWED', 'recovery', `Classification ${cls.classification} does not permit resume`, { observed: cls.reasons })
    const nowBinding = checkBinding(run.p) // resume authority may not be minted against checks other than the ones originally approved
    if (run.receipt.checkBinding && run.receipt.checkBinding !== nowBinding) refuse('CHECK_DRIFT', 'approval', 'A registered check changed since the original approval', { expected: run.receipt.checkBinding, observed: nowBinding })
    return control.approvals.issue({ kind: 'resume', runId, digest: run.receipt.digest, workspaceId: workspace.id, actor, baseRevision: run.receipt.workspace.baseRevisionExpected, ttlMs: approvalTtlMs, checkBinding: run.receipt.checkBinding ?? nowBinding })
  }
  async function resumeRun(runId, approvalHandle) {
    if (running) refuse('WORKSPACE_BUSY','recovery','An execution is already active')
    if (suspectChecks.size) refuse('WORKSPACE_BUSY','recovery','A timed-out check may still be running; host must confirm it stopped')
    const run = loadRun(runId), loaded = openApproval(approvalHandle, 'resume', { runId })
    if (loaded.record.digest !== run.receipt.digest) refuse('APPROVAL_MISMATCH','approval','Approval is bound to different package content')
    if (loaded.record.checkBinding !== checkBinding(run.p)) refuse('CHECK_DRIFT','approval','A registered check changed after approval',{expected:loaded.record.checkBinding,observed:checkBinding(run.p)})
    if (!leaseOk()) refuse('LEASE_LOST','recovery','A valid exclusive lease is required to resume')
    const cls = classifyRun(runId)
    if (cls.classification !== 'SAFE_TO_RESUME') refuse('RECOVERY_NOT_ALLOWED','recovery',`Classification ${cls.classification} does not permit resume`,{observed:cls.reasons})
    if (cls.requiresReconcile) refuse('RECONCILIATION_REQUIRED','recovery','Effects have unknown state; run reconcileRun first')
    if (!control.approvals.consume(loaded.handleHash, runId)) refuse('APPROVAL_REPLAYED','approval','Approval already used')
    running = true
    try {
      const { receipt, p, rawPkg } = run, ctx = newCtx(p, rawPkg, receipt.digest, runId, receipt)
      receipt.resumes += 1; receipt.error = null; receipt.events.push({ stage: 'RESUMED', at: new Date().toISOString(), by: loaded.record.actor })
      return await drive(ctx, true)
    } finally { running = false }
  }
  /** Read-only summary kept for compatibility with the first slice. */
  function inspectRun(runId) {
    const { receipt } = loadRun(runId)
    const files = receipt.files.map(f => {
      let cur; try { cur = identity(bytesAt(contained(root, f.path), f.path)) } catch { cur = 'UNREADABLE' }
      return { path: f.path, phase: f.phase, observed: cur === 'UNREADABLE' ? 'UNREADABLE' : cur === f.afterHash ? 'AFTER' : cur === f.beforeHash ? 'BEFORE' : 'DRIFTED' }
    })
    const interrupted = !TERMINAL.has(receipt.status)
    return { runId, status: receipt.status, interrupted, files, nextAction: interrupted
      ? 'Run did not reach a terminal state. Do not replay: use classifyRun, then reconcile/restore/resume under a valid lease.'
      : 'Run is terminal; see receipt.' }
  }
  const readReceipt = runId => structuredClone(loadRun(runId).receipt)
  const confirmCheckStopped = id => { suspectChecks.delete(id) } // host attests the timed-out check process is gone
  return { preview, reviewView, approve, execute, readReceipt, inspectRun, classifyRun, reconcileRun, restoreRun, approveResume, resumeRun, resolveEvidence: evidenceAbs, confirmCheckStopped }
}
