import { NextResponse } from 'next/server'
import { getMissionExecutionStrategy } from '@/lib/mission-runtime'
import type { EngineeringMissionRequest } from '@/lib/mission-runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Creates an Engineering Mission: inspection + proposal generation only — no filesystem mutation.
 * Same no-gate reasoning as lib/native-builder's own /repairs/[id]/plan route (see that file's
 * header comment): the dangerous-action gate applies at /approve, where a real patch is written.
 */
export async function POST(req: Request) {
  let body: Partial<EngineeringMissionRequest> = {}
  try {
    const raw = await req.json()
    if (raw !== null && typeof raw === 'object') body = raw
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  if (!body.title || !body.description || !body.subsystem) {
    return NextResponse.json({ error: 'title, description, and subsystem are required.' }, { status: 400 })
  }

  const strategy = getMissionExecutionStrategy('engineering')
  try {
    const mission = await strategy.create(body as EngineeringMissionRequest)
    return NextResponse.json({ mission })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
