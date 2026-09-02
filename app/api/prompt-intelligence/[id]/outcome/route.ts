import { NextResponse } from 'next/server'
import { recordPromptOutcome } from '@/lib/prompt-intelligence/persist'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'

const OUTCOMES = ['accepted', 'rejected', 'partial', 'unknown'] as const

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 503 })

  const { id } = await context.params
  let body: { outcome?: string; commanderNote?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const outcome = (OUTCOMES as readonly string[]).includes(body.outcome ?? '') ? (body.outcome as (typeof OUTCOMES)[number]) : null
  if (!outcome) return NextResponse.json({ error: `outcome must be one of: ${OUTCOMES.join(', ')}` }, { status: 400 })

  const recorded = await recordPromptOutcome(id, outcome, typeof body.commanderNote === 'string' ? body.commanderNote : undefined)
  if (!recorded) return NextResponse.json({ error: 'Failed to record prompt outcome.' }, { status: 500 })

  return NextResponse.json({ promptOutcome: recorded }, { status: 201 })
}
