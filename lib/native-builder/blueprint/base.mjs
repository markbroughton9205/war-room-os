/** Shared primitives for the isolated blueprint adapter: hashing, canonical JSON, error contract, durable fs helpers. */
import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import path from 'node:path'

export const hash = value => createHash('sha256').update(value).digest('hex')
export const canonical = value => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v)

// ---- error contract: code, stage, packageId, stepId, path, expected, observed, evidenceRef, retryable, nextAction, approvalRequired
const GUIDE = {
  INVALID_PACKAGE: [false, false, 'Fix the package against the version 1 schema and re-import.'],
  PATH_ESCAPE: [false, false, 'Use contained, non-hidden, non-symlink relative paths in the selected workspace.'],
  PATH_NOT_DIRECTORY: [false, false, 'A path component is not a directory; fix the package paths.'],
  PATH_NOT_REGULAR: [false, false, 'Target exists but is not a regular file.'],
  FILE_TOO_LARGE: [false, false, 'Target file exceeds the first-slice size bound.'],
  WORKSPACE_MISMATCH: [false, true, 'Select the workspace the package targets, or regenerate the package.'],
  WORKSPACE_BUSY: [true, false, 'Obtain/restore the exclusive host workspace lease and retry; do not steal another claim.'],
  BASE_REVISION_MISMATCH: [false, true, 'Regenerate or explicitly rebase/review the package against the current base.'],
  FILE_HASH_MISMATCH: [false, true, 'Refresh that file change against the current file; nothing was overwritten.'],
  WRITE_SCOPE_DENIED: [false, true, 'Write paths must exactly equal the changed paths; adjust package or scope.'],
  DEPENDENCY_PLAN_REQUIRED: [false, true, 'Provision/approve the dependency through a reviewed dependency plan; this slice installs nothing.'],
  UNDECLARED_DEPENDENCY: [false, true, 'Declare the dependency (exact version, already provisioned) or remove the import.'],
  RESTRICTED_IMPORT: [false, true, 'Unsupported import form/builtin in supplied code; remove it or use a host-reviewed recipe.'],
  DEPENDENCY_AUDIT_REQUIRED: [false, true, 'Reference a registered dependency-audit check.'],
  UNAPPROVED_RECIPE: [false, true, 'Reference a check id+version registered by the host.'],
  UNSUPPORTED_FILE_TYPE: [false, false, 'Only source/text file types are supported in this slice (no scripts, config or binaries).'],
  UNSUPPORTED_ARTIFACT: [false, false, 'First slice only returns a changed source-file artifact.'],
  ARTIFACT_MISMATCH: [false, false, 'Artifact hash does not match the supplied/produced content; no completion claim.'],
  APPROVAL_MISMATCH: [false, true, 'Preview the exact package content and approve that digest.'],
  APPROVAL_REQUIRED: [false, true, 'A server-issued approval bound to this review is required.'],
  APPROVAL_EXPIRED: [false, true, 'Re-run preview and approve again.'],
  VALIDATION_FAILED: [false, false, 'Inspect check evidence in the receipt; submit a corrected package. Do not bypass the check.'],
  POST_VALIDATION_DRIFT: [false, false, 'Source changed after apply (concurrent edit or mutating check); investigate before retrying.'],
  EVIDENCE_UNAVAILABLE: [true, false, 'Evidence store not writable; nothing was applied.'],
  ROLLBACK_INCOMPLETE: [false, false, 'Review unrestored paths and snapshot refs manually; later edits were not overwritten.'],
  CANCELLED: [false, false, 'Cancellation was requested and observed; see receipt.cancel for the stop point and disposition.'],
  APPROVAL_REPLAYED: [false, true, 'This approval was already used; preview and approve again.'],
  APPROVAL_FORGED: [false, true, 'Approval record failed integrity verification; discard it and approve again.'],
  APPROVAL_STALE: [false, true, 'Approval no longer matches the current workspace/base; preview and approve again.'],
  CONTROL_STORE_CORRUPT: [false, false, 'Durable control record is unreadable or fails integrity checks; operator review required.'],
  RECONCILIATION_REQUIRED: [false, false, 'An effect has unknown state after a crash; run reconciliation under a lease before any replay.'],
  RECOVERY_NOT_ALLOWED: [false, false, 'Recovery classification does not permit this operation; see classification reasons.'],
  LEASE_HELD: [true, false, 'Another holder has a valid lease; wait for release/expiry. Leases are never stolen.'],
  LEASE_LOST: [false, false, 'The lease is no longer valid for this holder; no further mutation is allowed.'],
  PAUSED: [true, false, 'Execution paused at a safe boundary; resume needs a valid lease and authority.'],
  CHECK_DRIFT: [false, true, 'A registered check changed (version/implementation digest/scope) after approval; review and approve again.'],
  ACTOR_INVALID: [false, false, 'Host session did not yield a valid authenticated actor.'],
  UNAUTHENTICATED: [false, false, 'No authenticated Commander session; sign in to War Room and retry.'],
  COMMANDER_REQUIRED: [false, true, 'The authenticated session is not the Commander; only the Commander may do this.'],
  SESSION_STALE: [false, false, 'The session expired, was revoked, or is too old; re-authenticate and retry.'],
  ACTOR_MISMATCH: [false, true, 'Approval belongs to a different actor; host policy does not permit transfer.'],
  AUTH_SOURCE_UNAVAILABLE: [true, false, 'The host session source did not yield usable session facts; failing closed.'],
  BUILD_NOT_CURRENT: [false, false, 'The build is not current for the present inputs (stale or requires rebuild); rebuild first.'],
  TOOL_DRIFT: [false, true, 'A host build/package recipe or script changed after it was registered/approved; review and approve again.'],
  STAGE_NOT_AUTHORIZED: [false, true, 'Host policy does not authorize this stage for this execution.'],
  OWNERSHIP_UNAVAILABLE: [true, false, 'Mission/assignment ownership could not be proven by the host; failing closed.'],
  OWNERSHIP_CHANGED: [false, true, 'Mission/assignment ownership (owner, workspace, task class, write scope) changed since approval; preview and approve again.'],
  MISSION_INACTIVE: [false, false, 'The mission does not currently authorize this operation (terminal, cancelling, paused or in another phase).'],
  WORKER_MISMATCH: [false, true, 'The requesting worker is not the assignment\'s owner agent.'],
  ROLE_DENIED: [false, true, 'The authenticated role is not permitted to perform this operation.'],
  SESSION_MISMATCH: [false, true, 'Approval belongs to a different session of the same actor; host policy does not permit transfer.'],
  MISSION_MISMATCH: [false, true, 'Package is bound to a different mission.'],
  ASSIGNMENT_MISMATCH: [false, true, 'Package is bound to a different assignment.'],
  ASSIGNMENT_INACTIVE: [false, true, 'The host does not consider this assignment active for the actor/workspace.'],
  BINDING_MISMATCH: [false, true, 'Execution context differs from the immutable binding recorded at import.'],
  BROKER_STATE: [false, false, 'Operation is not valid in the execution\'s current state.'],
  BROKER_STOPPED: [true, false, 'The broker is stopped and takes no new work until started.'],
  HOLDER_DEATH_REQUIRED: [true, true, 'The previous lease is still valid; wait for expiry or have a Commander assert the holder is dead.'],
  DUPLICATE_REQUEST_IN_PROGRESS: [true, false, 'A request with this id is already in progress.'],
  EXECUTION_FAILED: [false, false, 'Review the receipt; submit a corrected package.'],
}
export class BlueprintError extends Error {
  constructor(code, stage, message, detail = {}) { super(message); Object.assign(this, { code, stage, ...detail }) }
  toJSON() { return describeError(this) }
}
export const refuse = (code, stage, message, detail) => { throw new BlueprintError(code, stage, message, detail) }
export function describeError(e, ctx = {}) {
  const known = e instanceof BlueprintError
  const code = known ? e.code : 'EXECUTION_FAILED'
  const [retryable, approvalRequired, nextAction] = GUIDE[code] ?? GUIDE.EXECUTION_FAILED
  return {
    code, stage: e.stage ?? ctx.stage ?? 'unknown', packageId: e.packageId ?? ctx.packageId ?? null,
    stepId: e.stepId ?? (e.path ? `change:${e.path}` : null), path: e.path ?? null,
    expected: e.expected ?? null, observed: e.observed ?? null, checkId: e.checkId ?? null,
    // Raw fs/system error text can contain host paths; only BlueprintError messages are shown verbatim.
    message: known ? e.message : `Unexpected failure${e?.code ? ` (${String(e.code).slice(0, 20)})` : ''}`,
    evidenceRef: ctx.evidenceRef ?? e.evidenceRef ?? null, retryable, nextAction, approvalRequired,
  }
}


