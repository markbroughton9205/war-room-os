import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { mapRawMemoryRuntimeState } from '@/lib/memory/runtimeState'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(req: Request) {
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
