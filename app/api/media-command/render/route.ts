import { NextResponse } from 'next/server'
import { loadProject, saveProject } from '@/lib/media-command/store'
import { processRenderQueue, requestRenderCancel } from '@/lib/media-command/render-engine'
import { applyEditCommand } from '@/lib/media-command/edit-ops'
import { newCommandId } from '@/lib/media-command/edit-commands'
import type { OutputAspect } from '@/lib/media-command/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  let body: { projectId?: string; aspect?: OutputAspect; action?: 'render' | 'cancel'; jobId?: string } = {}
  try {
    body = await req.json() as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (!body.projectId) return NextResponse.json({ error: 'projectId is required.' }, { status: 400 })
  const project = await loadProject(body.projectId)
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
  if (body.action === 'cancel') {
    if (!body.jobId) return NextResponse.json({ error: 'jobId is required to cancel.' }, { status: 400 })
    const next = requestRenderCancel(project, body.jobId)
    const saved = await saveProject(next)
    return NextResponse.json({ project: saved })
  }
  const aspect = body.aspect ?? '16:9'
  const queued = applyEditCommand(project, {
    id: newCommandId(),
    kind: 'render',
    actor: 'human',
    createdAt: new Date().toISOString(),
    aspect,
  })
  if (!queued.ok) return NextResponse.json({ error: queued.error }, { status: 422 })
  await saveProject(queued.project)
  const processed = await processRenderQueue(body.projectId)
  return NextResponse.json({ project: processed })
}
