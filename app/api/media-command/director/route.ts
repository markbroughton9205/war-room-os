import { NextResponse } from 'next/server'
import { loadProject } from '@/lib/media-command/store'
import { proposeDirectorCommands, type DirectorMode } from '@/lib/media-command/ai-director'
import { commitCommands } from '@/lib/media-command/store'
import type { SetVirtualCameraCommand } from '@/lib/media-command/edit-commands'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  let body: {
    projectId?: string
    utterance?: string
    mode?: DirectorMode
    commit?: boolean
    preview?: boolean
    playheadSeconds?: number
    selectedClipId?: string
    selectedCueId?: string
    selectedOverlayId?: string
    followMode?: SetVirtualCameraCommand['mode']
    sourceAssetId?: string
    sourceIn?: { ticks: number; timescale: number } | null
    sourceOut?: { ticks: number; timescale: number } | null
    sourcePlayheadSeconds?: number
    workspacePage?: 'media' | 'cut' | 'edit' | 'vfx' | 'color' | 'audio' | 'photo' | 'ai' | 'review' | 'deliver'
  } = {}
  try {
    body = await req.json() as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (!body.projectId || !body.utterance?.trim()) {
    return NextResponse.json({ error: 'projectId and utterance are required.' }, { status: 400 })
  }
  const project = await loadProject(body.projectId)
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
  const proposal = proposeDirectorCommands(project, body.utterance, body.mode ?? 'AI_DIRECTOR', {
    playheadSeconds: body.playheadSeconds,
    selectedClipId: body.selectedClipId,
    selectedCueId: body.selectedCueId,
    selectedOverlayId: body.selectedOverlayId,
    followMode: body.followMode,
    sourceAssetId: body.sourceAssetId,
    sourceIn: body.sourceIn,
    sourceOut: body.sourceOut,
    sourcePlayheadSeconds: body.sourcePlayheadSeconds,
    workspacePage: body.workspacePage,
  })
  if (!body.commit) return NextResponse.json({ proposal, project })
  if (proposal.requiresConfirmation || proposal.commands.some(c => c.kind === 'restoreVersion' && !('confirmed' in c && c.confirmed))) {
    return NextResponse.json({
      proposal,
      project,
      error: 'Restore requires explicit Commander confirmation in the Version Browser.',
    }, { status: 409 })
  }
  const result = await commitCommands(project, proposal.commands, { preview: Boolean(body.preview) && !body.commit })
  return NextResponse.json({ proposal, ...result })
}
