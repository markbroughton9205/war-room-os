import { NextResponse } from 'next/server'
import { loadMission } from '@/lib/native-builder/foundryMissionStore'
import { toFoundryMissionCommanderView } from '@/lib/native-builder/foundryMissionView'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const mission = await loadMission(id)
  if (!mission) return NextResponse.json({ error: 'Mission not found.' }, { status: 404 })
  return NextResponse.json({ mission: toFoundryMissionCommanderView(mission) })
}
