import { requireCommanderSession } from '@/lib/security/commanderSession'
import { NextResponse } from 'next/server'
import { parseLaunchModelPolicy, FoundryLaunchPolicyError } from '@/lib/native-builder/foundryLaunchPolicy'
import { startMission } from '@/lib/native-builder/foundryMissionController'
import { WorkspaceBindingError } from '@/lib/native-builder/foundryWorkspaceBinding'
import { listMissions } from '@/lib/native-builder/foundryMissionStore'
import { toFoundryMissionCommanderView } from '@/lib/native-builder/foundryMissionView'
import { filterMissionsForView, parseFoundryMissionHistoryView } from '@/lib/native-builder/foundryMissionVisibility'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const commander = await requireCommanderSession('Foundry')
  if (!commander.ok) return commander.response
  const url = new URL(req.url)
  const requested = Number(url.searchParams.get('limit') ?? 30)
  const view = parseFoundryMissionHistoryView(url.searchParams.get('view'))
  return NextResponse.json({
    view,
    missions: filterMissionsForView(await listMissions(requested), view).map(toFoundryMissionCommanderView),
  })
}

export async function POST(req: Request) {
  const commander = await requireCommanderSession('Foundry')
  if (!commander.ok) return commander.response
  let body: { request?: string; title?: string; continueProjectId?: string; sessionId?: string; workspaceId?: string; modelPolicy?: unknown } = {}
  try {
    body = await req.json() as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (!body.request?.trim()) return NextResponse.json({ error: 'request is required.' }, { status: 400 })
  let mission
  try {
    mission = await startMission(body.request.trim(), body.title?.trim(), {
      modelPolicy: parseLaunchModelPolicy(body.modelPolicy),
      continueProjectId: body.continueProjectId?.trim() || null,
      sessionId: body.sessionId?.trim() || null,
      workspaceId: body.workspaceId?.trim() || null,
    })
  } catch (error) {
    if (error instanceof FoundryLaunchPolicyError) return NextResponse.json({ error: error.message, code: 'MODEL_POLICY_REJECTED' }, { status: 400 })
    if (error instanceof WorkspaceBindingError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    throw error
  }
  if (body.sessionId?.trim()) {
    const { attachMissionToSession, appendFoundryChat } = await import('@/lib/native-builder/foundrySessions')
    await attachMissionToSession(body.sessionId.trim(), mission.missionId)
    await appendFoundryChat(body.sessionId.trim(), 'COMMANDER', body.request.trim())
  }
  return NextResponse.json({ mission: toFoundryMissionCommanderView(mission) }, { status: 201 })
}
