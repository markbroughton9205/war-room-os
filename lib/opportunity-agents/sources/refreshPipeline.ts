import { getOpportunitySourceAdapter } from './adapters'
import type { NormalizedOpportunitySourceRecord, SourceRefreshResult } from './types'

export const OPPORTUNITY_REFRESH_STAGES = [
  'SOURCE_SELECT', 'CONNECTION_CHECK', 'RETRIEVE', 'NORMALIZE', 'DUPLICATE_CHECK', 'FRESHNESS_CHECK', 'QUALIFY', 'REVENUE_ANALYSIS', 'PERSIST', 'DISPLAY',
] as const

const seenFingerprints = new Set<string>()

export type RefreshPipelineResult = SourceRefreshResult & {
  stages: typeof OPPORTUNITY_REFRESH_STAGES[number][]
  persistence: 'session_only' | 'durable_disabled'
  requestedRefreshIsSuccess: false
}

export function isActionableSourceOpportunity(record: NormalizedOpportunitySourceRecord): boolean {
  return record.isActive === true
    && record.evidenceStatus === 'LIVE_VERIFIED'
    && Boolean(record.deadline)
    && Boolean(record.url || record.sourceReference)
}

export async function runSourceRefreshPipeline(sourceId: string, input?: { query?: string; limit?: number; maxPages?: number; maxRecords?: number }): Promise<RefreshPipelineResult> {
  const adapter = getOpportunitySourceAdapter(sourceId)
  const result = await adapter.refresh(input)
  const accepted: NormalizedOpportunitySourceRecord[] = []
  let duplicates = result.duplicates
  for (const record of result.records) {
    if (seenFingerprints.has(record.dedupeFingerprint)) {
      duplicates += 1
    } else {
      seenFingerprints.add(record.dedupeFingerprint)
      accepted.push(record)
    }
  }
  return {
    ...result,
    records: accepted,
    accepted: accepted.length,
    duplicates,
    stages: [...OPPORTUNITY_REFRESH_STAGES],
    persistence: 'durable_disabled',
    requestedRefreshIsSuccess: false,
  }
}

export function __resetSourceRefreshDedupeForTests(): void {
  seenFingerprints.clear()
}
