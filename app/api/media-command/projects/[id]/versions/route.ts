import { NextResponse } from 'next/server'
import {
  compareProjectVersions,
  loadProject,
  snapshotVersion,
  versionSummaries,
} from '@/lib/media-command/store'
import { HVS_VERSION_RESTORE_POLICY } from '@/lib/media-command/versions'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const project = await loadProject(id)
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
  const summaries = await versionSummaries(project)
  const url = new URL(req.url)
  const a = url.searchParams.get('a')
  const b = url.searchParams.get('b')
  if (a && b) {
    const compared = await compareProjectVersions(project, a, b)
    if ('error' in compared) {
      return NextResponse.json({
        versions: project.versions,
        summaries,
        currentVersionId: project.currentVersionId,
        policy: HVS_VERSION_RESTORE_POLICY,
        error: compared.error,
      }, { status: 400 })
    }
    return NextResponse.json({
      versions: project.versions,
      summaries,
      currentVersionId: project.currentVersionId,
      compare: compared.compare,
      policy: HVS_VERSION_RESTORE_POLICY,
    })
  }
  return NextResponse.json({
    versions: project.versions,
    summaries,
    currentVersionId: project.currentVersionId,
    policy: HVS_VERSION_RESTORE_POLICY,
  })
}

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const project = await loadProject(id)
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
  let body: { label?: string; createdBy?: 'human' | 'ai-director' | 'system'; description?: string } = {}
  try {
    body = await req.json() as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  const saved = await snapshotVersion(
    project,
    body.label?.trim() || `Version ${project.versions.length + 1}`,
    body.createdBy ?? 'human',
    { description: body.description },
  )
  return NextResponse.json({ project: saved }, { status: 201 })
}
