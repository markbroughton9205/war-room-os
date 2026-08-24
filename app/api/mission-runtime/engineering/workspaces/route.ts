import { NextResponse } from 'next/server'
import {
  listWorkspaces,
  openExistingRepositoryWorkspace,
  WorkspaceValidationError,
} from '@/lib/native-builder/workspaceRegistry'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** List registered workspaces (Standalone Builder Phase B). */
export async function GET() {
  const workspaces = await listWorkspaces()
  return NextResponse.json({ workspaces })
}

/**
 * "Open Existing Repository" — the one workspace-creation capability implemented in Phase B.
 * New Project and Clone Repository are not implemented here; see the Phase B section of the
 * completion report for why they are the documented remaining bounded capability.
 */
export async function POST(req: Request) {
  let body: { path?: string; label?: string } = {}
  try {
    const raw = await req.json()
    if (raw !== null && typeof raw === 'object') body = raw
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (!body.path) return NextResponse.json({ error: 'path is required.' }, { status: 400 })
  try {
    const workspace = await openExistingRepositoryWorkspace(body.path, body.label)
    return NextResponse.json({ workspace })
  } catch (error) {
    if (error instanceof WorkspaceValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
