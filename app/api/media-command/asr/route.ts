import { NextResponse } from 'next/server'
import { loadProject } from '@/lib/media-command/store'
import { requestTranscription } from '@/lib/media-command/asr'
import { readTranscriptSync, searchTranscript } from '@/lib/media-command/transcript'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')
  const assetId = url.searchParams.get('assetId')
  const q = url.searchParams.get('q')
  if (!projectId || !assetId) return NextResponse.json({ error: 'projectId and assetId required.' }, { status: 400 })
  const doc = readTranscriptSync(projectId, assetId)
  const hits = doc && q ? searchTranscript(doc, q) : []
  return NextResponse.json({
    transcript: doc,
    hits,
    evidenceSource: 'transcript',
    note: 'Click hits seek Source Monitor only. No timeline edit.',
  })
}

export async function POST(req: Request) {
  let body: { projectId?: string; assetId?: string } = {}
  try { body = await req.json() as typeof body } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (!body.projectId || !body.assetId) return NextResponse.json({ error: 'projectId and assetId required.' }, { status: 400 })
  const project = await loadProject(body.projectId)
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
  const result = await requestTranscription({ projectId: body.projectId, assetId: body.assetId })
  return NextResponse.json(result, { status: result.status === 'BLOCKED_PENDING_APPROVAL' ? 202 : result.error ? 409 : 201 })
}
