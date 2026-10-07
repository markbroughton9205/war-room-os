/**
 * HTTP layer for the Commander blueprint routes (app/api/foundry/blueprints/**). Every handler:
 *   1. requires the Commander gate AND credential-free facts from the SAME verified session (no gate/facts pair mismatch),
 *   2. for mutating verbs additionally requires the CSRF header + local origin check,
 *   3. admits a request-scoped actor handle into the isolated broker (the broker never sees cookies/tokens),
 *   4. returns scrubbed, contract-shaped errors (no raw errors, paths or credentials).
 * Nothing here advances a mission or assignment, installs anything, or reaches the network.
 */
import { NextResponse } from 'next/server'
import { requireCommanderSessionFacts } from '@/lib/security/commanderSession'
import { assertLocalMutationOrigin } from '@/lib/sovereign-runtime/local-ownership/gate'
import { BlueprintError, describeError } from './base.mjs'
import { holderIdFor } from './reslock.mjs'
import { normalizeOwnership } from './ownership.mjs'
import { describeDependencies } from './liveDependencies'
import { BLUEPRINT_BROKER_ID, getBlueprintRuntime, type BlueprintRuntime } from './liveRuntime'
import { refreshBlueprintWorkspace, resolveBlueprintWorkspaceSync, snapshotOf, liveBaseIdentity } from './liveWorkspaces'

export const CSRF_HEADER = 'x-wr-blueprints'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const MAX_BODY_BYTES = 300_000
export const REQUESTING_SUBSYSTEM = 'foundry-blueprints'

type Ctx4 = { missionId: string; assignmentId: string; workspaceId: string; requestingSubsystem: string }
type Actor = { rt: BlueprintRuntime; handle: string; userId: string; sessionId: string }

const STATUS_BY_CODE: Record<string, number> = {
  UNAUTHENTICATED: 401, SESSION_STALE: 401, COMMANDER_REQUIRED: 403, ROLE_DENIED: 403, AUTH_SOURCE_UNAVAILABLE: 503, ACTOR_INVALID: 401,
  INVALID_PACKAGE: 400, UNSUPPORTED_FILE_TYPE: 400, UNSUPPORTED_ARTIFACT: 400, RESTRICTED_IMPORT: 400, UNDECLARED_DEPENDENCY: 400, UNAPPROVED_RECIPE: 400, PATH_ESCAPE: 400,
  WRITE_SCOPE_DENIED: 403, OWNERSHIP_UNAVAILABLE: 503, EVIDENCE_UNAVAILABLE: 404, CONTROL_STORE_CORRUPT: 500,
}
export const httpStatusFor = (code: string): number => STATUS_BY_CODE[code] ?? 409

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof BlueprintError) return NextResponse.json({ error: describeError(e) }, { status: httpStatusFor(e.code) })
  if (e && typeof e === 'object' && (e as { code?: string }).code === 'HTTP') { const x = e as { status: number; message: string; errCode: string }; return NextResponse.json({ error: { code: x.errCode, message: x.message } }, { status: x.status }) }
  return NextResponse.json({ error: { code: 'EXECUTION_FAILED', message: 'Unexpected failure', nextAction: 'Operator review required.' } }, { status: 500 })
}
const http = (status: number, errCode: string, message: string) => Object.assign(new Error(message), { code: 'HTTP', status, errCode })

function mutationGuard(req: Request): NextResponse | null {
  if (req.headers.get(CSRF_HEADER) !== '1') return NextResponse.json({ error: { code: 'CSRF_HEADER_REQUIRED', message: `Missing ${CSRF_HEADER} control header.` } }, { status: 400 })
  const o = assertLocalMutationOrigin({ method: req.method, origin: req.headers.get('origin'), referer: req.headers.get('referer'), host: req.headers.get('host') })
  if (!o.ok) return NextResponse.json({ error: { code: o.code, message: o.reason } }, { status: 403 })
  return null
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const len = Number(req.headers.get('content-length') ?? 0)
  if (len > MAX_BODY_BYTES) throw http(413, 'BODY_TOO_LARGE', 'Request body too large.')
  let raw: unknown
  try { raw = await req.json() } catch { throw http(400, 'INVALID_JSON', 'Invalid JSON body.') }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw http(400, 'INVALID_JSON', 'Body must be a JSON object.')
  return raw as Record<string, unknown>
}

