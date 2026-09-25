import { NextResponse } from 'next/server'
import {
  replayInstalledMutation,
  resumeInstalledMissionSession,
  runInstalledLibraryProof,
  stampInstalledMutation,
} from '@/lib/native-builder/reasoning-kernel/production-proof'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function localRequest(req: Request): boolean {
  const host = new URL(req.url).hostname
  return host === '127.0.0.1' || host === 'localhost'
}

export async function POST(req: Request) {
  if (!localRequest(req) || req.headers.get('x-frk-prod-proof') !== 'disposable') {
    return NextResponse.json({ error: 'Local disposable proof only.' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({})) as { action?: string; missionId?: string; mutationId?: string }
  if (body.action === 'library') return NextResponse.json(await runInstalledLibraryProof())
  if (body.action === 'resume' && body.missionId) return NextResponse.json(await resumeInstalledMissionSession(body.missionId))
  if (body.action === 'stamp' && body.missionId) return NextResponse.json(await stampInstalledMutation(body.missionId))
  if (body.action === 'replay' && body.missionId && body.mutationId) {
    return NextResponse.json(await replayInstalledMutation(body.missionId, body.mutationId))
  }
  return NextResponse.json({ error: 'Unknown proof action.' }, { status: 400 })
}
