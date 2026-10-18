import { createHash } from 'node:crypto'

/** Stable event identity: the same source fact always yields the same id, so re-ingestion is idempotent. */
export function stableEventId(...parts: (string | number | undefined)[]): string {
  return 'ev-' + createHash('sha256').update(parts.map((p) => String(p ?? '')).join('|')).digest('hex').slice(0, 24)
}
