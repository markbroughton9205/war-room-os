import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabaseServer'
import { SUPABASE_SERVICE_ROLE_ENV } from '@/lib/security/sensitiveEnv'

type Row = Record<string, unknown>

const PERSISTENCE_HEADER = 'x-war-room-build-requests-persistence'

const VALID_TYPES = new Set(['feature', 'bugfix', 'refactor', 'research', 'deployment'])
const VALID_STATUSES = new Set(['drafted', 'reviewing', 'ready', 'blocked', 'completed'])
const VALID_PRIORITIES = new Set(['low', 'medium', 'high'])

function stringOrDefault(value: unknown, fallback = '') {
  return String(value ?? fallback).trim()
}

function isSupabaseConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env[SUPABASE_SERVICE_ROLE_ENV])
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

async function allocateRequestId(supabase: ReturnType<typeof createSupabaseServerClient>) {
  const year = new Date().getUTCFullYear()
  const prefix = `BR-${year}-`
  const { data, error } = await supabase.from('build_requests').select('request_id').like('request_id', `${prefix}%`)

  if (error) throw new Error(error.message)

  let max = 0
  const re = new RegExp(`^BR-${year}-(\\d{1,6})$`)
  for (const row of data ?? []) {
    const m = re.exec(stringOrDefault((row as Row).request_id))
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`
}

export async function GET() {
  if (!isSupabaseConfigured()) {
    return new NextResponse(JSON.stringify([]), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        [PERSISTENCE_HEADER]: 'unavailable',
      },
    })
  }

  let supabase: ReturnType<typeof createSupabaseServerClient>
  try {
    supabase = createSupabaseServerClient()
  } catch {
    return new NextResponse(JSON.stringify([]), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        [PERSISTENCE_HEADER]: 'unavailable',
      },
    })
  }

  const { data, error: queryError } = await supabase
    .from('build_requests')
    .select('*')
    .order('created_at', { ascending: false })

  if (queryError) {
    return NextResponse.json(
      {
        error: queryError.message,
        hint: 'Ensure supabase/build_requests.sql has been applied and service role can access public.build_requests.',
      },
      { status: 500 },
    )
  }

  return new NextResponse(JSON.stringify((data ?? []).map((r) => normalizeRow(r as Row))), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      [PERSISTENCE_HEADER]: 'available',
    },
  })
}

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      {
        error: 'Supabase is not configured for build requests.',
        hint: 'Set NEXT_PUBLIC_SUPABASE_URL and the server-only Supabase role secret, then apply supabase/build_requests.sql.',
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
        hint: 'Set NEXT_PUBLIC_SUPABASE_URL and the server-only Supabase role secret.',
      },
      { status: 503 },
    )
  }

  let body: Row
  try {
    body = (await req.json()) as Row
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body', hint: 'Send a JSON object with at least title.' }, { status: 400 })
  }

  const title = stringOrDefault(body.title)
  if (!title) {
    return NextResponse.json({ error: 'title is required', hint: 'Provide a non-empty title string.' }, { status: 400 })
  }

  const typeRaw = stringOrDefault(body.type, 'feature')
  if (!VALID_TYPES.has(typeRaw)) {
    return NextResponse.json(
      { error: 'Invalid type', hint: `type must be one of: ${[...VALID_TYPES].join(', ')}` },
      { status: 400 },
    )
  }

  const statusRaw = stringOrDefault(body.status, 'drafted')
  if (!VALID_STATUSES.has(statusRaw)) {
    return NextResponse.json(
      { error: 'Invalid status', hint: `status must be one of: ${[...VALID_STATUSES].join(', ')}` },
      { status: 400 },
    )
  }

  const priorityRaw = stringOrDefault(body.priority, 'medium')
  if (!VALID_PRIORITIES.has(priorityRaw)) {
    return NextResponse.json(
      { error: 'Invalid priority', hint: `priority must be one of: ${[...VALID_PRIORITIES].join(', ')}` },
      { status: 400 },
    )
  }

  let requestId = stringOrDefault(body.request_id)
  if (!requestId) {
    try {
      requestId = await allocateRequestId(supabase)
    } catch (e) {
      return NextResponse.json(
        {
          error: e instanceof Error ? e.message : 'Could not allocate request_id',
          hint: 'Check that public.build_requests exists and is readable.',
        },
        { status: 500 },
      )
    }
  }

  const description = body.description === undefined || body.description === null ? null : stringOrDefault(body.description)
  const assigned =
    body.assigned_agent === undefined || body.assigned_agent === null || body.assigned_agent === ''
      ? null
      : stringOrDefault(body.assigned_agent)
  const notes = body.notes === undefined || body.notes === null ? null : stringOrDefault(body.notes)

  const insertRow = {
    request_id: requestId,
    title,
    description,
    type: typeRaw,
    status: statusRaw,
    assigned_agent: assigned,
    priority: priorityRaw,
    notes,
    ...(statusRaw === 'completed' ? { completed_at: new Date().toISOString() } : { completed_at: null }),
  }

  const { data, error: insertError } = await supabase.from('build_requests').insert([insertRow]).select('*').single()

  if (insertError) {
    const status = insertError.code === '23505' ? 409 : 500
    return NextResponse.json(
      {
        error: insertError.message,
        hint:
          status === 409
            ? 'request_id must be unique; omit request_id to auto-generate.'
            : 'Ensure supabase/build_requests.sql has been applied.',
      },
      { status },
    )
  }

  return NextResponse.json(normalizeRow(data as Row), { status: 201 })
}
