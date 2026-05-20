import 'server-only'

import type { SignalRawItem } from '../model'
import { evaluateFreshness, maxAgeDaysForProvider, recordFreshness, createFreshnessCounters, freshnessDiagnostics, withFreshnessMetadata } from '../freshness'
import { isAllowedCloudUrl } from '../sources'
import type { ProviderRunResult } from '../providers'

type BraveWebResult = { title?: string; url?: string; description?: string; age?: string }
type BraveResponse = { web?: { results?: BraveWebResult[] } }

const BRAVE_QUERIES = [
  {
    query: 'Akron Ohio small business automation AI workflow demand 2026',
    sourceId: 'brave-smb-automation',
    sourceLabel: 'Brave SMB automation search',
    categories: ['SMB_automation', 'customer_operations', 'local_Akron'] as const,
  },
  {
    query: 'Ohio freight sprinter van local delivery logistics opportunities',
    sourceId: 'brave-freight-logistics',
    sourceLabel: 'Brave freight logistics search',
    categories: ['freight', 'sprinter_van', 'local_delivery', 'Ohio_business'] as const,
  },
  {
    query: 'remote AI evaluation data annotation gig jobs pay',
    sourceId: 'brave-ai-gigs',
    sourceLabel: 'Brave AI gig search',
    categories: ['job', 'gig', 'data_annotation', 'AI_evaluation'] as const,
  },
]

function compact(value: string, limit = 900): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > limit ? `${clean.slice(0, limit - 1)}...` : clean
}

export async function runBraveSignalSearch(capturedAt: string): Promise<ProviderRunResult> {
  const apiKey = process.env.BRAVE_API_KEY?.trim()
  if (!apiKey) {
    return { items: [], diagnostics: { configured: false, error: 'BRAVE_API_KEY is not configured' } }
  }

  const maxAgeDays = maxAgeDaysForProvider('tavily')
  const counters = createFreshnessCounters(maxAgeDays)

  const settled = await Promise.allSettled(BRAVE_QUERIES.map(async search => {
    const params = new URLSearchParams({ q: search.query, count: '4' })
    const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': apiKey,
      },
      signal: AbortSignal.timeout(14_000),
    })
    if (!response.ok) throw new Error(`Brave search failed (HTTP ${response.status})`)
    const data = await response.json() as BraveResponse
    return (data.web?.results ?? []).flatMap((result): SignalRawItem[] => {
      const title = String(result.title ?? '').trim()
      const url = String(result.url ?? '').trim()
      if (!title || !isAllowedCloudUrl(url)) return []
      const freshness = result.age
        ? evaluateFreshness(result.age, { maxAgeDays })
        : null
      if (freshness) {
        recordFreshness(counters, freshness)
        if (!freshness.acceptedForLiveSignal) return []
      }
      return [{
        provider: 'brave',
        sourceId: search.sourceId,
        sourceLabel: search.sourceLabel,
        sourceKind: 'search',
        title,
        url,
        summary: compact(String(result.description ?? title)),
        categories: [...search.categories],
        rawScore: 0.72,
        capturedAt,
        metadata: freshness
          ? withFreshnessMetadata({ query: search.query, provider: 'brave' }, freshness, capturedAt)
          : { query: search.query, maxAgeDays, signalIngestedAt: capturedAt, provider: 'brave' },
      }]
    })
  }))

  const items = settled.flatMap(r => r.status === 'fulfilled' ? r.value : [])
  const errors = settled
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map(r => r.reason instanceof Error ? r.reason.message : String(r.reason))

  return {
    items,
    diagnostics: {
      configured: true,
      queryCount: BRAVE_QUERIES.length,
      resultCount: items.length,
      ...freshnessDiagnostics(counters),
      failures: errors.length,
      firstError: errors[0] ?? null,
    },
  }
}
