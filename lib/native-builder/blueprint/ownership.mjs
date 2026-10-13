/** Mission + assignment OWNERSHIP seam (isolated, READ-ONLY toward live War Room). Imports nothing from live.
 *
 * Live authority (read only; paths under lib/):
 *  - Foundry mission  = native-builder/foundryMissionTypes.ts FoundryMissionRecord {missionId, status (FOUNDRY_MISSION_STATES), kind, cancelRequested, pauseRequested, controlRevision,
 *    owner?(free text), workspaceBinding{workspaceId, workspaceRoot}, writeSet{established, paths[]}, updatedAt}; loaded by foundryMissionStore.loadMission; the ONLY lifecycle
 *    authority is foundryMissionStore.transitionMission (LEGAL_TRANSITIONS; COMPLETE/FAILED trigger Phase 9 ingestion).
 *  - Agent Ops assignment = agents/ops/engineering/assignments.ts deriveAssignments(log) -> AssignmentView {assignment{id, agentId, parentMission{id,title}, taskClass,
 *    workspace{id,root,kind}|null, tools, createdBy, createdAt}, state (QUEUED|RUNNING|PAUSED|BLOCKED|CANCEL_REQUESTED|STOPPING|COMPLETED|FAILED|CANCELLED|HANDED_OFF|INTERRUPTED)};
 *    executionGate() proceeds only when RUNNING and the agent is ACTIVE; recoverInterruptedAssignments() flips stale live assignments to INTERRUPTED.
 *  - Write scope lives on the MISSION (writeSet.paths, exact posix-path equality, expandable via requestWriteSetExpansion); the ASSIGNMENT has only the `write_workspace` tool + a workspace.
 *  - Live proves: owner agent (assignment.agentId). It does NOT prove: a worker bound to the assignment (RunRecord links workerId/agentId but not assignmentId), that
 *    assignment.parentMission.id is a real mission, or that assignment.workspace equals mission.workspaceBinding. => workerId stays UNKNOWN; linkage is verified here. */
import { canonical, hash } from './base.mjs'

export const UNKNOWN = 'UNKNOWN'
export const ASSIGNMENT_STATES = Object.freeze(['QUEUED', 'RUNNING', 'PAUSED', 'BLOCKED', 'CANCEL_REQUESTED', 'STOPPING', 'COMPLETED', 'FAILED', 'CANCELLED', 'HANDED_OFF', 'INTERRUPTED'])
export const ASSIGNMENT_TERMINAL = Object.freeze(['COMPLETED', 'FAILED', 'CANCELLED', 'HANDED_OFF', 'INTERRUPTED'])
export const MISSION_STATES = Object.freeze(['QUEUED', 'UNDERSTANDING', 'INSPECTING', 'PLANNING', 'EXECUTING', 'VALIDATING', 'BUILDING', 'PACKAGING', 'INSTALLING', 'VERIFYING', 'REPLANNING', 'PAUSED', 'WAITING_AUTHORIZATION', 'WAITING_RESOURCE', 'ACTIVATION_PENDING', 'RECOVERING', 'BLOCKED', 'COMPLETE', 'FAILED', 'CANCELLED'])
export const MISSION_TERMINAL = Object.freeze(['COMPLETE', 'FAILED', 'CANCELLED'])
const COMMANDER = /^commander:[A-Za-z0-9._-]{1,64}$/, SYSTEM = /^system:[A-Za-z0-9._-]{1,64}$/

