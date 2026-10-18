/**
 * Workspace binding for Foundry coding missions.
 *
 * A write-capable mission carries an explicit, validated workspace (id + canonical root) on its record. Every entry that runs the mission
 * (HTTP run, resume, restart recovery, child job runner) re-establishes that root with runWithWorkspaceRoot, so every file, git, terminal,
 * test and build operation below resolveRepoRoot() lands in the bound workspace. Nothing here defaults to process.cwd(): on the installed
 * runtime (whose own root is the install tree) a write-capable mission without a binding is blocked.
 */
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { getActiveWorkspaceId, getActiveWorkspaceRootOverride } from '@/lib/repo/workspaceContext'
import { resolveBaseRepoRoot } from '@/lib/repo/paths'
import { assertPathInsideAllowedRoots, getEngineerAllowedRoots, getWorkspace, isPathInsideRoot } from './workspaceRegistry'
import { classifyWorkspaceRoot } from './foundryWorkspaceIdentity'
import type { FoundryMissionRecord } from './foundryMissionTypes'

export type FoundryWorkspaceBinding = {
  workspaceId: string
  /** Canonical (realpath) root, validated when the binding was made and again on every run. */
  workspaceRoot: string
  boundAt: string
  source: 'REQUEST' | 'PARENT' | 'SESSION' | 'CONTEXT'
}

export type WorkspaceBindingCode =
  | 'WORKSPACE_UNKNOWN'
  | 'WORKSPACE_ROOT_MISSING'
  | 'WORKSPACE_ROOT_NOT_ABSOLUTE'
  | 'WORKSPACE_PATH_TRAVERSAL'
  | 'WORKSPACE_SYMLINK_ESCAPE'
  | 'WORKSPACE_OUTSIDE_ALLOWED_ROOTS'
  | 'WORKSPACE_INSTALL_TREE'
  | 'WORKSPACE_ROOT_CHANGED'
  | 'WORKSPACE_BINDING_REQUIRED'

export class WorkspaceBindingError extends Error {
  constructor(readonly code: WorkspaceBindingCode, message: string) {
    super(message)
    this.name = 'WorkspaceBindingError'
  }

  get status(): number {
    return this.code === 'WORKSPACE_UNKNOWN' ? 404 : 400
  }
}

export type WorkspaceRootCheck = { ok: true; root: string } | { ok: false; code: WorkspaceBindingCode; reason: string }

const fail = (code: WorkspaceBindingCode, reason: string): WorkspaceRootCheck => ({ ok: false, code, reason })

/** A root is trusted only when it is absolute, free of traversal, a real directory, inside an allowed engineering root once symlinks are resolved, and not the install tree. */
export async function validateWorkspaceRoot(candidate: string, options: { allowInstalledRuntime?: boolean; classify?: (root: string) => string } = {}): Promise<WorkspaceRootCheck> {
  if (typeof candidate !== 'string' || !candidate.trim()) return fail('WORKSPACE_ROOT_MISSING', 'The workspace has no root path.')
  if (!path.isAbsolute(candidate)) return fail('WORKSPACE_ROOT_NOT_ABSOLUTE', `Workspace root must be an absolute path: ${candidate}`)
  if (candidate.split(/[\\/]+/).includes('..')) return fail('WORKSPACE_PATH_TRAVERSAL', `Workspace root contains path traversal: ${candidate}`)
  let real: string
  try {
    real = await realpath(candidate)
    if (!(await stat(real)).isDirectory()) return fail('WORKSPACE_ROOT_MISSING', `Workspace root is not a directory: ${candidate}`)
  } catch {
    return fail('WORKSPACE_ROOT_MISSING', `Workspace root does not exist: ${candidate}`)
  }
  const allowed = await assertPathInsideAllowedRoots(real)
  if (!allowed.ok) {
    const resolved = path.resolve(candidate)
    const roots = await getEngineerAllowedRoots()
    const lexicallyInside = roots.some(root => isPathInsideRoot(resolved, root))
    return lexicallyInside && real !== resolved
      ? fail('WORKSPACE_SYMLINK_ESCAPE', `Workspace root ${candidate} resolves through a symlink to ${real}, outside the allowed engineering roots.`)
      : fail('WORKSPACE_OUTSIDE_ALLOWED_ROOTS', allowed.reason)
  }
  if (!options.allowInstalledRuntime && (options.classify ?? classifyWorkspaceRoot)(real) === 'INSTALLED_RUNTIME') {
    return fail('WORKSPACE_INSTALL_TREE', `Workspace root ${real} is inside an installed War Room runtime; a coding mission may not mutate the install tree.`)
  }
  return { ok: true, root: real }
}

