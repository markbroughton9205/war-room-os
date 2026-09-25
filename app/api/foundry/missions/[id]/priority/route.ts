import { NextResponse } from 'next/server'
import { setMissionPriority } from '@/lib/native-builder/foundryMissionController'
import { toFoundryMissionCommanderView } from '@/lib/native-builder/foundryMissionView'
import { isFoundryMissionPriority } from '@/lib/native-builder/foundryOperationsTypes'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: { priority?: string } = {}
  try {
    body = await req.json() as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (!isFoundryMissionPriority(body.priority)) {
    return NextResponse.json({ error: 'priority must be CRITICAL, HIGH, NORMAL, or LOW.' }, { status: 400 })
  }
  try {
    return NextResponse.json({ mission: toFoundryMissionCommanderView(await setMissionPriority(id, body.priority)) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
