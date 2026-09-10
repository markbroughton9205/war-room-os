import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { astraMissionPublicView, createAstraLiveMission } from '@/lib/astra/liveMission'
import { listAstraLiveMissions, saveAstraLiveMission } from '@/lib/astra/liveMission.store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const commander = await requireCommanderSession('ASTRA missions')
  if (!commander.ok) return commander.response
  const missions = (await listAstraLiveMissions(commander.userId)).map(astraMissionPublicView)
  return NextResponse.json({ tool: 'astra-missions', status: 'success', missions })
}

export async function POST(request: Request) {
  const commander = await requireCommanderSession('ASTRA missions')
  if (!commander.ok) return commander.response
  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const mission = createAstraLiveMission({
    commanderUserId: commander.userId,
    objective: typeof body.objective === 'string' ? body.objective : '',
    terraSeed: body.terraSeed,
    observedVessel: body.observedVessel,
  })
  if (!mission) {
    return NextResponse.json({
      error: 'ASTRA mission was not created. Provide an explicit Commander objective. Selecting a Terra object does not create a mission.',
    }, { status: 400 })
  }
  const stored = await saveAstraLiveMission(mission)
  return NextResponse.json({
    tool: 'astra-missions',
    status: 'created',
    mission: astraMissionPublicView(stored),
  }, { status: 201 })
}
