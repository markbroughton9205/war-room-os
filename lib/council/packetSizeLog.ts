import { insertWarRoomAuditLog } from '@/lib/war-room/auditLog'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'
import { isCouncilStabilityMode } from '@/lib/council/stabilityMode'

export type CouncilPacketMetrics = {
  route: string
  provider?: string
  promptCharCount?: number
  contextCharCount?: number
  providerResponseCharCount?: number
  integrityRejectionReason?: string | null
  timedOut?: boolean
  fallbackUsed?: boolean
  councilStabilityMode?: boolean
}

function sanitizeMetricValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value !== 'string') return null
  return value
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[a-zA-Z0-9_-]{8,}\b/gi, '[redacted]')
    .replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .slice(0, 400)
}

function buildSanitizedPayload(metrics: CouncilPacketMetrics): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metrics)) {
    const clean = sanitizeMetricValue(value)
    if (clean !== null) out[key] = clean
  }
  return out
}

/** Sanitized packet size / integrity metrics — console in dev, audit log when Supabase is available. */
export async function logCouncilPacketMetrics(
  client: WarRoomSupabase | null,
  metrics: CouncilPacketMetrics,
): Promise<void> {
  const payload = buildSanitizedPayload({
    ...metrics,
    councilStabilityMode: metrics.councilStabilityMode ?? isCouncilStabilityMode(),
  })

  const shouldLog = isCouncilStabilityMode() || process.env.NODE_ENV === 'development'
  if (!shouldLog) return

  console.info('[council-packet-metrics]', payload)

  try {
    await insertWarRoomAuditLog(client, {
      actor: 'system',
      category: 'runtime',
      message: 'Council packet metrics',
      metadata: {
        kind: 'council_packet_metrics',
        ...payload,
      },
    })
  } catch (err) {
    console.warn('[council-packet-metrics] audit insert failed:', err)
  }
}
