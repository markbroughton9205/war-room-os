import { NextResponse } from 'next/server'
import { loadProject } from '@/lib/media-command/store'
import { executeAudioGraph, executeAudioMix } from '@/lib/media-command/audio-runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  let body: { projectId?: string; mix?: boolean; channelId?: string } = {}
  try {
    body = await req.json() as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (!body.projectId) return NextResponse.json({ error: 'projectId required.' }, { status: 400 })
  const project = await loadProject(body.projectId)
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
  const source = project.assets.find(a => a.kind === 'video' || a.kind === 'audio')
  if (!source?.originalPath) return NextResponse.json({ error: 'No audio source.' }, { status: 404 })
  const executed = body.mix
    ? await executeAudioMix({
      projectId: project.id,
      sourceA: source.originalPath,
      sourceB: source.originalPath,
      graph: project.audioGraph,
    })
    : await executeAudioGraph({
      projectId: project.id,
      sourcePath: source.originalPath,
      graph: project.audioGraph,
      channelId: body.channelId,
    })
  return NextResponse.json({
    job: executed.job,
    meters: executed.meters,
    peak: executed.peak,
    rms: executed.rms,
    leftRms: executed.leftRms,
    rightRms: executed.rightRms,
    bands: executed.bands,
    error: executed.error,
  }, { status: executed.error ? 500 : 201 })
}
