import { NextResponse } from 'next/server'
import { resumeMission } from '@/lib/native-builder/foundryMissionController'
import { toFoundryMissionCommanderView } from '@/lib/native-builder/foundryMissionView'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    return NextResponse.json({ mission: toFoundryMissionCommanderView(await resumeMission(id)) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
