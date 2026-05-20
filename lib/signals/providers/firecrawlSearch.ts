import 'server-only'

import type { SignalRawItem } from '../model'
import { isAllowedCloudUrl } from '../sources'
import type { ProviderRunResult } from '../providers'

const SEARCH_QUERIES = [
  {
    query: 'Akron Ohio business automation AI operations',
    sourceId: 'firecrawl-search-akron',
    sourceLabel: 'Firecrawl web search',
    categories: ['local_Akron', 'SMB_automation', 'AI_trends'] as const,
  },
  {
    query: 'freight logistics Ohio sprinter van opportunities',
    sourceId: 'firecrawl-search-freight',
    sourceLabel: 'Firecrawl freight search',
    categories: ['freight', 'Ohio_business'] as const,
  },
]

function compact(value: string, limit = 900): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > limit ? `${clean.slice(0, limit - 1)}...` : clean
}

type FirecrawlSearchResponse = {
  success?: boolean
  data?: { web?: { title?: string; url?: string; description?: string }[] } | { title?: string; url?: string; description?: string }[]
  error?: string
}

function webResults(data: FirecrawlSearchResponse) {
  if (Array.isArray(data.data)) return data.data
  return data.data?.web ?? []
}

export async function runFirecrawlSignalSearch(
  capturedAt: string,
): Promise<ProviderRunResult> {
  const apiKey = process.env.FIRECRAWL_API_KEY?.trim()
  if (!apiKey) {
    return { items: [], diagnostics: { configured: false, error: 'FIRECRAWL_API_KEY is not configured' } }
  }

  const settled = await Promise.allSettled(SEARCH_QUERIES.map(async search => {
    const response = await fetch('https://api.firecrawl.dev/v2/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: search.query, limit: 4, sources: ['web'] }),
      signal: AbortSignal.timeout(16_000),
    })
    const data = await response.json() as FirecrawlSearchResponse
    if (!response.ok || data.success === false) {
      throw new Error(data.error || `Firecrawl search failed (HTTP ${response.status})`)
    }
    return webResults(data).flatMap((row): SignalRawItem[] => {
      const title = String(row.title ?? '').trim()
      const url = String(row.url ?? '').trim()
      const description = String((row as { description?: string }).description ?? title)
      if (!title || !isAllowedCloudUrl(url)) return []
      return [{
        provider: 'firecrawl',
        sourceId: search.sourceId,
        sourceLabel: search.sourceLabel,
        sourceKind: 'search',
        title,
        url,
        summary: compact(description),
        categories: [...search.categories],
        rawScore: 0.7,
        capturedAt,
        metadata: { query: search.query, extraction: 'firecrawl_search', signalIngestedAt: capturedAt },
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
      queryCount: SEARCH_QUERIES.length,
      resultCount: items.length,
      extraction: 'firecrawl_search',
      failures: errors.length,
      firstError: errors[0] ?? null,
    },
  }
}
