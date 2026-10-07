/** Phase 9 outcome-event boundary (isolated). Defines the event the broker WILL emit to War Room Phase 9; nothing here writes to
 * live Phase 9 storage. A sink is any object with emit(event); delivery is at-least-once via the broker outbox, deduplicated by eventId. */
import { BlueprintError, canonical, hash } from './base.mjs'
import { deriveClaims } from './stages.mjs'

export const PHASE9_SCHEMA_VERSION = 2 // v2 adds per-stage results + dependency plan (additive over v1)
const CLASS = [
  ['STALE_STATE', ['FILE_HASH_MISMATCH', 'BASE_REVISION_MISMATCH', 'APPROVAL_STALE', 'WORKSPACE_MISMATCH', 'POST_VALIDATION_DRIFT', 'SOURCE_CHANGED', 'SOURCE_CHANGED_DURING_STAGE', 'BASE_CHANGED', 'BUILD_OUTPUT_DRIFT']],
  ['POLICY_VIOLATION', ['PATH_ESCAPE', 'PATH_NOT_DIRECTORY', 'PATH_NOT_REGULAR', 'RESTRICTED_IMPORT', 'UNDECLARED_DEPENDENCY', 'DEPENDENCY_PLAN_REQUIRED', 'DEPENDENCY_AUDIT_REQUIRED', 'UNSUPPORTED_FILE_TYPE', 'UNSUPPORTED_ARTIFACT', 'WRITE_SCOPE_DENIED', 'INVALID_PACKAGE', 'UNAPPROVED_RECIPE']],
  ['VALIDATION', ['VALIDATION_FAILED', 'ARTIFACT_MISMATCH', 'BUILD_FAILED', 'BUILD_OUTPUT_MISSING', 'PACKAGE_FAILED', 'PACKAGE_OUTPUT_MISSING', 'STAGE_TIMEOUT', 'ARTIFACT_HASH_MISMATCH', 'ARTIFACT_SIZE_MISMATCH', 'ARTIFACT_MISSING', 'ARTIFACT_NOT_REGULAR', 'ARTIFACT_ESCAPE', 'MANIFEST_TAMPERED', 'BIND_MISMATCH', 'TOOL_UNAVAILABLE']],
  ['CANCELLED', ['CANCELLED']],
  ['LEASE', ['LEASE_LOST', 'LEASE_HELD', 'WORKSPACE_BUSY', 'HOLDER_DEATH_REQUIRED']],
  ['AUTHORITY', ['CHECK_DRIFT', 'APPROVAL_REQUIRED', 'APPROVAL_FORGED', 'APPROVAL_EXPIRED', 'APPROVAL_REPLAYED', 'APPROVAL_MISMATCH', 'ROLE_DENIED', 'TOOL_DRIFT', 'STAGE_NOT_AUTHORIZED', 'HOST_AUTHORITY_STOPPED', 'OWNERSHIP_UNAVAILABLE', 'OWNERSHIP_CHANGED', 'MISSION_INACTIVE', 'WORKER_MISMATCH', 'SESSION_MISMATCH', 'ACTOR_MISMATCH', 'UNAUTHENTICATED', 'COMMANDER_REQUIRED', 'SESSION_STALE', 'AUTH_SOURCE_UNAVAILABLE', 'MISSION_MISMATCH', 'ASSIGNMENT_MISMATCH', 'ASSIGNMENT_INACTIVE', 'BINDING_MISMATCH']],
  ['CRASH', ['INTERRUPTED_RUN']],
  ['INFRASTRUCTURE', ['EVIDENCE_UNAVAILABLE', 'CONTROL_STORE_CORRUPT', 'ROLLBACK_INCOMPLETE', 'RECONCILIATION_REQUIRED', 'RECOVERY_NOT_ALLOWED']],
]
export const failureClassOf = code => CLASS.find(([, codes]) => codes.includes(code))?.[0] ?? 'EXECUTION'
const HEADLINE = { VERIFIED_SOURCE: 'SOURCE_VERIFIED_ONLY', FAILED_ROLLED_BACK: 'FAILED_ROLLED_BACK', BLOCKED: 'BLOCKED', ROLLBACK_INCOMPLETE: 'ROLLBACK_INCOMPLETE', RECOVERED_ROLLED_BACK: 'FAILED_ROLLED_BACK', PAUSED: 'PAUSED' }
const headlineOf = status => HEADLINE[status] ?? (String(status).startsWith('CANCELLED') ? 'CANCELLED' : 'UNKNOWN')

