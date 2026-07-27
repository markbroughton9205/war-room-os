import { NextResponse } from 'next/server'
import { runGlobalIntelligenceMission } from '@/lib/native-builder/intelligenceMission'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  let body: { decreeText?: string; conversationId?: string } = {}
  try {
    const raw = await req.json()
    if (raw !== null && typeof raw === 'object') body = raw
  } catch {
    body = {}
  }
  if (!body.decreeText?.trim()) {
    return NextResponse.json({ error: 'decreeText is required.' }, { status: 400 })
  }

  const sup = tryWarRoomSupabase()
  const result = await runGlobalIntelligenceMission({
    decreeText: body.decreeText,
    supabase: sup.ok ? sup.client : null,
    conversationId: body.conversationId,
  })
  return NextResponse.json(result)
}