/** Commander gate + same-session facts -> request-scoped broker actor handle. */
async function withActor(req: Request, mutating: boolean, fn: (a: Actor) => Promise<unknown> | unknown, okStatus = 200): Promise<Response> {
  if (mutating) { const g = mutationGuard(req); if (g) return g }
  const gate = await requireCommanderSessionFacts('Blueprint')
  if (!gate.ok) return gate.response
  if (!gate.facts) return NextResponse.json({ error: { code: 'AUTH_SOURCE_UNAVAILABLE', message: 'Blueprint authority needs a local Commander session with session facts.' } }, { status: 503 })
  const rt = getBlueprintRuntime()
  let handle: string
  try { handle = rt.bridge.admit({ ok: true, userId: gate.userId }, { sessionId: gate.facts.sessionId, authenticatedAt: gate.facts.authenticatedAt, expiresAt: gate.facts.expiresAt, source: gate.facts.source }) } catch (e) { return errorResponse(e) }
  try {
    try { rt.broker.flushOutbox(handle) } catch { /* Phase 9 redelivery is best effort here; events stay pending in the durable outbox */ }
    const out = await fn({ rt, handle, userId: gate.userId, sessionId: gate.facts.sessionId })
    return NextResponse.json(out, { status: okStatus })
  } catch (e) { return errorResponse(e) } finally { rt.bridge.close(handle) }
}

const needId = (id: string): string => { if (!UUID.test(id)) throw http(400, 'INVALID_ID', 'Invalid blueprint id.'); return id }

/** The four-key execution context recorded at import; also refreshes the validated workspace snapshot the synchronous broker adapters rely on. */
async function ctxFor(a: Actor, execId: string): Promise<Ctx4> {
  const row = (a.rt.broker.list(a.handle) as { execId: string; binding?: Ctx4 }[]).find(r => r.execId === execId)
  if (!row?.binding) throw http(404, 'NOT_FOUND', 'Unknown blueprint.')
  const ws = await refreshBlueprintWorkspace(row.binding.workspaceId)
  if (!ws.ok) throw new BlueprintError('WORKSPACE_MISMATCH', 'workspace', `Workspace unavailable (${ws.code})`)
  const { missionId, assignmentId, workspaceId, requestingSubsystem } = row.binding
  return { missionId, assignmentId, workspaceId, requestingSubsystem }
}

const strField = (b: Record<string, unknown>, k: string, max = 200): string => {
  const v = b[k]
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw http(400, 'INVALID_FIELD', `Field ${k} is required.`)
  return v.trim()
}

/** The core's preview text claims "source validation only"; with a pipeline the truthful statement is stage-specific. */
function truthfulLimits(rt: BlueprintRuntime): string {
  return `Source validation, dependency verification and host-owned build/package stages (${rt.kit.pipeline.authorized().join(', ')}) only. Install, deployment, mission completion and assignment completion are NOT performed or claimed; installed acceptance is separate.`
}

