import { NextResponse } from 'next/server'

import { runRssIngestionPoll } from '@/lib/signals/rss/runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function authorizePoll(req: Request): { ok: true } | { ok: false; status: number; error: string } {
  const secret = process.env.WAR_ROOM_RSS_POLL_SECRET?.trim()
  if (!secret) return { ok: true }
  const auth = req.headers.get('authorization')?.trim()
  if (auth === `Bearer ${secret}`) return { ok: true }
  return { ok: false, status: 401, error: 'Unauthorized RSS poll request.' }
}

export async function GET() {
  return NextResponse.json({
    error: 'Use POST to run server-side RSS ingestion poll.',
    approvalRequired: true,
    canExecuteExternalActions: false,
  }, { status: 405 })
}

export async function POST(req: Request) {
  const gate = authorizePoll(req)
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error, approvalRequired: true }, { status: gate.status })
  }

  try {
    const url = new URL(req.url)
    const force = url.searchParams.get('force') === '1'
    const result = await runRssIngestionPoll({ force })
    return NextResponse.json(result, {
      status: result.ok ? 200 : 503,
      headers: {
        'cache-control': 'no-store',
        'x-war-room-rss-poll': result.ok ? 'completed' : 'degraded',
        'x-war-room-rss-persistence': result.persistenceAvailable ? 'available' : 'unavailable',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'RSS ingestion poll failed.'
    return NextResponse.json(
      {
        error: message,
        approvalRequired: true,
        canExecuteExternalActions: false,
      },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    )
  }
}
