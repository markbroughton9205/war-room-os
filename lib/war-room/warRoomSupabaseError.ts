export type WarRoomSupabaseFailurePayload = {
  table: string
  operation?: string
  message: string
  code?: string
  httpStatus?: number
  details?: string
  hint?: string
}

function readNumeric(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return undefined
}

/** Shape Supabase/PostgREST errors for API JSON (no secrets). */
export function warRoomSupabaseFailurePayload(
  table: string,
  err: unknown,
  options?: { operation?: string },
): WarRoomSupabaseFailurePayload {
  const operation = options?.operation
  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>
    const message =
      typeof o.message === 'string'
        ? o.message
        : err instanceof Error
          ? err.message
          : 'Supabase request failed'
    const code = typeof o.code === 'string' ? o.code : undefined
    const details = typeof o.details === 'string' ? o.details : undefined
    const hint = typeof o.hint === 'string' ? o.hint : undefined
    const httpStatus = readNumeric(o, ['status', 'statusCode'])
    return { table, operation, message, code, httpStatus, details, hint }
  }
  if (err instanceof Error) {
    return { table, operation, message: err.message }
  }
  return { table, operation, message: 'Supabase request failed' }
}

export function httpStatusForSupabaseFailure(payload: WarRoomSupabaseFailurePayload, fallback: number): number {
  if (typeof payload.httpStatus === 'number' && payload.httpStatus >= 400 && payload.httpStatus < 600) {
    return payload.httpStatus
  }
  return fallback
}
