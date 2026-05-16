import type { SourceNetworkTier } from '@/lib/intelligence/sources/sourceCategoryRegistry'
import type { PersistentSourceNode } from '@/lib/intelligence/sources/persistentSourceNetwork'
import { classifySourceFreshness, type SourceFreshnessRecord } from '@/lib/intelligence/sources/sourceFreshnessTracker'

export type SourceHealthStatus = 'healthy' | 'degraded' | 'unavailable' | 'unconfigured'

export type SourceHealthRecord = {
  source_id: string
  label: string
  tier: SourceNetworkTier
  status: SourceHealthStatus
  configured: boolean
  latency_ms: number | null
  success: boolean
  error?: string
  freshness: SourceFreshnessRecord
}

export function buildSourceHealthRecord(args: {
  source: PersistentSourceNode
  checkedAt: string
  success: boolean
  latencyMs?: number | null
  error?: string
}): SourceHealthRecord {
  const status: SourceHealthStatus =
    !args.source.configured
      ? 'unconfigured'
      : args.success
        ? 'healthy'
        : args.error
          ? 'unavailable'
          : 'degraded'

  return {
    source_id: args.source.source_id,
    label: args.source.label,
    tier: args.source.tier,
    status,
    configured: args.source.configured,
    latency_ms: args.latencyMs ?? null,
    success: args.success,
    ...(args.error ? { error: args.error } : {}),
    freshness: classifySourceFreshness(args.source, args.checkedAt, args.success ? args.checkedAt : undefined),
  }
}

export function summarizeSourceHealth(records: SourceHealthRecord[]) {
  return {
    checked: records.length,
    healthy: records.filter(record => record.status === 'healthy').length,
    degraded: records.filter(record => record.status === 'degraded').length,
    unavailable: records.filter(record => record.status === 'unavailable').length,
    unconfigured: records.filter(record => record.status === 'unconfigured').length,
    stale: records.filter(record => record.freshness.stale).length,
  }
}
