import { NextResponse } from 'next/server'

import { buildRepairPacketFromFinding } from '@/lib/war-room-sweep/repairPacket'
import { runWarRoomOsSweep } from '@/lib/war-room-sweep/orchestrator'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  return sweepResponse(req)
}

export async function POST(req: Request) {
  return sweepResponse(req)
}

async function sweepResponse(req: Request) {
  try {
    const report = await runWarRoomOsSweep(req)
    return NextResponse.json(report, {
      headers: {
        'cache-control': 'no-store',
        'x-war-room-os-sweep': 'complete',
        'x-war-room-readiness': String(report.summary.readinessScore),
        'x-war-room-db-mutation': 'false',
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'War Room OS sweep failed.',
        generatedAt: new Date().toISOString(),
      },
      {
        status: 503,
        headers: { 'cache-control': 'no-store', 'x-war-room-os-sweep': 'error', 'x-war-room-db-mutation': 'false' },
      },
    )
  }
}

/** POST with ?findingId=... returns a repair packet for one finding. */
export async function PATCH(req: Request) {
  const url = new URL(req.url)
  const findingId = url.searchParams.get('findingId')
  if (!findingId) {
    return NextResponse.json({ error: 'findingId required' }, { status: 400 })
  }
  try {
    const report = await runWarRoomOsSweep(req)
    const finding = report.findings.find(f => f.id === findingId)
    if (!finding) {
      return NextResponse.json({ error: 'Finding not found in latest sweep' }, { status: 404 })
    }
    const repairPacket = buildRepairPacketFromFinding(finding)
    return NextResponse.json({ repairPacket, findingId }, {
      headers: { 'cache-control': 'no-store', 'x-war-room-db-mutation': 'false' },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Repair packet generation failed.' },
      { status: 503 },
    )
  }
}
