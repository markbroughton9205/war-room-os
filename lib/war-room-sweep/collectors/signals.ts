import 'server-only'

import { getRssIngestionRuntimeStatus } from '@/lib/signals/rss/runtime'
import { getSignalSources } from '@/lib/signals/sources'
import { sanitizeSchemaError } from '@/lib/schema-sweep/sanitize'
import type { SweepFinding } from '../types'

export async function collectSignalFindings(): Promise<SweepFinding[]> {
  const findings: SweepFinding[] = []
  const sources = getSignalSources()
  const unconfigured = sources.filter(source => !source.configured)
  for (const source of unconfigured) {
    findings.push({
      id: `sweep:signal:source:${source.id}`,
      title: `Signal source ${source.label} not configured`,
      category: 'signal_intelligence',
      severity: 'MEDIUM',
      evidence: [source.notes ?? 'Source marked unconfigured in registry.'],
      affectedFeature: 'Signal Radar',
      affectedPanel: 'Right Rail · Signal Radar',
      suggestedAction: 'Configure provider credentials or disable source until ready.',
      classification: 'fix',
      repairPacketAvailable: false,
    })
  }

  try {
    const rss = await getRssIngestionRuntimeStatus()
    if (rss.aggregateHealth !== 'healthy') {
      findings.push({
        id: 'sweep:signal:rss-aggregate',
        title: `RSS ingestion ${rss.aggregateHealth}`,
        category: 'signal_intelligence',
        severity: rss.aggregateHealth === 'unavailable' ? 'HIGH' : 'MEDIUM',
        evidence: [
          `Poll interval: ${rss.pollIntervalMinutes}m`,
          `Healthy feeds: ${rss.feeds.filter(f => f.health === 'healthy').length}/${rss.feeds.length}`,
        ],
        affectedFeature: 'News Intel',
        affectedPanel: 'Right Rail · Live Environment',
        suggestedAction: 'Check /api/signals/rss/status and feed URLs; verify cron/poll worker.',
        classification: 'fix',
        repairPacketAvailable: false,
      })
    }
    for (const feed of rss.feeds.filter(f => f.enabled && f.health !== 'healthy')) {
      findings.push({
        id: `sweep:signal:rss:${feed.sourceId}`,
        title: `${feed.label} feed ${feed.health}`,
        category: 'signal_intelligence',
        severity: feed.health === 'unavailable' ? 'HIGH' : 'MEDIUM',
        evidence: [
          feed.lastErrorMessage ? sanitizeSchemaError(feed.lastErrorMessage) : 'Feed unhealthy',
          feed.staleFeedDetection ? 'Stale feed detection active' : 'No successful poll recorded',
        ],
        affectedFeature: 'News Intel',
        affectedPanel: 'Live Environment · News',
        suggestedAction: 'Verify feed URL and ingestion worker; re-run RSS poll.',
        classification: 'fix',
        repairPacketAvailable: false,
        duplicateOf: findings.some(f => f.id === 'sweep:signal:rss-aggregate') ? 'sweep:signal:rss-aggregate' : undefined,
      })
    }
  } catch {
    findings.push({
      id: 'sweep:signal:rss-unavailable',
      title: 'RSS ingestion status unavailable',
      category: 'signal_intelligence',
      severity: 'MEDIUM',
      evidence: ['GET /api/signals/rss/status did not return a snapshot.'],
      affectedFeature: 'News Intel',
      affectedPanel: 'Right Rail · Live Environment',
      suggestedAction: 'Inspect RSS runtime module and server logs.',
      classification: 'fix',
      repairPacketAvailable: false,
    })
  }

  return findings
}
