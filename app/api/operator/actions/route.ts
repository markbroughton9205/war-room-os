import { NextResponse } from 'next/server'

import { collectOperatorDeck, handleOperatorAction, sanitizeOperatorCommand } from '@/lib/operator/deckPersistence'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const snapshot = await collectOperatorDeck(req)
  return NextResponse.json(
    {
      generatedAt: snapshot.generatedAt,
      actions: snapshot.actionQueue,
      guardrails: snapshot.guardrails,
    },
    {
      headers: {
        'cache-control': 'no-store',
        'x-war-room-operator-actions': snapshot.actionQueue.length ? 'available' : 'empty',
      },
    },
  )
}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, message: 'Invalid request.' }, { status: 400 })
  }

  const command = sanitizeOperatorCommand(body)
  if (!command) {
    return NextResponse.json({ ok: false, message: 'Unsupported operator action.' }, { status: 400 })
  }

  try {
    const result = await handleOperatorAction(req, command)
    return NextResponse.json(result, {
      status: result.ok ? 200 : 409,
      headers: {
        'cache-control': 'no-store',
        'x-war-room-operator-actions': result.persistenceAvailable ? 'available' : 'unavailable',
      },
    })
  } catch {
    return NextResponse.json(
      { ok: false, persistenceAvailable: false, message: 'Operator action could not be recorded.' },
      { status: 200, headers: { 'cache-control': 'no-store', 'x-war-room-operator-actions': 'unavailable' } },
    )
  }
}
