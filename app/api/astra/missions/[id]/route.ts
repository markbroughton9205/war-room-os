import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { astraMissionPublicView } from '@/lib/astra/liveMission'
import { getAstraLiveMission } from '@/lib/astra/liveMission.store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const commander = await requireCommanderSession('ASTRA missions')
  if (!commander.ok) return commander.response
  const { id } = await context.params
  const mission = await getAstraLiveMission(id)
  if (!mission || mission.commanderUserId !== commander.userId) {
    return NextResponse.json({ error: 'ASTRA mission not found.' }, { status: 404 })
  }
  return NextResponse.json({ tool: 'astra-missions', status: 'success', mission: astraMissionPublicView(mission) })
}
