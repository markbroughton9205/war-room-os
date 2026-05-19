import { insertWarRoomAuditLog } from '@/lib/war-room/auditLog'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'
import type { ProviderRuntimeId } from '@/lib/providers/health'
import type { ResponseIntegrityStatus } from '@/lib/providers/responseIntegrity'

function sanitizeReason(reason: string): string {
  return reason
    .replace(/sk-[a-zA-Z0-9_-]{8,}/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/api[_-]?key[=:]\s*\S+/gi, 'api_key=[redacted]')
    .slice(0, 280)
}

export async function logProviderIntegrityAudit(
  client: WarRoomSupabase | null,
  row: {
    provider: ProviderRuntimeId | string
    integrityStatus: ResponseIntegrityStatus | 'UNKNOWN'
    retryAttempt: number
    fallbackProvider?: ProviderRuntimeId | string | null
    reason: string
    family?: string
  },
): Promise<void> {
  const timestamp = new Date().toISOString()
  await insertWarRoomAuditLog(client, {
    actor: 'system',
    category: 'runtime',
    message: `provider_integrity:${row.provider}:${row.integrityStatus}`,
    metadata: {
      provider: row.provider,
      integrity_status: row.integrityStatus,
      retry_attempt: row.retryAttempt,
      fallback_provider: row.fallbackProvider ?? null,
      timestamp,
      reason: sanitizeReason(row.reason),
      ...(row.family ? { family: row.family } : {}),
    },
  })
}
