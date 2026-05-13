import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabaseServer'

type Row = Record<string, unknown>

const VALID_STATUSES = new Set(['drafted', 'reviewing', 'ready', 'blocked', 'completed'])
const VALID_PRIORITIES = new Set(['low', 'medium', 'high'])

function stringOrDefault(value: unknown, fallback = '') {
  return String(value ?? fallback).trim()
}

function isSupabaseConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

function normalizeRow(row: Row) {
  return {
    id: stringOrDefault(row.id),
    request_id: stringOrDefault(row.request_id),
    title: stringOrDefault(row.title),
    description: row.description == null ? '' : stringOrDefault(row.description),
    type: stringOrDefault(row.type, 'feature') as 'feature' | 'bugfix' | 'refactor' | 'research' | 'deployment',
    status: stringOrDefault(row.status, 'drafted') as 'drafted' | 'reviewing' | 'ready' | 'blocked' | 'completed',
    assigned_agent: row.assigned_agent == null || row.assigned_agent === '' ? null : stringOrDefault(row.assigned_agent),
    priority: stringOrDefault(row.priority, 'medium') as 'low' | 'medium' | 'high',
    notes: row.notes == null ? null : stringOrDefault(row.notes),
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: row.updated_at ? String(row.updated_at) : undefined,
    completed_at: row.completed_at ? String(row.completed_at) : null,
  }
}

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      {
        error: 'Supabase is not configured for build requests.',
        hint: 'Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then apply supabase/build_requests.sql.',
      },
      { status: 503 },
    )
  }

  let supabase: ReturnType<typeof createSupabaseServerClient>
  try {
    supabase = createSupabaseServerClient()
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Supabase server client is not configured',
        hint: 'Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
      },
      { status: 503 },
    )
  }

  const { id } = await context.params
  const rowId = decodeURIComponent(stringOrDefault(id))
  if (!rowId) {
    return NextResponse.json({ error: 'id is required', hint: 'Use the build_requests row UUID in the path.' }, { status: 400 })
  }

  let body: Row
  try {
    body = (await req.json()) as Row
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body', hint: 'Send a JSON object with fields to update.' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}

  if (body.title !== undefined) {
    const t = stringOrDefault(body.title)
    if (!t) return NextResponse.json({ error: 'title cannot be empty', hint: 'Omit title or provide a non-empty string.' }, { status: 400 })
    updates.title = t
  }

  if (body.description !== undefined) {
    updates.description = body.description === null ? null : stringOrDefault(body.description)
  }

  if (body.notes !== undefined) {
    updates.notes = body.notes === null ? null : stringOrDefault(body.notes)
  }

  if (body.assigned_agent !== undefined) {
    updates.assigned_agent =
      body.assigned_agent === null || body.assigned_agent === '' ? null : stringOrDefault(body.assigned_agent)
  }

  if (body.priority !== undefined) {
    const p = stringOrDefault(body.priority)
    if (!VALID_PRIORITIES.has(p)) {
      return NextResponse.json(
        { error: 'Invalid priority', hint: `priority must be one of: ${[...VALID_PRIORITIES].join(', ')}` },
        { status: 400 },
      )
    }
    updates.priority = p
  }

  if (body.status !== undefined) {
    const s = stringOrDefault(body.status)
    if (!VALID_STATUSES.has(s)) {
      return NextResponse.json(
        { error: 'Invalid status', hint: `status must be one of: ${[...VALID_STATUSES].join(', ')}` },
        { status: 400 },
      )
    }
    updates.status = s
    updates.completed_at = s === 'completed' ? new Date().toISOString() : null
  }

  if (body.request_id !== undefined) {
    const rid = stringOrDefault(body.request_id)
    if (!rid) return NextResponse.json({ error: 'request_id cannot be empty', hint: 'Omit request_id or provide a unique slug.' }, { status: 400 })
    updates.request_id = rid
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: 'No updatable fields provided', hint: 'Send at least one of: title, description, notes, assigned_agent, priority, status, request_id.' },
      { status: 400 },
    )
  }

  const { data, error: updateError } = await supabase.from('build_requests').update(updates).eq('id', rowId).select('*').single()

  if (updateError) {
    const status = updateError.code === '23505' ? 409 : updateError.code === 'PGRST116' ? 404 : 500
    return NextResponse.json(
      {
        error: updateError.message,
        hint: status === 404 ? 'No row matched this id.' : status === 409 ? 'request_id must be unique.' : 'Update failed.',
      },
      { status },
    )
  }

  return NextResponse.json(normalizeRow(data as Row))
}
