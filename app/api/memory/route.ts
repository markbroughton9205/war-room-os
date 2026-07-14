import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { mapRawMemoryRuntimeState } from '@/lib/memory/runtimeState'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { assertLiveActionsAllowed } from '@/lib/security/actionRoutePolicy'

export async function POST(req: Request) {
  const environmentBlocked = assertLiveActionsAllowed()
  if (environmentBlocked) return environmentBlocked

  const commander = await requireCommanderSession('Memory save')
  if (!commander.ok) return commander.response

  let supabase
  try {
    supabase = createSupabaseAdminClient()
  } catch (error) {
    const runtime = mapRawMemoryRuntimeState(error, { configured: false })
    return NextResponse.json({ error: runtime.commanderPhrase, runtime }, { status: 202 })
  }

  const { category, content } = await req.json()

  const { data, error } = await supabase
    .from('memories')
    .insert([{
      category,
      content,
      created_by_user_id: commander.userId,
      ownership_authority_basis: 'authenticated_commander_session',
    }])
    .select()

  if (error) {
    const runtime = mapRawMemoryRuntimeState(error)
    return NextResponse.json({ error: runtime.commanderPhrase, runtime }, { status: 202 })
  }
  return NextResponse.json({ data })
}

export async function GET() {
  const environmentBlocked = assertLiveActionsAllowed()
  if (environmentBlocked) return environmentBlocked

  const commander = await requireCommanderSession('Memory read')
  if (!commander.ok) return commander.response

  let supabase
  try {
    supabase = createSupabaseAdminClient()
  } catch (error) {
    const runtime = mapRawMemoryRuntimeState(error, { configured: false })
    return NextResponse.json({ error: runtime.commanderPhrase, runtime, data: [] })
  }

  const { data, error } = await supabase
    .from('memories')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    const runtime = mapRawMemoryRuntimeState(error)
    return NextResponse.json({ error: runtime.commanderPhrase, runtime, data: [] })
  }
  return NextResponse.json({ data })
}