// ------------------------------------------------------------------ authority snapshot (what the Commander is being asked to trust, honestly including UNKNOWN)
export function authoritySnapshot(a: Actor, ctx: Ctx4, approval: { bound?: { baseIdentity?: string | null }; current?: { baseIdentity?: string | null } } | null) {
  const rt = a.rt
  const own = normalizeOwnership(rt.host.missions.resolve({ missionId: ctx.missionId, assignmentId: ctx.assignmentId }))
  const holder = holderIdFor({ brokerId: BLUEPRINT_BROKER_ID, missionId: ctx.missionId, assignmentId: ctx.assignmentId, workspaceId: ctx.workspaceId })
  let lease: Record<string, unknown> = { state: 'UNKNOWN' }
  try {
    const l = rt.leaseBacking.inspect(ctx.workspaceId) as { valid: boolean; holder: string; classification: string; epoch: number; missionId?: string } | null
    lease = l ? { state: l.holder === holder ? 'HELD_BY_THIS_EXECUTION' : 'HELD_BY_OTHER', holder: l.holder === holder ? holder : l.holder, valid: l.valid, classification: l.classification, epoch: l.epoch } : { state: 'FREE' }
  } catch { lease = { state: 'UNKNOWN' } }
  const snap = snapshotOf(ctx.workspaceId)
  let base: Record<string, unknown> = { status: 'UNKNOWN' }
  try {
    const id = liveBaseIdentity.inspect(ctx.workspaceId) as Record<string, unknown> | null
    const digest = id?.complete ? (liveBaseIdentity.resolve(ctx.workspaceId) as string) : null
    base = { status: !digest ? 'UNPROVEN' : approval?.bound?.baseIdentity ? (approval.bound.baseIdentity === digest ? 'UNCHANGED_SINCE_APPROVAL' : 'CHANGED_SINCE_APPROVAL') : 'NOT_APPROVED_YET', digest, sourceKind: id?.sourceKind, branch: id?.branch, baseCommit: id?.baseCommit, repositoryId: id?.repositoryId, worktreeId: id?.worktreeId, rootId: id?.rootId, canonicalRoot: id?.canonicalRoot }
  } catch { base = { status: 'UNPROVEN' } }
  return {
    mission: { id: ctx.missionId, state: own?.missionState ?? 'UNKNOWN', cancelRequested: own?.cancelRequested ?? false, pauseRequested: own?.pauseRequested ?? false, kind: own?.missionKind ?? 'UNKNOWN' },
    assignment: { id: ctx.assignmentId, state: own?.assignmentState ?? 'UNKNOWN', ownerAgent: own?.ownerId ?? 'UNKNOWN', ownerState: own?.ownerState ?? 'UNKNOWN', worker: own?.workerId ?? 'UNKNOWN', taskClass: own?.taskClass ?? 'UNKNOWN', writeGrantedBy: own?.writeGrantedBy ?? 'UNKNOWN', writeCapable: own?.writeCapable ?? false },
    ownershipComplete: own?.complete === true, linkage: own?.linkage ?? 'MISMATCH',
    writeScope: { established: own?.writeScope?.established ?? false, count: own?.writeScope?.paths?.length ?? 0, paths: [...(own?.writeScope?.paths ?? [])].slice(0, 60) },
    workspace: { id: ctx.workspaceId, resolved: !!resolveBlueprintWorkspaceSync(ctx.workspaceId), type: snap?.workspaceType ?? 'UNKNOWN' },
    lease, baseIdentity: base,
    session: { actorId: a.userId, sessionId: a.sessionId, source: 'war-room.local-session' },
  }
}

// ------------------------------------------------------------------ handlers
export const handleList = (req: Request) => withActor(req, false, a => ({ blueprints: a.rt.broker.list(a.handle) }))

export const handleImport = (req: Request) => withActor(req, true, async a => {
  const body = await readBody(req)
  const raw = typeof body.raw === 'string' ? body.raw : body.package && typeof body.package === 'object' ? JSON.stringify(body.package) : null
  if (!raw) throw http(400, 'INVALID_FIELD', 'Provide the package as `raw` (JSON text) or `package` (object).')
  const ctx: Ctx4 = { missionId: strField(body, 'missionId'), assignmentId: strField(body, 'assignmentId'), workspaceId: strField(body, 'workspaceId'), requestingSubsystem: REQUESTING_SUBSYSTEM }
  const ws = await refreshBlueprintWorkspace(ctx.workspaceId)
  if (!ws.ok) throw new BlueprintError('WORKSPACE_MISMATCH', 'workspace', `Workspace unavailable (${ws.code})`)
  const out = a.rt.broker.importPackage(a.handle, raw, ctx) as { execId: string; preview: Record<string, unknown>; projection: unknown }
  const deps = await describeDependencies({ workspaceId: ctx.workspaceId, declared: (out.preview.dependencies as { name: string; version: string }[]) ?? [], verifier: a.rt.verifier, store: a.rt.store })
  return { execId: out.execId, projection: out.projection, preview: { ...out.preview, limits: truthfulLimits(a.rt) }, dependencies: deps }
}, 201)

