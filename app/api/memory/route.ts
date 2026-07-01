import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { mapRawMemoryRuntimeState } from '@/lib/memory/runtimeState'

export async function POST(req: Request) {
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
    .insert([{ category, content }])
    .select()

  if (error) {
    const runtime = mapRawMemoryRuntimeState(error)
    return NextResponse.json({ error: runtime.commanderPhrase, runtime }, { status: 202 })
  }
  return NextResponse.json({ data })
}

export async function GET() {
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
