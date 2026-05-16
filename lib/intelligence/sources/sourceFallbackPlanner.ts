import type { PersistentSourceNode } from '@/lib/intelligence/sources/persistentSourceNetwork'
import type { SourceHealthRecord } from '@/lib/intelligence/sources/sourceHealthMonitor'

export type SourceFallbackPlan = {
  gaps: string[]
  fallback_source_ids: string[]
  confidenceDowngrade: number
}

export function planSourceFallbacks(args: {
  plannedSources: PersistentSourceNode[]
  health: SourceHealthRecord[]
}): SourceFallbackPlan {
  const healthById = new Map(args.health.map(record => [record.source_id, record]))
  const gaps: string[] = []
  const fallbackSourceIds: string[] = []
  let confidenceDowngrade = 0

  for (const source of args.plannedSources) {
    const health = healthById.get(source.source_id)
    if (!health || health.status === 'healthy') continue
    gaps.push(`${source.label}: ${health.status}${health.error ? ` (${health.error})` : ''}`)
    confidenceDowngrade += source.tier === 'local_regional' ? 0.08 : 0.04
  }

  const failedTiers = new Set(
    args.health
      .filter(record => record.status !== 'healthy')
      .map(record => record.tier),
  )
  for (const source of args.plannedSources) {
    if (source.configured && !failedTiers.has(source.tier)) fallbackSourceIds.push(source.source_id)
  }

  return {
    gaps: gaps.slice(0, 8),
    fallback_source_ids: [...new Set(fallbackSourceIds)].slice(0, 8),
    confidenceDowngrade: Math.min(0.35, confidenceDowngrade),
  }
}