export const handleGet = (req: Request, rawId: string) => withActor(req, false, async a => {
  const id = needId(rawId), ctx = await ctxFor(a, id), rt = a.rt
  const projection = rt.broker.status(a.handle, id)
  const approval = rt.broker.approvalState(a.handle, id)
  let preview: Record<string, unknown> | null = null, previewError: unknown = null
  try { preview = { ...(rt.broker.preview(a.handle, id) as Record<string, unknown>), limits: truthfulLimits(rt) } } catch (e) { previewError = e instanceof BlueprintError ? describeError(e) : { code: 'EXECUTION_FAILED', message: 'Preview unavailable' } }
  const declared = ((preview?.dependencies ?? []) as { name: string; version: string }[])
  const dependencies = await describeDependencies({ workspaceId: ctx.workspaceId, declared, verifier: rt.verifier, store: rt.store })
  let lineage: unknown = null, lineageError: unknown = null
  try { if (projection.state === 'VERIFIED_SOURCE') lineage = await rt.broker.lineage(a.handle, id) } catch (e) { lineageError = e instanceof BlueprintError ? describeError(e) : { code: 'EXECUTION_FAILED', message: 'Lineage unavailable' } }
  let stageRuns: unknown = []; try { stageRuns = rt.broker.stageRuns(a.handle, id) } catch { stageRuns = [] }
  let artifacts: unknown = null; try { artifacts = rt.broker.artifactManifest(a.handle, id) } catch { artifacts = null }
  return { execId: id, projection, approval, preview, previewError, artifacts, authority: authoritySnapshot(a, ctx, approval), dependencies, lineage, lineageError, stageRuns, background: rt.background.get(id) ?? null, recipe: { authorized: rt.kit.pipeline.authorized(), pipelineKind: rt.kit.pipeline.kind, recipes: ['build', 'package'].map(s => { const r = rt.kit.pipeline.recipe(s as 'build' | 'package'); return { stage: s, id: r.id, version: r.version, digest: r.digest, sandbox: r.sandbox, network: r.network } }) }, notClaimed: ['WAR_ROOM_DESKTOP_BUILD', 'PRODUCTION_PACKAGE', 'INSTALLED_RUNTIME', 'TASK_COMPLETE', 'DEPLOYMENT'] }
})

export const handleStatus = (req: Request, rawId: string) => withActor(req, false, async a => {
  const id = needId(rawId); await ctxFor(a, id)
  const projection = a.rt.broker.status(a.handle, id), approval = a.rt.broker.approvalState(a.handle, id)
  let runs: { stage: string; state: string; lastActivityAt: number | null; elapsedMs: number | null; progress: unknown }[] = []; try { runs = a.rt.broker.stageRuns(a.handle, id) } catch { runs = [] }
  return { execId: id, state: projection.state, report: projection.report, claims: projection.claims, stages: projection.stages, approvalUsable: approval.usable === true, staleInputs: approval.stale ?? [], stageRuns: runs, background: a.rt.background.get(id) ?? null, note: projection.note }
})

export const handlePreview = (req: Request, rawId: string) => withActor(req, false, async a => {
  const id = needId(rawId); const ctx = await ctxFor(a, id)
  const preview = a.rt.broker.preview(a.handle, id) as Record<string, unknown>
  const dependencies = await describeDependencies({ workspaceId: ctx.workspaceId, declared: (preview.dependencies as { name: string; version: string }[]) ?? [], verifier: a.rt.verifier, store: a.rt.store })
  return { execId: id, preview: { ...preview, limits: truthfulLimits(a.rt) }, dependencies }
})