/** Atomic replace with fsync: temp file in the same directory, fsync, rename. */
export const atomicWrite = (file, bytes, mode) => {
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    const fd = fs.openSync(temp, 'wx', mode)
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    fs.renameSync(temp, file)
  } finally { try { fs.unlinkSync(temp) } catch { /* already renamed */ } }
}
/** Atomic exclusive create WITH content (link fails with EEXIST): returns false if the file already exists. */
export const createExclusive = (file, bytes, mode = 0o600) => {
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    const fd = fs.openSync(temp, 'wx', mode)
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    try { fs.linkSync(temp, file); return true } catch (e) { if (e.code === 'EEXIST') return false; throw e }
  } finally { try { fs.unlinkSync(temp) } catch { /* gone */ } }
}
export const readJson = file => {
  let text
  try { text = fs.readFileSync(file, 'utf8') } catch (e) { if (e.code === 'ENOENT') return null; throw new BlueprintError('CONTROL_STORE_CORRUPT', 'control', 'Control record unreadable') }
  try { return JSON.parse(text) } catch { throw new BlueprintError('CONTROL_STORE_CORRUPT', 'control', 'Control record is not valid JSON') }
}
/** Binding of the registered checks an approval covers: id, version, implementation digest (when the host has one), role, scope. */
/** Binds EVERYTHING that defines a check: id, version, implementation digest, role, scope, DECLARED timeout and cancellation support. */
export const checkBindingOf = (lookup, checks) => hash(canonical(checks.map(c => { const e = lookup(c.id); return [c.id, c.version, e?.digest ?? null, e?.role ?? null, e?.scope ?? null, e ? (e.timeoutDeclared !== undefined ? e.timeoutDeclared : e.timeoutMs ?? null) : null, e ? e.cancellable === true : null] })))
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export { path }
