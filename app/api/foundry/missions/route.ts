import { NextResponse } from 'next/server'
import { startMission } from '@/lib/native-builder/foundryMissionController'
import { listMissions } from '@/lib/native-builder/foundryMissionStore'
import { toFoundryMissionCommanderView } from '@/lib/native-builder/foundryMissionView'
import { filterMissionsForView, parseFoundryMissionHistoryView } from '@/lib/native-builder/foundryMissionVisibility'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const requested = Number(url.searchParams.get('limit') ?? 30)
  const view = parseFoundryMissionHistoryView(url.searchParams.get('view'))
  return NextResponse.json({
    view,
    missions: filterMissionsForView(await listMissions(requested), view).map(toFoundryMissionCommanderView),
  })
}

export async function POST(req: Request) {
  let body: { request?: string; title?: string; continueProjectId?: string; sessionId?: string } = {}
  try {
    body = await req.json() as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (!body.request?.trim()) return NextResponse.json({ error: 'request is required.' }, { status: 400 })
  const mission = await startMission(body.request.trim(), body.title?.trim(), {
    continueProjectId: body.continueProjectId?.trim() || null,
    sessionId: body.sessionId?.trim() || null,
  })
  if (body.sessionId?.trim()) {
    const { attachMissionToSession, appendFoundryChat } = await import('@/lib/native-builder/foundrySessions')
    await attachMissionToSession(body.sessionId.trim(), mission.missionId)
    await appendFoundryChat(body.sessionId.trim(), 'COMMANDER', body.request.trim())
  }
  return NextResponse.json({ mission: toFoundryMissionCommanderView(mission) }, { status: 201 })
}
