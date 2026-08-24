/**
 * Phase B route-level helper. Resolves an optional workspaceId (query param on GET, JSON body
 * field on POST) against the workspace registry and runs the handler inside
 * runWithWorkspaceRoot() for that workspace's root. When no workspaceId is supplied, runs the
 * handler with no override — identical to every pre-Phase-B route (the process's own repo, via
 * REPO_ROOT/cwd). This is the only place API routes need to change to become workspace-aware; no
 * route's internal logic is modified.
 */
import { NextResponse } from 'next/server'
import { runWithWorkspaceRoot } from '@/lib/repo/workspaceContext'
import { getWorkspace } from '@/lib/native-builder/workspaceRegistry'

export async function resolveWorkspaceRoot(workspaceId: string | null | undefined): Promise<
  { ok: true; root: string | undefined } | { ok: false; response: NextResponse }
> {
  if (!workspaceId) return { ok: true, root: undefined }
  const workspace = await getWorkspace(workspaceId)
  if (!workspace) {
    return { ok: false, response: NextResponse.json({ error: `Unknown workspaceId "${workspaceId}".` }, { status: 404 }) }
  }
  return { ok: true, root: workspace.root }
}

export async function runInResolvedWorkspace<T>(
  workspaceId: string | null | undefined,
  fn: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; response: NextResponse }> {
  const resolved = await resolveWorkspaceRoot(workspaceId)
  if (!resolved.ok) return resolved
  if (!resolved.root) return { ok: true, value: await fn() }
  return { ok: true, value: await runWithWorkspaceRoot(resolved.root, fn) }
}
