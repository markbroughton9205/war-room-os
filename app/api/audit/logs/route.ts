import { timingSafeEqual } from 'node:crypto'

import { isWarRoomAuditCategory } from '@/lib/war-room/auditLog'
import { jsonWithPersistence, jsonWithPersistenceSafe, tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'

function timingSafeEqualUtf8(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'utf8')
    const bb = Buffer.from(b, 'utf8')
    if (ba.length !== bb.length) return false
    return timingSafeEqual(ba, bb)
  } catch {
    return false
  }
}

function parseLimit(raw: string | null): number {
  const n = raw ? Number.parseInt(raw, 10) : 50
  if (!Number.isFinite(n) || n < 1) return 50
  return Math.min(n, 500)
}

function parseOffset(raw: string | null): number {
  const n = raw ? Number.parseInt(raw, 10) : 0
  if (!Number.isFinite(n) || n < 0) return 0
  return n
}

export async function GET(req: Request) {
  try {
    const sup = tryWarRoomSupabase()
    if (!sup.ok) {
      return jsonWithPersistence({ logs: [], error: 'Supabase is not configured.' }, false, { status: 503 })
    }

    const url = new URL(req.url)
    const limit = parseLimit(url.searchParams.get('limit'))
    const offset = parseOffset(url.searchParams.get('offset'))
    const category = url.searchParams.get('category')?.trim()

    let q = sup.client
      .from('war_room_audit_logs')
      .select('id,created_at,actor,category,action_id,metadata,message')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (category && isWarRoomAuditCategory(category)) {
      q = q.eq('category', category)
    }

    const { data, error } = await q

    if (error) {
      return jsonWithPersistence({ logs: [], error: error.message }, true, { status: 500 })
    }

    return jsonWithPersistenceSafe({ logs: data ?? [], limit, offset }, true)
  } catch (err) {
    console.error('[api/audit/logs] GET', err instanceof Error ? err.message : err)
    return jsonWithPersistence({ logs: [], error: 'Internal server error' }, false, { status: 500 })
  }
}

/** Optional internal ingest; requires WAR_ROOM_AUDIT_POST_SECRET when set. */
export async function POST(req: Request) {
  try {
    const secret = process.env.WAR_ROOM_AUDIT_POST_SECRET?.trim()
    if (!secret) {
      return jsonWithPersistence({ error: 'Audit POST ingest is not enabled.' }, false, { status: 503 })
    }

    const auth = req.headers.get('authorization')?.trim()
    const provided = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null
    if (!provided || !timingSafeEqualUtf8(secret, provided)) {
      return jsonWithPersistence({ error: 'Unauthorized.' }, false, { status: 401 })
    }

    const sup = tryWarRoomSupabase()
    if (!sup.ok) {
      return jsonWithPersistence({ error: 'Supabase is not configured.' }, false, { status: 503 })
    }

    let body: {
      actor?: string
      category?: string
      message?: string
      metadata?: Record<string, unknown>
      action_id?: string | null
    }
    try {
      body = await req.json()
    } catch {
      return jsonWithPersistence({ error: 'Invalid JSON body.' }, true, { status: 400 })
    }

    const actor = body.actor === 'user' ? 'user' : 'system'
    const category = typeof body.category === 'string' && isWarRoomAuditCategory(body.category)
      ? body.category
      : null
    const message = typeof body.message === 'string' ? body.message.trim() : ''

    if (!category || !message) {
      return jsonWithPersistence({ error: 'category and message are required.' }, true, { status: 400 })
    }

    const { error: insertErr } = await sup.client.from('war_room_audit_logs').insert({
      actor,
      category,
      action_id: typeof body.action_id === 'string' ? body.action_id : null,
      message,
      metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
    })
    if (insertErr) {
      console.error('[api/audit/logs] POST insert', insertErr.message)
      return jsonWithPersistence({ error: insertErr.message }, true, { status: 500 })
    }

    return jsonWithPersistence({ ok: true }, true, { status: 201 })
  } catch (err) {
    console.error('[api/audit/logs] POST', err instanceof Error ? err.message : err)
    return jsonWithPersistence({ error: 'Internal server error' }, false, { status: 500 })
  }
}
