import { NextResponse } from 'next/server'
import { resolveMissionAuthorization } from '@/lib/native-builder/foundryMissionController'
import { toFoundryMissionCommanderView } from '@/lib/native-builder/foundryMissionView'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: {
    approved?: boolean
    expectedSpecVersion?: string
    expectedMissionContractHash?: string
    expectedAcceptanceContractHash?: string
    expectedMissionContractId?: string
    expectedAcceptanceContractId?: string
  } = {}
  try {
    body = await req.json() as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (typeof body.approved !== 'boolean') {
    return NextResponse.json({ error: 'approved boolean is required.' }, { status: 400 })
  }
  try {
    const result = await resolveMissionAuthorization(id, body.approved, {
      specVersion: body.expectedSpecVersion,
      missionContractHash: body.expectedMissionContractHash,
      acceptanceContractHash: body.expectedAcceptanceContractHash,
      missionContractId: body.expectedMissionContractId,
      acceptanceContractId: body.expectedAcceptanceContractId,
    })
    return NextResponse.json({
      ok: result.ok,
      mission: toFoundryMissionCommanderView(result.mission),
      error: result.error,
    }, { status: result.ok ? 200 : 409 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
