import { NextResponse } from 'next/server'
import {
  listWorkspaces,
  openExistingRepositoryWorkspace,
  openExistingProjectWorkspace,
  createNewProjectWorkspace,
  WorkspaceValidationError,
} from '@/lib/native-builder/workspaceRegistry'
import { parseFoundryProjectHistoryView } from '@/lib/native-builder/foundryProjectVisibility'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const view = parseFoundryProjectHistoryView(new URL(req.url).searchParams.get('view'))
  const workspaces = await listWorkspaces(view)
  return NextResponse.json({ view, workspaces })
}

export async function POST(req: Request) {
  let body: { action?: string; path?: string; name?: string; label?: string; initializeGit?: boolean; projectId?: string } = {}
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
    if (body.action === 'create-application') {
      const { createFoundryApplicationWorkspace, slugProjectName } = await import('@/lib/native-builder/foundryProjectIsolation')
      const rawName = body.name?.trim() || `project-${Date.now().toString(36)}`
      const name = slugProjectName(rawName)
      const project = await createFoundryApplicationWorkspace({
        name,
        missionId: `draft-${crypto.randomUUID()}`,
        projectType: 'database_backed_app',
        label: body.label?.trim() || rawName,
      })
      return NextResponse.json({
        workspace: {
          id: project.projectId,
          label: project.projectName,
          displayTitle: project.projectName,
          root: project.projectRoot,
          workspaceType: 'GENERATED_PROJECT',
          applicationProjectId: project.projectId,
          runtimeStatus: 'STOPPED',
        },
        project,
      })
    }
    if (body.action === 'preview') {
      const projectId = body.projectId?.trim()
      if (!projectId) return NextResponse.json({ error: 'projectId is required to start a preview.' }, { status: 400 })
      const { ensureApplicationPreview } = await import('@/lib/native-builder/foundryProjectIsolation')
      const preview = await ensureApplicationPreview({ projectId })
      if (!preview.ok) return NextResponse.json({ error: preview.error ?? 'Preview did not start.' }, { status: 409 })
      return NextResponse.json({ preview })
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
