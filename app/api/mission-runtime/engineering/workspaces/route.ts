import { NextResponse } from 'next/server'
import {
  listWorkspaces,
  openExistingRepositoryWorkspace,
  openExistingProjectWorkspace,
  createNewProjectWorkspace,
  WorkspaceValidationError,
} from '@/lib/native-builder/workspaceRegistry'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const workspaces = await listWorkspaces()
  return NextResponse.json({ workspaces })
}

export async function POST(req: Request) {
  let body: { action?: string; path?: string; name?: string; label?: string; initializeGit?: boolean } = {}
  try {
    const raw = await req.json()
    if (raw !== null && typeof raw === 'object') body = raw
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  try {
    if (body.action === 'create') {
      if (!body.name) return NextResponse.json({ error: 'name is required to create a project.' }, { status: 400 })
      const workspace = await createNewProjectWorkspace({
        name: body.name,
        label: body.label,
        initializeGit: body.initializeGit,
      })
      return NextResponse.json({ workspace })
    }
    if (!body.path) return NextResponse.json({ error: 'path is required.' }, { status: 400 })
    const workspace =
      body.action === 'open-git'
        ? await openExistingRepositoryWorkspace(body.path, body.label)
        : await openExistingProjectWorkspace(body.path, body.label)
    return NextResponse.json({ workspace })
  } catch (error) {
    if (error instanceof WorkspaceValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
