import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export type WarRoomSupabase = ReturnType<typeof createSupabaseAdminClient>

export type WarRoomSupabaseResult =
  | { ok: true; client: WarRoomSupabase }
  | { ok: false; configError: string }

export function tryWarRoomSupabase(): WarRoomSupabaseResult {
  try {
    return { ok: true, client: createSupabaseAdminClient() }
  } catch (e) {
    const configError =
      e instanceof Error ? e.message : 'Supabase admin client could not be created (check server env).'
    return { ok: false, configError }
  }
}

export function persistenceHeaders(available: boolean): Record<string, string> {
  return { 'x-war-room-persistence': available ? 'available' : 'unavailable' }
}

export function jsonWithPersistence<T>(body: T, available: boolean, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set('x-war-room-persistence', available ? 'available' : 'unavailable')
  return NextResponse.json(body, { ...init, headers })
}

/** Same as jsonWithPersistence but never throws — logs serialization issues server-side. */
export function jsonWithPersistenceSafe<T>(body: T, available: boolean, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set('x-war-room-persistence', available ? 'available' : 'unavailable')
  headers.set('content-type', 'application/json')
  try {
    const payload = JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
    return new NextResponse(payload, { ...init, headers })
  } catch (err) {
    console.error('[war-room] jsonWithPersistenceSafe failed:', err instanceof Error ? err.message : err)
    const fallback = JSON.stringify({ error: 'Response serialization failed' })
    const errHeaders = new Headers()
    errHeaders.set('content-type', 'application/json')
    errHeaders.set('x-war-room-persistence', available ? 'available' : 'unavailable')
    return new NextResponse(fallback, { status: 500, headers: errHeaders })
  }
}
