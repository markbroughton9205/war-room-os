import { NextResponse } from 'next/server'
import { pauseMission } from '@/lib/native-builder/foundryMissionController'
import { toFoundryMissionCommanderView } from '@/lib/native-builder/foundryMissionView'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let reason = 'Commander paused'
  try {
    const body = await req.json() as { reason?: string }
    if (body.reason?.trim()) reason = body.reason.trim()
  } catch {
    /* no body */
  }
  try {
    return NextResponse.json({ mission: toFoundryMissionCommanderView(await pauseMission(id, reason)) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
