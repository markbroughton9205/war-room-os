import { NextResponse } from 'next/server'

import { logOperatorEarnings, sanitizeLogEarnings } from '@/lib/operator/deckPersistence'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, message: 'Invalid request.' }, { status: 400 })
  }

  const input = sanitizeLogEarnings(body)
  if (!input) {
    return NextResponse.json({ ok: false, message: 'Amount earned, time spent, and mission are required.' }, { status: 400 })
  }

  try {
    const result = await logOperatorEarnings(req, input)
    return NextResponse.json(result, {
      status: result.ok ? 201 : 409,
      headers: {
        'cache-control': 'no-store',
        'x-war-room-operator-earnings': result.persistenceAvailable ? 'available' : 'unavailable',
      },
    })
  } catch {
    return NextResponse.json(
      { ok: false, persistenceAvailable: false, message: 'Earnings could not be logged.' },
      { status: 200, headers: { 'cache-control': 'no-store', 'x-war-room-operator-earnings': 'unavailable' } },
    )
  }
}
