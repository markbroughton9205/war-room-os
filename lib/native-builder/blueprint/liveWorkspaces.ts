/**
 * Live workspace resolution + base identity for blueprint execution.
 * Workspaces come from the existing registry and are re-validated with validateWorkspaceRoot (absolute, realpath, inside allowed engineering roots, NEVER the
 * installed runtime tree). The broker's adapters are synchronous, so each API call refreshes a validated snapshot; the synchronous resolver re-checks that the
 * snapshot root is still the same canonical directory at every use and otherwise reports the workspace as unavailable (fail closed).
 */
import { realpathSync, statSync } from 'node:fs'
import { validateWorkspaceRoot } from '../foundryWorkspaceBinding'
import { readWorkspaceBaseIdentity } from '../foundryWorkspaceIdentity'
import { getWorkspace } from '../workspaceRegistry'
import { BlueprintError } from './base.mjs'
import { classifyBaseChange, baseDigestOf, normalizeBaseIdentity } from './baseid.mjs'

export type WorkspaceSnapshot = { id: string; root: string; workspaceType: string; loadedAt: number }
type Store = { snaps: Map<string, WorkspaceSnapshot> }
const g = globalThis as typeof globalThis & { __wrBlueprintWorkspaces?: Store }
const store: Store = (g.__wrBlueprintWorkspaces ??= { snaps: new Map() })

export type WorkspaceRefresh = { ok: true; snapshot: WorkspaceSnapshot } | { ok: false; code: string; reason: string }

export async function refreshBlueprintWorkspace(workspaceId: string): Promise<WorkspaceRefresh> {
  if (typeof workspaceId !== 'string' || !/^[\w.:@/-]{1,200}$/.test(workspaceId)) return { ok: false, code: 'WORKSPACE_UNKNOWN', reason: 'Invalid workspace id.' }
  const record = await getWorkspace(workspaceId)
  if (!record) { store.snaps.delete(workspaceId); return { ok: false, code: 'WORKSPACE_UNKNOWN', reason: `Unknown workspaceId "${workspaceId}".` } }
  const checked = await validateWorkspaceRoot(record.root)
  if (!checked.ok) { store.snaps.delete(workspaceId); return { ok: false, code: checked.code, reason: checked.reason } }
  const { workspaceType, installedRuntime } = readWorkspaceBaseIdentity({ workspaceId, root: checked.root })
  if (installedRuntime) { store.snaps.delete(workspaceId); return { ok: false, code: 'WORKSPACE_INSTALL_TREE', reason: 'The installed War Room runtime is never a blueprint source workspace.' } }
  const snapshot: WorkspaceSnapshot = { id: record.id, root: checked.root, workspaceType: String(workspaceType), loadedAt: Date.now() }
  store.snaps.set(workspaceId, snapshot)
  return { ok: true, snapshot }
}

/** Synchronous resolver for the broker (`host.workspaces.resolve`). */
export function resolveBlueprintWorkspaceSync(workspaceId: string): { id: string; root: string } | null {
  const s = store.snaps.get(workspaceId)
  if (!s) return null
  try {
    if (realpathSync(s.root) !== s.root || !statSync(s.root).isDirectory()) return null
    return { id: s.id, root: s.root }
  } catch {
    return null
  }
}

export const snapshotOf = (workspaceId: string): WorkspaceSnapshot | null => store.snaps.get(workspaceId) ?? null

/** `host.baseIdentity`: resolve (opaque digest, refuses unproven identities), inspect (normalized identity), classify (change class). Backed by the live read-only accessor. */
export const liveBaseIdentity = Object.freeze({
  kind: 'workspace-git' as const,
  inspect(workspaceId: string) {
    const s = resolveBlueprintWorkspaceSync(workspaceId)
    if (!s) return normalizeBaseIdentity({ workspaceId, observedAt: Date.now() })
    return readWorkspaceBaseIdentity({ workspaceId, root: s.root }).identity
  },
  resolve(workspaceId: string): string {
    const s = resolveBlueprintWorkspaceSync(workspaceId)
    const r = s ? readWorkspaceBaseIdentity({ workspaceId, root: s.root }) : null
    if (!r || r.installedRuntime || !r.identity?.complete) throw new BlueprintError('BASE_REVISION_MISMATCH', 'preflight', 'Workspace base identity could not be proven (root not canonical, not a git checkout, installed runtime, or unreadable)')
    return baseDigestOf(r.identity)
  },
  classify: (stored: unknown, current: unknown) => classifyBaseChange(stored, current),
})
