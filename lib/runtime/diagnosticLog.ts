import type { WarRoomSupabase } from '@/lib/war-room/persistence'

export type WarRoomRuntimeIntegrityLogRow = {
  subsystem: string
  severity: string
  source_family?: string | null
  evidence?: Record<string, unknown>
  recommendation?: string | null
  diagnostic_mode?: string | null
}

/**
 * Fire-and-forget insert for runtime integrity / diagnostic events.
 * Uses service-role client when available; never throws to callers.
 */
export function insertDiagnosticEvent(client: WarRoomSupabase | null, row: WarRoomRuntimeIntegrityLogRow): void {
  if (!client) return
  void (async () => {
    try {
      const { error } = await client.from('war_room_runtime_integrity_logs').insert({
        subsystem: row.subsystem,
        severity: row.severity,
        source_family: row.source_family ?? null,
        evidence: row.evidence && typeof row.evidence === 'object' ? row.evidence : {},
        recommendation: row.recommendation ?? null,
        diagnostic_mode: row.diagnostic_mode ?? null,
      })
      if (error) console.warn('[war-room-runtime-integrity-logs] insert failed:', error.message)
    } catch (err: unknown) {
      console.warn(
        '[war-room-runtime-integrity-logs] insert failed:',
        err instanceof Error ? err.message : String(err),
      )
    }
  })()
}
