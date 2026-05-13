import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabaseServer'

type MemoryEntry = {
  id?: string
  content: string
  source?: string
  family?: string
  tags?: string[]
  importance?: number
  created_at?: string
}

function normalizeMemory(row: Record<string, unknown>): MemoryEntry {
  return {
    id: String(row.id ?? ''),
    content: String(row.content ?? ''),
    source: String(row.source ?? row.category ?? 'war-room'),
    family: String(row.family ?? 'SYSTEM'),
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    importance: Number(row.importance ?? 1),
    created_at: String(row.created_at ?? new Date().toISOString()),
  }
}

export async function GET(req: Request) {
  const healthOnly = new URL(req.url).searchParams.get('health') === '1'

  let supabase
  try {
    supabase = createSupabaseServerClient()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Supabase server client is not configured'
    if (healthOnly) {
      return NextResponse.json({
        tool: 'memory',
        healthy: false,
        status: 'error',
        message,
      }, { status: 503 })
    }
    return NextResponse.json({
      tool: 'memory',
      status: 'error',
      message,
      memories: [],
    }, { status: 500 })
  }

  if (healthOnly) {
    const { error } = await supabase
      .from('memories')
      .select('id')
      .limit(1)

    if (error) {
      const fallback = await supabase.from('memories').select('id').limit(1)
      if (fallback.error) {
        return NextResponse.json({
          tool: 'memory',
          healthy: false,
          status: 'error',
          message: fallback.error.message,
        }, { status: 500 })
      }
    }

    return NextResponse.json({
      tool: 'memory',
      healthy: true,
      status: 'complete',
      message: 'Memory store reachable.',
    })
  }

  const { data, error } = await supabase
    .from('memories')
    .select('id, content, source, family, tags, importance, created_at')
    .order('created_at', { ascending: false })
    .limit(10)

  if (!error) {
    return NextResponse.json({
      tool: 'memory',
      status: 'complete',
      memories: (data ?? []).map(normalizeMemory),
    })
  }

  const fallback = await supabase
    .from('memories')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10)

  if (fallback.error) {
    return NextResponse.json({
      tool: 'memory',
      status: 'error',
      message: fallback.error.message,
      memories: [],
    }, { status: 500 })
  }

  return NextResponse.json({
    tool: 'memory',
    status: 'complete',
    memories: (fallback.data ?? []).map(normalizeMemory),
  })
}

export async function POST(req: Request) {
  let supabase
  try {
    supabase = createSupabaseServerClient()
  } catch (error) {
    return NextResponse.json({
      tool: 'memory',
      status: 'error',
      message: error instanceof Error ? error.message : 'Supabase server client is not configured',
    }, { status: 500 })
  }

  const body = await req.json()
  const memory: MemoryEntry = {
    content: String(body.content ?? '').trim(),
    source: String(body.source ?? 'war-room'),
    family: String(body.family ?? 'SYSTEM'),
    tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
    importance: Number(body.importance ?? 1),
  }

  if (!memory.content) {
    return NextResponse.json({
      tool: 'memory',
      status: 'error',
      message: 'Memory content is required',
    }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('memories')
    .insert([memory])
    .select('id, content, source, family, tags, importance, created_at')
    .single()

  if (!error) {
    return NextResponse.json({
      tool: 'memory',
      status: 'complete',
      message: 'Memory saved',
      memory: normalizeMemory(data as Record<string, unknown>),
    })
  }

  const fallback = await supabase
    .from('memories')
    .insert([{ category: memory.source, content: memory.content }])
    .select('*')
    .single()

  if (fallback.error) {
    return NextResponse.json({
      tool: 'memory',
      status: 'error',
      message: fallback.error.message,
    }, { status: 500 })
  }

  return NextResponse.json({
    tool: 'memory',
    status: 'complete',
    message: 'Memory saved',
    memory: {
      ...normalizeMemory(fallback.data as Record<string, unknown>),
      source: memory.source,
      family: memory.family,
      tags: memory.tags,
      importance: memory.importance,
    },
  })
}
