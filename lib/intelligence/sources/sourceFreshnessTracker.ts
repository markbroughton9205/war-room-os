import type { EvidenceFreshness } from '@/lib/intelligence/intelligencePacket'
import type { PersistentSourceNode } from '@/lib/intelligence/sources/persistentSourceNetwork'

export type SourceFreshnessRecord = {
  source_id: string
  checked_at: string
  freshness: EvidenceFreshness
  age_minutes: number | null
  stale: boolean
}

export function classifySourceFreshness(source: PersistentSourceNode, checkedAt: string, observedAt?: string): SourceFreshnessRecord {
  const checked = Date.parse(checkedAt)
  const observed = observedAt ? Date.parse(observedAt) : NaN
  const ageMinutes = Number.isFinite(checked) && Number.isFinite(observed)
    ? Math.max(0, Math.round((checked - observed) / 60_000))
    : null
  const freshness: EvidenceFreshness =
    ageMinutes === null
      ? 'unknown'
      : ageMinutes <= Math.min(60, source.freshness_window_minutes)
        ? 'live'
        : ageMinutes <= source.freshness_window_minutes
          ? 'recent'
          : ageMinutes <= source.freshness_window_minutes * 4
            ? 'aging'
            : 'stale'

  return {
    source_id: source.source_id,
    checked_at: checkedAt,
    freshness,
    age_minutes: ageMinutes,
    stale: freshness === 'stale' || freshness === 'unknown',
  }
}