async function bindingFromRegistry(workspaceId: string, source: FoundryWorkspaceBinding['source']): Promise<FoundryWorkspaceBinding> {
  const record = await getWorkspace(workspaceId)
  if (!record) throw new WorkspaceBindingError('WORKSPACE_UNKNOWN', `Unknown workspaceId "${workspaceId}".`)
  const checked = await validateWorkspaceRoot(record.root)
  if (!checked.ok) throw new WorkspaceBindingError(checked.code, checked.reason)
  return { workspaceId: record.id, workspaceRoot: checked.root, boundAt: new Date().toISOString(), source }
}

/**
 * The binding for a NEW mission: an explicit workspaceId wins, then the parent mission's binding (children inherit), then the session's workspace,
 * then the workspace context already active in this async scope. Returns null when nothing binds it. Throws WorkspaceBindingError when a requested
 * binding is invalid: an invalid request never falls back to another root.
 */
export async function resolveWorkspaceBinding(input: {
  workspaceId?: string | null
  parentBinding?: FoundryWorkspaceBinding | null
  sessionWorkspaceId?: string | null
}): Promise<FoundryWorkspaceBinding | null> {
  if (input.workspaceId) return bindingFromRegistry(input.workspaceId, 'REQUEST')
  if (input.parentBinding) {
    const checked = await validateWorkspaceRoot(input.parentBinding.workspaceRoot)
    if (!checked.ok) throw new WorkspaceBindingError(checked.code, checked.reason)
    return { ...input.parentBinding, workspaceRoot: checked.root, source: 'PARENT' }
  }
  if (input.sessionWorkspaceId) return bindingFromRegistry(input.sessionWorkspaceId, 'SESSION')
  const activeRoot = getActiveWorkspaceRootOverride()
  if (activeRoot) {
    const checked = await validateWorkspaceRoot(activeRoot)
    if (!checked.ok) throw new WorkspaceBindingError(checked.code, checked.reason)
    return { workspaceId: getActiveWorkspaceId() ?? 'context', workspaceRoot: checked.root, boundAt: new Date().toISOString(), source: 'CONTEXT' }
  }
  return null
}

/** A mission that can change files or run commands. The application-builder lane has its own guarded project isolation. */
export function missionIsWriteCapable(mission: Pick<FoundryMissionRecord, 'kind' | 'permissions'>): boolean {
  if (mission.kind === 'app_builder') return false
  return mission.permissions?.filesystem === true || mission.permissions?.terminal === true
}

export type WorkspaceBlocker = { blocker: string; evidence: string; attempted: string; why: string; unblock: string }
export type WorkspaceScope =
  | { ok: true; root: string | undefined; workspaceId: string | undefined }
  | { ok: false; code: WorkspaceBindingCode; blocker: WorkspaceBlocker }

const blocked = (code: WorkspaceBindingCode, evidence: string, why: string, unblock: string): WorkspaceScope => ({
  ok: false,
  code,
  blocker: { blocker: code, evidence, attempted: 'Resolve the mission workspace before running', why, unblock },
})

/**
 * The scope a mission must run in. A bound mission is re-validated on every run (a deleted root, a retargeted symlink or a root that left the
 * allowed engineering roots blocks it). An unbound write-capable mission is blocked when the process root is an installed runtime.
 * `deps` lets validators supply a base root and classifier.
 */
export async function missionWorkspaceScope(
  mission: Pick<FoundryMissionRecord, 'kind' | 'permissions'> & { workspaceBinding?: FoundryWorkspaceBinding | null },
  deps: { baseRoot?: string; classify?: (root: string) => string } = {},
): Promise<WorkspaceScope> {
  const binding = mission.workspaceBinding
  if (binding) {
    const checked = await validateWorkspaceRoot(binding.workspaceRoot)
    if (!checked.ok) return blocked(checked.code, checked.reason, 'The mission is bound to a workspace that is no longer a trusted root.', 'Restore the workspace or start a new mission bound to a valid workspace.')
    if (checked.root !== binding.workspaceRoot) {
      return blocked('WORKSPACE_ROOT_CHANGED', `Bound root ${binding.workspaceRoot} now resolves to ${checked.root}.`, 'The workspace root moved since the mission was bound.', 'Rebind the mission to the workspace.')
    }
    return { ok: true, root: checked.root, workspaceId: binding.workspaceId }
  }
  if (missionIsWriteCapable(mission)) {
    const base = deps.baseRoot ?? resolveBaseRepoRoot()
    const kind = (deps.classify ?? classifyWorkspaceRoot)(base)
    if (kind === 'INSTALLED_RUNTIME') {
      return blocked(
        'WORKSPACE_BINDING_REQUIRED',
        `The mission can write files but is not bound to a workspace, and this process root (${base}) is an installed War Room runtime.`,
        'Foundry will not default a coding mission to the installed app directory.',
        'Start the mission with a workspaceId for a trusted project workspace.',
      )
    }
  }
  return { ok: true, root: undefined, workspaceId: undefined }
}
