import { NextResponse } from 'next/server'
import { loadProject } from '@/lib/media-command/store'
import { executeEffectGraph } from '@/lib/media-command/effect-graph-runtime'
import { firstMaskedMergeGraph, planEffectGraphLowering, type HvsEffectGraph } from '@/lib/media-command/effect-graph'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  let body: { projectId?: string; graph?: HvsEffectGraph; still?: boolean; durationSec?: number } = {}
  try {
    body = await req.json() as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (!body.projectId) return NextResponse.json({ error: 'projectId required.' }, { status: 400 })
  const project = await loadProject(body.projectId)
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
  const videos = project.assets.filter(a => a.kind === 'video' || a.kind === 'image')
  const graph = body.graph ?? firstMaskedMergeGraph(project.id, videos[0]?.id ?? '', videos[1]?.id ?? videos[0]?.id ?? '')
  const plan = planEffectGraphLowering(graph)
  const executed = await executeEffectGraph({
    project,
    graph,
    still: body.still !== false,
    durationSec: body.durationSec ?? 2,
  })
  return NextResponse.json({
    job: executed.job,
    outputPath: executed.outputPath,
    probe: executed.probe,
    filterComplex: executed.filterComplex,
    previewCss: plan.previewCss,
    error: executed.error,
  }, { status: executed.error ? 500 : 201 })
}
