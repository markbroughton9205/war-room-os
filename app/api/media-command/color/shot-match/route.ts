import { NextResponse } from 'next/server'
import { loadProject } from '@/lib/media-command/store'
import { executeColorPipeline, firstWave2ColorPipeline } from '@/lib/media-command/color-runtime'
import { proposeShotMatch, statsFromChannels } from '@/lib/media-command/shot-match'
import { findAsset } from '@/lib/media-command/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  let body: { projectId?: string; referenceAt?: number; targetAt?: number; commit?: boolean } = {}
  try {
    body = await req.json() as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (!body.projectId) return NextResponse.json({ error: 'projectId required.' }, { status: 400 })
  const project = await loadProject(body.projectId)
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
  const video = project.assets.find(a => a.kind === 'video')
  const asset = video ? findAsset(project, video.id) : null
  if (!asset?.originalPath) return NextResponse.json({ error: 'No video asset.' }, { status: 400 })
  const identity = { schemaVersion: 1 as const, outputColorSpace: 'display-referred' as const, nodes: [{ id: 'offset', type: 'offset' as const, enabled: true, params: { offset: 0.0001 } }] }
  const refRun = await executeColorPipeline({ projectId: project.id, sourcePath: asset.originalPath, pipeline: identity, atSec: body.referenceAt ?? 0.2 })
  const tgtRun = await executeColorPipeline({ projectId: project.id, sourcePath: asset.originalPath, pipeline: firstWave2ColorPipeline(), atSec: body.targetAt ?? 1 })
  if (!refRun.after || !tgtRun.after) {
    return NextResponse.json({ error: refRun.error ?? tgtRun.error ?? 'Shot measure failed.', silentApply: false }, { status: 500 })
  }
  const proposal = proposeShotMatch(statsFromChannels(refRun.after), statsFromChannels(tgtRun.after))
  return NextResponse.json({
    proposal,
    silentApply: false,
    committed: false,
    note: 'Proposal only. Commit via updateColorPipeline.',
  })
}
