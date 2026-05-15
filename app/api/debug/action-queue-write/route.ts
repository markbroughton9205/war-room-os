import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertDebugRouteAuthorized } from '@/lib/security/debugRouteGuard'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const TABLE = 'war_room_actions'
const DEBUG_TYPE = '__war_room_action_queue_write_probe__'

type ProbeResult = {
  attemptedPayloadKeys: string[]
  success: boolean
  status: number | null
  code: string | null
  message: string
  details: string | null
  hint: string | null
}

function readPostgrestFields(err: unknown): {
  code: string | null
  message: string
  details: string | null
  hint: string | null
  status: number | null
} {
  if (!err || typeof err !== 'object') {
    return { code: null, message: 'Unknown error', details: null, hint: null, status: null }
  }
  const o = err as Record<string, unknown>
  const message = typeof o.message === 'string' ? o.message : 'Supabase request failed'
  const code = typeof o.code === 'string' ? o.code : null
  const details = typeof o.details === 'string' ? o.details : null
  const hint = typeof o.hint === 'string' ? o.hint : null
  let status: number | null = null
  if (typeof o.status === 'number' && Number.isFinite(o.status)) status = o.status
  else if (typeof o.statusCode === 'number' && Number.isFinite(o.statusCode)) status = o.statusCode
  return { code, message, details, hint, status }
}

async function runInsertProbe(): Promise<ProbeResult> {
  const attemptedPayloadKeys = ['type', 'payload', 'status', 'approval_granted', 'conversation_id']

  let client
  try {
    client = createSupabaseAdminClient()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Admin client configuration failed'
    return {
      attemptedPayloadKeys,
      success: false,
      status: null,
      code: 'config',
      message: msg,
      details: null,
      hint: 'Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service_role JWT) in the server environment.',
    }
  }

  const row = {
    type: DEBUG_TYPE,
    payload: {} as Record<string, unknown>,
    status: 'requested' as const,
    approval_granted: false,
    conversation_id: null as null,
  }

  const { data, error } = await client
    .from(TABLE)
    .insert(row)
    .select('id')
    .single()

  if (error) {
    const f = readPostgrestFields(error)
    return {
      attemptedPayloadKeys,
      success: false,
      status: f.status,
      code: f.code,
      message: f.message,
      details: f.details,
      hint: f.hint,
    }
  }

  const id = data && typeof data === 'object' && 'id' in data ? (data as { id: string }).id : null
  if (id) {
    const { error: delErr } = await client.from(TABLE).delete().eq('id', id)
    if (delErr) {
      const f = readPostgrestFields(delErr)
      return {
        attemptedPayloadKeys,
        success: false,
        status: f.status,
        code: f.code,
        message: `Insert succeeded but cleanup delete failed: ${f.message}`,
        details: f.details,
        hint: f.hint ?? 'Remove probe rows where type = __war_room_action_queue_write_probe__ manually if needed.',
      }
    }
  }

  return {
    attemptedPayloadKeys,
    success: true,
    status: 201,
    code: null,
    message: 'Minimal insert and delete completed successfully.',
    details: null,
    hint: null,
  }
}

function httpStatusForProbe(body: ProbeResult): number {
  if (body.success) return 200
  if (body.code === 'config') return 503
  if (body.status !== null && body.status >= 400 && body.status < 600) return body.status
  return 500
}

export async function GET(req: Request) {
  const denied = assertDebugRouteAuthorized(req)
  if (denied) return denied

  const body = await runInsertProbe()
  return NextResponse.json(body, { status: httpStatusForProbe(body) })
}

export async function POST(req: Request) {
  const denied = assertDebugRouteAuthorized(req)
  if (denied) return denied

  const body = await runInsertProbe()
  return NextResponse.json(body, { status: httpStatusForProbe(body) })
}
