import { NextResponse } from 'next/server'
import { loadProject } from '@/lib/media-command/store'
import { executeQcJob } from '@/lib/media-command/qc-job'
import { preflightDeliver } from '@/lib/media-command/preflight'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  let body: { projectId?: string; filePath?: string; action?: 'qc' | 'preflight' } = {}
  try { body = await req.json() as typeof body } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (!body.projectId) return NextResponse.json({ error: 'projectId required.' }, { status: 400 })
  const project = await loadProject(body.projectId)
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
  if (body.action === 'preflight') {
    return NextResponse.json(preflightDeliver(project))
  }
  const last = [...project.renderJobs].reverse().find(j => j.status === 'completed' && j.outputPath)
  const filePath = body.filePath ?? last?.outputPath
  if (!filePath) return NextResponse.json({ error: 'No render output to QC.' }, { status: 400 })
  const result = await executeQcJob({ projectId: body.projectId, filePath })
  return NextResponse.json(result, { status: result.error ? 409 : 201 })
}
