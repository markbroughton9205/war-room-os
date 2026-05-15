/** Client-safe helpers for `/api/actions/queue` POST responses (no secrets). */

export type ActionQueuePostFailureBody = {
  error?: string
  persisted?: boolean
  queued?: boolean
  supabase?: {
    table?: string
    operation?: string
    message?: string
    code?: string
    httpStatus?: number
    details?: string
    hint?: string
  }
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
  const op = typeof s.operation === 'string' ? s.operation : ''
  const details = typeof s.details === 'string' && s.details.trim() ? s.details.trim().slice(0, 200) : ''
  const hint = typeof s.hint === 'string' && s.hint.trim() ? s.hint.trim().slice(0, 200) : ''
  const parts = [table, op, code, hs].filter(Boolean).join(' · ')
  const extra = [details && `details: ${details}`, hint && `hint: ${hint}`].filter(Boolean).join(' — ')
  if (parts && extra) return `${base} (${parts}; ${extra})`
  if (parts) return `${base} (${parts})`
  if (extra) return `${base} (${extra})`
  return base
}