export const handleApprove = (req: Request, rawId: string) => withActor(req, true, async a => {
  const id = needId(rawId), ctx = await ctxFor(a, id), body = await readBody(req).catch(() => ({} as Record<string, unknown>))
  // The Commander approves what they SAW: the UI must send the exact digests it rendered; any difference from the server's current values refuses (409) and nothing is approved.
  const exp = body.expected && typeof body.expected === 'object' ? (body.expected as Record<string, unknown>) : null
  if (!exp) throw http(400, 'EXPECTED_REQUIRED', 'Approval must state the exact package digest and bound inputs that were shown.')
  const before = a.rt.broker.approvalState(a.handle, id) as { packageDigest?: string; current?: Record<string, string | null> }
  const mismatch = [['packageDigest', before.packageDigest], ...['baseIdentity', 'checkBinding', 'ownership', 'pipeline'].map(k => [k, before.current?.[k] ?? null])].filter(([k, v]) => (exp[k as string] ?? null) !== (v ?? null)).map(([k]) => k)
  if (mismatch.length) throw http(409, 'APPROVAL_VIEW_STALE', `What was shown no longer matches the current state (${mismatch.join(', ')}). Reload, review, and approve again.`)
  const projection = a.rt.broker.approve(a.handle, id, ctx)
  return { execId: id, projection, approval: a.rt.broker.approvalState(a.handle, id) }
})

/** Background stage runs: the actor handle is only needed to START advanceStages (it authenticates synchronously); later gates use live host authority, not a held credential. */
function startStages(a: Actor, id: string, ctx: Ctx4): { started: boolean; reason?: string } {
  const running = a.rt.background.get(id)
  if (running && running.finishedAt === null) return { started: false, reason: 'ALREADY_RUNNING' }
  const entry = { execId: id, startedAt: Date.now(), finishedAt: null as number | null, error: null as { code: string; message: string } | null }
  a.rt.background.set(id, entry)
  const p = a.rt.broker.advanceStages(a.handle, id, ctx) as Promise<unknown>
  p.then(() => { entry.finishedAt = Date.now() }, (e: unknown) => { entry.finishedAt = Date.now(); const d = e instanceof BlueprintError ? describeError(e) : { code: 'EXECUTION_FAILED', message: 'Unexpected failure' }; entry.error = { code: d.code, message: d.message } })
  return { started: true }
}

export const handleRun = (req: Request, rawId: string) => withActor(req, true, async a => {
  const id = needId(rawId), ctx = await ctxFor(a, id), body = await readBody(req).catch(() => ({} as Record<string, unknown>))
  let projection = a.rt.broker.status(a.handle, id)
  if (projection.state === 'APPROVED') projection = await a.rt.broker.execute(a.handle, id, ctx)
  else if (projection.state !== 'VERIFIED_SOURCE') throw new BlueprintError('BROKER_STATE', 'broker', `Cannot run while the blueprint is ${projection.state}`)
  const stages = body.stages === true && projection.state === 'VERIFIED_SOURCE' ? startStages(a, id, ctx) : { started: false }
  return { execId: id, projection, stages }
}, 202)

export const handlePause = (req: Request, rawId: string) => withActor(req, true, async a => { const id = needId(rawId), ctx = await ctxFor(a, id), b = await readBody(req).catch(() => ({} as Record<string, unknown>)); return { execId: id, pause: a.rt.broker.pause(a.handle, id, ctx, { reason: String(b.reason ?? '').slice(0, 200) }) } })
export const handleResume = (req: Request, rawId: string) => withActor(req, true, async a => { const id = needId(rawId), ctx = await ctxFor(a, id); return { execId: id, projection: await a.rt.broker.resume(a.handle, id, ctx) } })

