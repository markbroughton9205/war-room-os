/** Client-safe helpers for `/api/actions/queue` POST responses (no secrets). */

export type ActionQueuePostFailureBody = {
  error?: string
  persisted?: boolean
  queued?: boolean
  supabase?: { table?: string; message?: string; code?: string; httpStatus?: number }
}

export function isActionQueuePostSucceeded(
  res: Response,
  body: ActionQueuePostFailureBody,
): boolean {
  return res.status === 201 && body.persisted === true && body.queued === true
}

export function formatActionQueuePersistFailureMessage(body: ActionQueuePostFailureBody): string {
  const base = typeof body.error === 'string' && body.error.trim()
    ? body.error.trim()
    : 'Approval task could not be persisted.'
  const s = body.supabase
  if (!s || typeof s !== 'object') return base
  const table = typeof s.table === 'string' ? s.table : ''
  const code = typeof s.code === 'string' ? s.code : ''
  const hs = typeof s.httpStatus === 'number' ? String(s.httpStatus) : ''
  const detail = [table, code, hs].filter(Boolean).join(' · ')
  return detail ? `${base} (${detail})` : base
}
