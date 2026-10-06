import { NextResponse } from 'next/server'
import { loadProject } from '@/lib/media-command/store'
import { executeColorPipeline } from '@/lib/media-command/color-runtime'
import { identityColorPipelineOr } from '@/lib/media-command/color-pipeline'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')
  const at = Number(url.searchParams.get('at') ?? '1')
  if (!projectId) return NextResponse.json({ error: 'projectId required.' }, { status: 400 })
  const project = await loadProject(projectId)
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
  const video = project.assets.find(a => a.kind === 'video')
  if (!video?.originalPath) return NextResponse.json({ error: 'No video asset.' }, { status: 404 })
  const executed = await executeColorPipeline({
    projectId: project.id,
    sourcePath: video.originalPath,
    pipeline: identityColorPipelineOr(project.colorPipeline),
    atSec: Number.isFinite(at) ? at : 1,
  })
  return NextResponse.json({
    before: executed.before,
    after: executed.after,
    beforeScopes: executed.beforeScopes,
    afterScopes: executed.afterScopes,
    beforePath: executed.beforePath,
    afterPath: executed.afterPath,
    durationMs: executed.durationMs,
    error: executed.error,
  }, { status: executed.error ? 500 : 200 })
}