/** claims are forced false for everything beyond source validation: this slice never builds/packages/installs. */
/** `exec.stages` carries compact recorded stage facts; claims are DERIVED from them (never asserted by a stage). */
export function buildOutcomeEvent({ exec, receipt, outcome, recoveries = 0, emittedAt }) {
  const events = receipt?.events ?? [], t0 = Date.parse(events[0]?.at ?? ''), t1 = Date.parse(events.at(-1)?.at ?? '')
  const st = exec.stages ?? {}, sv = receipt?.claims?.sourceValidated === true && outcome === 'VERIFIED_SOURCE' && st.validateSource?.status === 'PASS'
  const compact = n => { const x = st[n]; return x ? { status: x.status, attempt: x.attempt ?? null, failureCode: x.failureCode ?? null, toolIdentity: x.toolIdentity ?? null, toolVersion: x.toolVersion ?? null, manifestDigest: x.manifestDigest ?? null, artifactCount: x.artifactCount ?? 0, latencyMs: x.latencyMs ?? null } : { status: 'NOT_RUN' } }
  const stages = { validateSource: compact('validateSource'), build: compact('build'), package: compact('package'), verifyArtifact: { ...compact('verifyArtifact'), builtVerified: st.verifyArtifact?.builtVerified ?? null, packagedVerified: st.verifyArtifact?.packagedVerified ?? null } }
  const dp = exec.dependencyPlan ? { status: exec.dependencyPlan.status, digest: exec.dependencyPlan.digest, count: exec.dependencyPlan.count ?? 0, blockedCount: exec.dependencyPlan.blockedCount ?? 0, manifestChange: exec.dependencyPlan.manifestChange === true, lockfileChange: exec.dependencyPlan.lockfileChange === true } : { status: 'NOT_EVALUATED' }
  const stageSig = ['build', 'package', 'verifyArtifact'].some(n => st[n]) ? hash(canonical({ stages, lineage: exec.lineage ?? null })).slice(0, 12) : ''
  const eventId = hash(`${exec.execId}|${receipt?.runId ?? ''}|${outcome}|${recoveries}|${stageSig}`).slice(0, 32)
  return {
    schemaVersion: PHASE9_SCHEMA_VERSION, eventType: 'blueprint.execution.outcome', eventId, emittedAt: new Date(emittedAt).toISOString(),
    package: { id: exec.binding.packageId, digest: exec.normalizedHash, rawHash: exec.rawHash },
    mission: { missionId: exec.binding.missionId, assignmentId: exec.binding.assignmentId, requestingSubsystem: exec.binding.requestingSubsystem },
    workspaceId: exec.binding.workspaceId, execId: exec.execId, runId: receipt?.runId ?? null,
    outcome, headline: headlineOf(outcome),
    claims: deriveClaims({ sourceValidated: sv, stages: st }), stages, dependencyPlan: dp, lineage: exec.lineage ? { buildInputDigest: exec.lineage.buildInputDigest ?? null, dependencyResult: exec.lineage.dependencyResult ?? null, cancellation: exec.lineage.cancellation ?? { state: 'NONE' }, interruption: exec.lineage.interruption ?? [], retry: exec.lineage.retry ?? null, invalidation: exec.lineage.invalidation ?? null, current: exec.lineage.current ?? null, provenance: exec.lineage.provenance ?? 'NOT_VERIFIED' } : null, scopeLabel: exec.lineage?.scopeLabel ?? 'SOURCE_ONLY',
    rollback: receipt?.rollback ? { attempted: receipt.rollback.attempted ?? 0, errors: receipt.rollback.errors?.length ?? 0, preserved: receipt.rollback.preserved?.length ?? 0, retained: receipt.rollback.retained?.length ?? 0 } : null,
    validation: (receipt?.checks ?? []).map(c => ({ id: c.id, version: c.version, status: c.status, implementationDigest: c.implementationDigest ?? null })),
    failure: receipt?.error ? { class: failureClassOf(receipt.error.code), code: receipt.error.code, stage: receipt.error.stage, path: receipt.error.path ?? null, checkId: receipt.error.checkId ?? null } : null,
    latencyMs: Number.isFinite(t0) && Number.isFinite(t1) ? Math.max(0, t1 - t0) : null,
    retries: { resumes: receipt?.resumes ?? 0, recoveries },
    actor: { actorId: (exec.executedBy ?? exec.requestedBy).actorId, role: (exec.executedBy ?? exec.requestedBy).role, sessionId: (exec.executedBy ?? exec.requestedBy).sessionId }, // who triggered the run (not who imported/approved)
    approvedBy: exec.approval ? { actorId: exec.approval.approvedBy.actorId, role: exec.approval.approvedBy.role, sessionId: exec.approval.approvedBy.sessionId } : null,
    provenance: { sourceKind: receipt?.recipe?.sourceKind ?? 'manual-package-import', recipeId: receipt?.recipe?.id ?? null, recipeVersion: receipt?.recipe?.version ?? null, provenanceClaimVerified: false, researchRefCount: receipt?.recipe?.researchRefs?.length ?? 0, externalAssistance: null },
  }
}
const KEYS = ['schemaVersion', 'eventType', 'eventId', 'emittedAt', 'package', 'mission', 'workspaceId', 'execId', 'runId', 'outcome', 'headline', 'claims', 'stages', 'dependencyPlan', 'lineage', 'scopeLabel', 'rollback', 'validation', 'failure', 'latencyMs', 'retries', 'actor', 'approvedBy', 'provenance']
export function validateOutcomeEvent(ev) {
  const bad = why => { throw new BlueprintError('INVALID_PACKAGE', 'phase9', `Invalid Phase 9 event (${why})`) }
  if (!ev || typeof ev !== 'object') bad('shape')
  for (const k of KEYS) if (!(k in ev)) bad(`missing ${k}`)
  for (const k of Object.keys(ev)) if (!KEYS.includes(k)) bad(`unexpected ${k}`)
  if (ev.schemaVersion !== PHASE9_SCHEMA_VERSION || ev.eventType !== 'blueprint.execution.outcome') bad('version/type')
  const c = ev.claims, S = ev.stages ?? {}
  if (c.installed || c.taskComplete || c.missionComplete || c.assignmentComplete) bad('claims beyond source validation')
  if (c.built && !(c.sourceValidated && S.build?.status === 'PASS')) bad('built claimed without validated source and a PASS build stage')
  if (c.packaged && !(c.built && S.package?.status === 'PASS' && S.verifyArtifact?.status === 'PASS' && S.verifyArtifact?.packagedVerified === true)) bad('packaged claimed without built, a PASS package stage and PASS artifact verification')
  if (ev.provenance.provenanceClaimVerified !== false) bad('provenance')
  const scan = o => { for (const [k, v] of Object.entries(o ?? {})) { if (/token|password|cookie|secret|authorization|credential/i.test(k)) bad('credential-like field'); if (v && typeof v === 'object') scan(v) } }
  scan(ev)
  return ev
}
/** Isolated test sink. Idempotent by eventId (at-least-once delivery upstream). */
export function createMemorySink({ failNext = 0 } = {}) {
  const state = { events: [], duplicates: 0, failNext }
  return { state, emit(ev) { if (state.failNext > 0) { state.failNext--; throw new Error('sink unavailable') } if (state.events.some(e => e.eventId === ev.eventId)) { state.duplicates++; return } state.events.push(structuredClone(validateOutcomeEvent(ev))) } }
}
