import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { AgentOpsLog } from '../../log'
import { deriveAssignments } from '../assignments'
import { buildAssignmentStatus } from '../status'
import { Workspace } from '../runtime/workspaceFs'
import { assessLiveness } from './liveness'
import { defaultLineup } from './lineup'
import { realFacts, reconcileMissions } from './reconcile'
import { MissionStore } from './store'
import { createMission, launchMission, resumeMission, cancelMission, MissionError, type MissionDraft, type RunnerDeps } from './runner'
import { verifyReceipt } from './receipt'
import type { MissionRecord } from './types'
import { installRuntime } from './install'

/** The repository a mission may seed from and integrate into. Server-side configuration only: the UI never names a path. */
export function engineeringRepo(log: AgentOpsLog): string | null {
  const env = process.env.WAR_ROOM_ENGINEERING_REPO?.trim()
  if (env && existsSync(path.join(env, '.git'))) return env
  try {
    const cfg = JSON.parse(readFileSync(path.join(path.dirname(log.file), 'engineering-config.json'), 'utf8')) as { repo?: string }
    if (cfg.repo && existsSync(path.join(cfg.repo, '.git'))) return cfg.repo
  } catch { /* not configured */ }
  return null
}

export function serviceDeps(log: AgentOpsLog = new AgentOpsLog()): RunnerDeps {
  const base = path.dirname(log.file)
  return { log, store: new MissionStore(log), workspacesRoot: path.join(base, 'engineering-workspaces'), integrationRoot: path.join(base, 'engineering-integration'), lineup: () => defaultLineup(), installer: (m, i, on) => installRuntime(m, i, on, engineeringRepo(log)) }
}

export type MissionView = {
  id: string; title: string; request: string; acceptance: string[]; state: MissionRecord['state']; stateReason: string; stateAt: string; createdAt: string; createdBy: string
  liveness: { verdict: string; reason: string }
  worker: { workerId: string; pid: number; heartbeatAgeSec: number; progressAgeSec: number; progressNote: string } | null
  attempts: MissionRecord['attempts']; recoveries: MissionRecord['recoveries']
  config: MissionRecord['config']; scope: MissionRecord['scope']; install: boolean
  workspace: { root: string; seeded: number; baseCommit: string | null }
  progress: MissionRecord['progress']; assignment: ReturnType<typeof buildAssignmentStatus> | null
  result: MissionRecord['result']
  receipt: MissionRecord['receipt'] | null
  receiptCheck: { ok: boolean; mismatches: string[] } | 'NO_RECEIPT'
  events: { at: string; kind: string; detail: string; attempt: number }[]
  controls: ('resume' | 'cancel')[]
}

export function missionView(deps: Pick<RunnerDeps, 'log' | 'store'>, m: MissionRecord, detail = false): MissionView {
  const f = realFacts()
  const live = assessLiveness(m, f)
  const l = m.lease
  const asg = deriveAssignments(deps.log).assignments.get(m.assignmentId)
  let receiptCheck: MissionView['receiptCheck'] = 'NO_RECEIPT'
  if (m.receipt && detail) { try { receiptCheck = verifyReceipt(m.receipt, new Workspace(m.workspace.root)) } catch (e) { receiptCheck = { ok: false, mismatches: [`workspace unavailable: ${e instanceof Error ? e.message : String(e)}`] } } }
  const controls: MissionView['controls'] = []
  if (m.state === 'INTERRUPTED' && m.recoveries[m.recoveries.length - 1]?.resumable !== false) controls.push('resume')
  if (m.state === 'INTERRUPTED' || (['QUEUED', 'RUNNING', 'VERIFYING', 'APPLYING', 'INSTALLING'] as string[]).includes(m.state)) controls.push('cancel')
  return {
    id: m.id, title: m.title, request: m.request, acceptance: m.acceptance, state: m.state, stateReason: m.stateReason, stateAt: m.stateAt, createdAt: m.createdAt, createdBy: m.createdBy,
    liveness: live,
    worker: l ? { workerId: l.workerId, pid: l.pid, heartbeatAgeSec: Math.round((f.now.getTime() - Date.parse(l.heartbeatAt)) / 1000), progressAgeSec: Math.round((f.now.getTime() - Date.parse(l.progressAt)) / 1000), progressNote: l.progressNote } : null,
    attempts: m.attempts, recoveries: m.recoveries, config: m.config, scope: m.scope, install: m.install,
    workspace: { root: m.workspace.root, seeded: m.workspace.seeded.length, baseCommit: m.workspace.baseCommit ?? null },
    progress: m.progress, assignment: asg ? buildAssignmentStatus(deps.log, asg) : null,
    result: m.result, receipt: detail ? m.receipt : m.receipt ? ({ ...m.receipt, provenance: { ...m.receipt.provenance, files: [] } } as MissionRecord['receipt']) : null, receiptCheck,
    events: deps.store.events(m.id, detail ? 300 : 12), controls,
  }
}

export function listMissions(deps: RunnerDeps) { reconcileMissions(deps.log, deps.store); return deps.store.list().slice(0, 30).map((m) => missionView(deps, m)) }
export function getMission(deps: RunnerDeps, id: string) { reconcileMissions(deps.log, deps.store); const m = deps.store.read(id); return m ? missionView(deps, m, true) : null }

/** Start from the API: the repository comes from server configuration, never from the request. */
export async function startFromApi(deps: RunnerDeps, body: Record<string, unknown>, actor: string) {
  const scopeIn = (body.scope ?? {}) as { paths?: unknown; write?: unknown }
  const paths = Array.isArray(scopeIn.paths) ? scopeIn.paths.map(String) : []
  const write = Array.isArray(scopeIn.write) ? scopeIn.write.map(String) : []
  const repo = paths.length ? engineeringRepo(deps.log) : null
  if (paths.length && !repo) throw new MissionError('SCOPE', 'no engineering repository is configured on this machine (WAR_ROOM_ENGINEERING_REPO or engineering-config.json)')
  const draft: MissionDraft = { title: String(body.title ?? ''), request: String(body.request ?? ''), acceptance: Array.isArray(body.acceptance) ? body.acceptance.map(String) : [], hints: Array.isArray(body.hints) ? body.hints.map(String) : [], targets: Array.isArray(body.targets) ? (body.targets as { path?: unknown; action?: unknown }[]).map((t) => ({ path: String(t?.path ?? ''), action: t?.action === 'create' ? ('create' as const) : ('modify' as const) })) : [], install: body.install === true, verifyScript: typeof body.verifyScript === 'string' ? body.verifyScript : undefined, scope: { write, ...(repo ? { source: { repo, paths } } : {}) } }
  const rec = await createMission(deps, draft, actor as never)
  launchMission(deps, rec.id, 'START')
  return rec
}
export { resumeMission, cancelMission, MissionError }