export const handleCancel = (req: Request, rawId: string) => withActor(req, true, async a => {
  const id = needId(rawId), ctx = await ctxFor(a, id), b = await readBody(req).catch(() => ({} as Record<string, unknown>)), reason = String(b.reason ?? '').slice(0, 200)
  const st = a.rt.broker.status(a.handle, id).state
  if (st === 'VERIFIED_SOURCE') return { execId: id, target: 'stages', cancel: await a.rt.broker.cancelBuild(a.handle, id, ctx, { reason }) } // source work is complete; cancel build/package stages only
  return { execId: id, target: 'execution', cancel: a.rt.broker.cancel(a.handle, id, ctx, { reason, disposition: 'ROLLBACK' }) }
})

export const handleReconcile = (req: Request, rawId: string) => withActor(req, true, async a => {
  const id = needId(rawId), ctx = await ctxFor(a, id), b = await readBody(req)
  if (b.kind === 'stage') { const stage = strField(b, 'stage', 20), decision = strField(b, 'decision', 20); return { execId: id, reconcile: a.rt.broker.reconcileStage(a.handle, id, ctx, stage, { decision, reason: String(b.reason ?? '').slice(0, 200) }) } }
  const action = strField(b, 'action', 20)
  if (!['RECONCILE', 'RESUME'].includes(action)) throw http(400, 'INVALID_FIELD', 'action must be RECONCILE or RESUME (use /restore for RESTORE).')
  return { execId: id, recovery: await a.rt.broker.recoverRun(a.handle, id, action, ctx) }
})

export const handleRestore = (req: Request, rawId: string) => withActor(req, true, async a => { const id = needId(rawId), ctx = await ctxFor(a, id); return { execId: id, recovery: await a.rt.broker.recoverRun(a.handle, id, 'RESTORE', ctx) } })

export const handleReceipts = (req: Request, rawId: string) => withActor(req, false, async a => {
  const id = needId(rawId); await ctxFor(a, id)
  let coreReceipt: unknown = null; try { coreReceipt = a.rt.broker.getReceipt(a.handle, id) } catch (e) { coreReceipt = { unavailable: e instanceof BlueprintError ? describeError(e) : { code: 'EXECUTION_FAILED' } } }
  let lineage: unknown = null; try { lineage = await a.rt.broker.lineage(a.handle, id) } catch { lineage = null }
  let recovery: unknown = null; try { recovery = (a.rt.broker.recoverAll(a.handle) as { execId: string }[]).find(r => r.execId === id) ?? null } catch { recovery = { unavailable: true } }
  let stageRecovery: unknown = null; try { stageRecovery = (await a.rt.broker.recoverStages(a.handle) as { execId: string }[]).find(r => r.execId === id) ?? null } catch { stageRecovery = { unavailable: true } }
  let artifacts: unknown = null; try { artifacts = a.rt.broker.artifactManifest(a.handle, id) } catch { artifacts = { unavailable: true } }
  return { execId: id, coreReceipt, lineage, runRecovery: recovery, stageRecovery, stageRuns: a.rt.broker.stageRuns(a.handle, id), artifacts }
})

/** Dependency view + Commander approval of dependency NEEDS (never an install; manifest/lockfile changes are a separate governed action that is not performed here). */
export const handleDependencies = (req: Request, rawId: string) => withActor(req, req.method !== 'GET', async a => {
  const id = needId(rawId), ctx = await ctxFor(a, id)
  const preview = a.rt.broker.preview(a.handle, id) as Record<string, unknown>, declared = (preview.dependencies as { name: string; version: string }[]) ?? []
  if (req.method === 'POST') {
    const b = await readBody(req), name = strField(b, 'name', 214), version = strField(b, 'version', 64)
    if (!declared.some(d => d.name === name && d.version === version)) throw http(400, 'INVALID_FIELD', 'Only dependencies declared by this package can be approved here.')
    if (b.action === 'revoke') a.rt.store.revoke(ctx.workspaceId, name, version)
    else a.rt.store.approve({ workspaceId: ctx.workspaceId, name, version, actorId: a.userId, sessionId: a.sessionId, reason: strField(b, 'reason', 300) })
  }
  return { execId: id, dependencies: await describeDependencies({ workspaceId: ctx.workspaceId, declared, verifier: a.rt.verifier, store: a.rt.store }) }
})