// ------------------------------------------------------------------ write-path classification (mirrors live classifyWriteRefusal; STRICTER: Terra is never allowed)
const TERRA_PATH = /(^|\/)(components\/war-room\/terra|lib\/terra|public\/terra)(\/|$)/i
const TERRA_FILE = /FoundryTerraBackground\.tsx$|cesium|gibs|imageryLifecycle|loadCesiumRuntime/i
const VENDOR_PATH = /(^|\/)(node_modules|\.next|dist|dist-release|coverage|vendor)(\/|$)/
const TRAVERSAL = /(?:^|\/)\.\.(?:\/|$)/
export const posixRel = rel => String(rel).replace(/\\/g, '/').replace(/^\.\/+/, '')
export function classifyWritePath(rel) {
  const p = posixRel(rel)
  if (!p || TRAVERSAL.test(p) || p.startsWith('/') || /^[A-Za-z]:/.test(p)) return { ok: false, code: 'REFUSED_OUTSIDE_WRITE_SET', path: p }
  if (VENDOR_PATH.test(p)) return { ok: false, code: 'REFUSED_OUTSIDE_WRITE_SET', path: p }
  if (TERRA_PATH.test(p) || TERRA_FILE.test(p) || (/\/cesium\//i.test(p) && /terra|imagery|globe/i.test(p)) || /(^|\/)(lib\/wrim-environment|wrim-environment)(\/|$)/i.test(p)) return { ok: false, code: 'REFUSED_PROTECTED_SUBSYSTEM', path: p }
  return { ok: true, path: p }
}

// ------------------------------------------------------------------ normalized ownership facts
const ID = /^[\w.:@/-]{1,200}$/
const s = (v, re = ID) => (typeof v === 'string' && re.test(v) ? v : UNKNOWN)
const OWN_KEYS = ['missionId', 'assignmentId', 'workspaceId', 'workspaceRoot', 'ownerType', 'ownerId', 'workerId', 'taskClass', 'missionKind', 'missionState', 'assignmentState', 'ownerState', 'cancelRequested', 'pauseRequested', 'writeCapable', 'writeGrantedBy', 'writeScope', 'missionRevision', 'assignmentCreatedAt', 'updatedAt', 'linkage']
/** Strict: only these keys, every one validated; absent/invalid => UNKNOWN (never invented). `complete` is RECOMPUTED. */
export function normalizeOwnership(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(k => !OWN_KEYS.includes(k) && k !== 'complete')) return null
  const ws = raw.writeScope && typeof raw.writeScope === 'object' ? raw.writeScope : {}
  const paths = Array.isArray(ws.paths) && ws.paths.every(p => typeof p === 'string') ? [...new Set(ws.paths.map(posixRel))].sort() : null
  const clean = paths && paths.every(p => classifyWritePath(p).ok) ? paths : null // a scope containing a refused path is not a usable scope
  const writeScope = Object.freeze({ established: ws.established === true && clean !== null, paths: Object.freeze(clean ?? []), digest: hash(canonical({ established: ws.established === true && clean !== null, paths: clean ?? [] })) })
  const o = {
    missionId: s(raw.missionId), assignmentId: s(raw.assignmentId), workspaceId: s(raw.workspaceId), workspaceRoot: s(raw.workspaceRoot, /^\/[^\0]{0,4000}$/), ownerType: raw.ownerType === 'agent' ? 'agent' : UNKNOWN, ownerId: s(raw.ownerId),
    workerId: s(raw.workerId), taskClass: s(raw.taskClass, /^[\w.-]{1,100}$/), missionKind: ['fixture', 'application', 'app_builder'].includes(raw.missionKind) ? raw.missionKind : UNKNOWN,
    missionState: MISSION_STATES.includes(raw.missionState) ? raw.missionState : UNKNOWN, assignmentState: ASSIGNMENT_STATES.includes(raw.assignmentState) ? raw.assignmentState : UNKNOWN, ownerState: s(raw.ownerState, /^[A-Z_]{1,40}$/),
    cancelRequested: raw.cancelRequested === true, pauseRequested: raw.pauseRequested === true, writeCapable: raw.writeCapable === true, writeGrantedBy: ['commander', 'system'].includes(raw.writeGrantedBy) ? raw.writeGrantedBy : UNKNOWN,
    writeScope, missionRevision: Number.isInteger(raw.missionRevision) ? raw.missionRevision : UNKNOWN, assignmentCreatedAt: s(raw.assignmentCreatedAt, /^[\w:.+-]{10,40}$/), updatedAt: s(raw.updatedAt, /^[\w:.+-]{10,40}$/),
    linkage: raw.linkage === 'OK' ? 'OK' : 'MISMATCH',
  }
  const must = ['missionId', 'assignmentId', 'workspaceId', 'workspaceRoot', 'ownerId', 'taskClass', 'missionState', 'assignmentState', 'missionKind']
  return Object.freeze({ ...o, complete: must.every(k => o[k] !== UNKNOWN) && o.ownerType === 'agent' && o.linkage === 'OK' })
}
/** Identity of WHO owns the work and WHAT it may touch, excluding lifecycle state (which legitimately changes): used to detect rebinding after approval. */
export const ownershipDigestOf = (f, effectiveScopeDigest) => `own1:${hash(canonical({ missionId: f.missionId, assignmentId: f.assignmentId, workspaceId: f.workspaceId, workspaceRoot: f.workspaceRoot, ownerType: f.ownerType, ownerId: f.ownerId, workerId: f.workerId, taskClass: f.taskClass, missionKind: f.missionKind, writeCapable: f.writeCapable, writeGrantedBy: f.writeGrantedBy, assignmentCreatedAt: f.assignmentCreatedAt, effectiveScopeDigest }))}`

// ------------------------------------------------------------------ lifecycle authorization map
export const OPS = Object.freeze(['import', 'approve', 'execute', 'resume', 'pause', 'cancel', 'restore', 'reconcile'])
const A_OK = {
  import: ['QUEUED', 'RUNNING', 'PAUSED', 'BLOCKED'], approve: ['QUEUED', 'RUNNING'], execute: ['RUNNING'], resume: ['RUNNING'],
  pause: ['RUNNING', 'PAUSED', 'BLOCKED'], cancel: ['QUEUED', 'RUNNING', 'PAUSED', 'BLOCKED', 'CANCEL_REQUESTED', 'STOPPING'], restore: ASSIGNMENT_STATES, reconcile: ASSIGNMENT_STATES,
}
const M_OK = {
  import: MISSION_STATES.filter(x => !MISSION_TERMINAL.includes(x)), approve: ['PLANNING', 'EXECUTING', 'REPLANNING', 'WAITING_AUTHORIZATION'], execute: ['EXECUTING'], resume: ['EXECUTING'],
  pause: MISSION_STATES.filter(x => !MISSION_TERMINAL.includes(x)), cancel: MISSION_STATES.filter(x => !MISSION_TERMINAL.includes(x)), restore: MISSION_STATES, reconcile: MISSION_STATES,
}
/** restore/reconcile (cleanup of ALREADY-applied work, Commander + lease) stay possible in terminal states; every op that starts or continues package work needs a live, writable owner. */
export function lifecyclePermits(op, f) {
  if (!f?.complete) return { ok: false, code: 'OWNERSHIP_UNAVAILABLE', reason: 'ownership facts unproven' }
  if (!OPS.includes(op)) return { ok: false, code: 'OWNERSHIP_UNAVAILABLE', reason: 'unknown operation' }
  const work = !['restore', 'reconcile'].includes(op)
  if (f.missionKind === 'app_builder' && work) return { ok: false, code: 'WRITE_SCOPE_DENIED', reason: 'application-builder missions are out of scope for blueprint execution' }
  if (work && (f.cancelRequested || (MISSION_TERMINAL.includes(f.missionState)))) return { ok: false, code: 'MISSION_INACTIVE', reason: `mission ${f.cancelRequested ? 'cancel requested' : f.missionState}` }
  if (!M_OK[op].includes(f.missionState)) return { ok: false, code: 'MISSION_INACTIVE', reason: `mission state ${f.missionState} does not permit ${op}` }
  if (['execute', 'resume', 'approve'].includes(op) && f.pauseRequested) return { ok: false, code: 'MISSION_INACTIVE', reason: 'mission pause requested' }
  if (!A_OK[op].includes(f.assignmentState)) return { ok: false, code: 'ASSIGNMENT_INACTIVE', reason: `assignment state ${f.assignmentState} does not permit ${op}` }
  if (['execute', 'resume'].includes(op) && f.ownerState !== 'ACTIVE') return { ok: false, code: 'ASSIGNMENT_INACTIVE', reason: 'owner agent is not ACTIVE' }
  if (work && ['import', 'approve', 'execute', 'resume'].includes(op) && !(f.writeCapable && f.writeGrantedBy === 'commander')) return { ok: false, code: 'WRITE_SCOPE_DENIED', reason: 'assignment does not hold a Commander-granted write_workspace tool' }
  return { ok: true }
}

// ------------------------------------------------------------------ write-scope intersection
/** package writePaths ⊆ mission write set (exact posix equality, like live) ∩ workspace; package changes ⊆ writePaths. The effective scope is the PACKAGE's change paths:
 * a broader mission scope never widens the package, a narrower one rejects it. An unestablished scope is REFUSED (live would allow everything: not safe). */
export function authorizePackageScope(f, { writePaths, changePaths }) {
  const deny = (reason, path) => ({ ok: false, code: 'WRITE_SCOPE_DENIED', reason, path })
  if (!f?.complete) return { ok: false, code: 'OWNERSHIP_UNAVAILABLE', reason: 'ownership facts unproven' }
  if (!f.writeScope.established) return deny('mission write set is not established')
  const scope = new Set(f.writeScope.paths), wp = [...new Set(writePaths.map(posixRel))].sort(), cp = [...new Set(changePaths.map(posixRel))].sort()
  for (const p of [...wp, ...cp]) { const c = classifyWritePath(p); if (!c.ok) return deny(`${c.code}`, p) }
  for (const p of wp) if (!scope.has(p)) return deny('package asks for a path outside the authorized write scope', p)
  for (const p of cp) if (!scope.has(p) || !wp.includes(p)) return deny('change outside the authorized write scope', p)
  return { ok: true, effectivePaths: cp, effectiveScopeDigest: hash(canonical(cp)) }
}

// ------------------------------------------------------------------ read-only mission bridge
/** readMission(missionId) -> live-shaped mission record|null; readAssignment(id) -> live-shaped AssignmentView|null; readAgent(agentId) -> {state}|null. All sync, host supplied
 * (live routes pre-load snapshots with await). Only whitelisted fields are copied; free text (objective, title, constraints, userRequest) never crosses. NO mutators exist. */
export function createMissionOwnershipBridge({ readMission, readAssignment, readAgent = () => null }) {
  if (typeof readMission !== 'function' || typeof readAssignment !== 'function') throw new Error('readMission and readAssignment are required')
  const resolve = ({ missionId, assignmentId } = {}) => {
    let m = null, v = null, ag = null
    try { m = readMission(missionId); v = readAssignment(assignmentId) } catch { return null }
    if (!m || !v?.assignment) return null
    try { ag = readAgent(v.assignment.agentId) } catch { ag = null }
    const a = v.assignment, wb = m.workspaceBinding ?? null, createdBy = String(a.createdBy ?? '')
    const linked = a.id === assignmentId && m.missionId === missionId && a.parentMission?.id === missionId && !!wb && !!a.workspace && a.workspace.id === wb.workspaceId && a.workspace.root === wb.workspaceRoot
    return {
      missionId: m.missionId, assignmentId: a.id, workspaceId: wb?.workspaceId, workspaceRoot: wb?.workspaceRoot, ownerType: typeof a.agentId === 'string' && a.agentId ? 'agent' : UNKNOWN, ownerId: a.agentId, workerId: UNKNOWN,
      taskClass: a.taskClass, missionKind: m.kind, missionState: m.status, assignmentState: v.state, ownerState: ag?.state, cancelRequested: m.cancelRequested === true, pauseRequested: m.pauseRequested === true,
      writeCapable: Array.isArray(a.tools) && a.tools.includes('write_workspace'), writeGrantedBy: COMMANDER.test(createdBy) ? 'commander' : SYSTEM.test(createdBy) ? 'system' : UNKNOWN,
      writeScope: { established: m.writeSet?.established === true, paths: Array.isArray(m.writeSet?.paths) ? m.writeSet.paths : [] }, missionRevision: m.controlRevision, assignmentCreatedAt: a.createdAt, updatedAt: m.updatedAt, linkage: linked ? 'OK' : 'MISMATCH',
    }
  }
  return Object.freeze({ resolve, verifyAssignment: b => { const f = normalizeOwnership(resolve(b)); return !!f?.complete && f.workspaceId === b.workspaceId } })
}
