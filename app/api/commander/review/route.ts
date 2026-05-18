import { NextResponse } from 'next/server'

import { COMMANDER_REVIEW_PERIODS, createCommanderReview, listCommanderSnapshot, type CommanderReviewPeriod } from '@/lib/commander'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function periodValue(value: unknown): CommanderReviewPeriod {
  return typeof value === 'string' && (COMMANDER_REVIEW_PERIODS as readonly string[]).includes(value)
    ? value as CommanderReviewPeriod
    : 'weekly'
}

export async function GET() {
  const snapshot = await listCommanderSnapshot()
  return NextResponse.json({
    generatedAt: snapshot.generatedAt,
    persistenceAvailable: snapshot.persistenceAvailable,
    persistenceNote: snapshot.persistenceNote,
    reviews: snapshot.reviews,
    trajectory: snapshot.trajectory,
    realityCorrectionAlerts: snapshot.realityCorrectionAlerts,
    guardrails: snapshot.guardrails,
  }, {
    headers: {
      'x-war-room-commander-persistence': snapshot.persistenceAvailable ? 'available' : 'unavailable',
    },
  })
}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Expected a JSON object.' }, { status: 400 })
  }

  const period = periodValue((body as Record<string, unknown>).period)
  try {
    const result = await createCommanderReview(period)
    return NextResponse.json(result, {
      status: 201,
      headers: {
        'x-war-room-commander-persistence': result.persistenceAvailable ? 'available' : 'unavailable',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Commander review generation failed.' },
      { status: 500 },
    )
  }
}
