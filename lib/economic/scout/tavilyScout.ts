import type { EconomicOperationalDomainId } from '@/lib/economic/types'
import type { RawScoutResult } from '@/lib/economic/scout/normalizeScoutResults'

type TavilyResult = {
  title?: string
  url?: string
  content?: string
  raw_content?: string | null
  score?: number
}

type TavilyResponse = {
  results?: TavilyResult[]
  error?: string
}

export type TavilyScoutResult = {
  ok: boolean
  enabled: boolean
  provider: 'tavily'
  queries: string[]
  results: RawScoutResult[]
  error?: string
  durationMs: number
}

const QUERY_LIMIT = 4
const RESULTS_PER_QUERY = 4

function baseQueries(domainId: EconomicOperationalDomainId): string[] {
  switch (domainId) {
    case 'freight_ops':
      return [
        'freight logistics demand shortage small business opportunities 2026',
        'local logistics service gaps dispatch carrier demand',
      ]
    case 'automation_ops':
      return [
        'small business AI automation service demand manual workflows',
        'AI automation agencies underserved business niches recurring revenue',
      ]
    case 'acquisition_ops':
      return [
        'small business acquisition targets distressed owner retiring market opportunities',
        'micro acquisition local service businesses for sale trends',
      ]
    case 'market_ops':
      return [
        'underserved industries market gaps small business opportunities',
        'local business market gaps recurring revenue opportunities',
      ]
    case 'sales_ops':
    case 'lead_ops':
      return [
        'B2B service offer demand lead generation underserved local businesses',
        'small business lead generation systems demand AI services',
      ]
    default:
      return [
        'recurring revenue business ideas market demand underserved niches',
        'digital products service offers local business opportunities AI automation',
      ]
  }
}

function queriesFor(input: { decree: string; domainId: EconomicOperationalDomainId }): string[] {
  const decree = input.decree.replace(/\s+/g, ' ').trim()
  return [
    `${decree} market demand opportunities`,
    ...baseQueries(input.domainId),
    'licensing opportunities recurring revenue service business demand',
  ].slice(0, QUERY_LIMIT)
}

export async function runTavilyScout(input: {
  decree: string
  domainId: EconomicOperationalDomainId
}): Promise<TavilyScoutResult> {
  const startedAt = Date.now()
  const apiKey = process.env.TAVILY_API_KEY?.trim()
  const queries = queriesFor(input)
  if (!apiKey) {
    return {
      ok: false,
      enabled: false,
      provider: 'tavily',
      queries,
      results: [],
      error: 'TAVILY_API_KEY is not configured',
      durationMs: Date.now() - startedAt,
    }
  }

  try {
    const settled = await Promise.allSettled(queries.map(async query => {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          search_depth: 'advanced',
          topic: 'general',
          time_range: 'month',
          max_results: RESULTS_PER_QUERY,
          include_answer: false,
          include_raw_content: 'markdown',
          include_images: false,
          include_favicon: false,
        }),
        signal: AbortSignal.timeout(16_000),
      })
      const data = await response.json() as TavilyResponse
      if (!response.ok) throw new Error(data.error || `Tavily search failed: ${query}`)
      return (data.results ?? []).map((result): RawScoutResult => ({
        provider: 'tavily',
        query,
        title: String(result.title ?? ''),
        url: String(result.url ?? ''),
        snippet: `${String(result.content ?? '')} ${String(result.raw_content ?? '')}`.replace(/\s+/g, ' ').trim().slice(0, 1600),
        rawScore: typeof result.score === 'number' ? result.score : null,
      }))
    }))
    const results = settled.flatMap(row => row.status === 'fulfilled' ? row.value : [])
    const errors = settled
      .filter((row): row is PromiseRejectedResult => row.status === 'rejected')
      .map(row => row.reason instanceof Error ? row.reason.message : String(row.reason))

    return {
      ok: results.length > 0,
      enabled: true,
      provider: 'tavily',
      queries,
      results,
      error: results.length ? errors[0] : errors.join('; ') || undefined,
      durationMs: Date.now() - startedAt,
    }
  } catch (error) {
    return {
      ok: false,
      enabled: true,
      provider: 'tavily',
      queries,
      results: [],
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    }
  }
}
