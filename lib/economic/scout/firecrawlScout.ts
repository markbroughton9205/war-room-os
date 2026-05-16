import type { NormalizedScoutCandidate, RawScoutResult } from '@/lib/economic/scout/normalizeScoutResults'

type FirecrawlScrapeResponse = {
  success?: boolean
  data?: {
    markdown?: string
    metadata?: {
      title?: string
      sourceURL?: string
      url?: string
    }
  }
  error?: string
}

export type FirecrawlScoutResult = {
  ok: boolean
  enabled: boolean
  provider: 'firecrawl'
  attempted: number
  results: RawScoutResult[]
  error?: string
  durationMs: number
}

const FIRECRAWL_SCRAPE_URL = 'https://api.firecrawl.dev/v2/scrape'
const ENRICH_LIMIT = 3

export async function runFirecrawlScout(input: {
  candidates: readonly NormalizedScoutCandidate[]
}): Promise<FirecrawlScoutResult> {
  const startedAt = Date.now()
  const apiKey = process.env.FIRECRAWL_API_KEY?.trim()
  const targets = input.candidates
    .filter(candidate => candidate.url?.startsWith('http'))
    .slice(0, ENRICH_LIMIT)

  if (!targets.length) {
    return {
      ok: false,
      enabled: Boolean(apiKey),
      provider: 'firecrawl',
      attempted: 0,
      results: [],
      error: 'No Tavily-selected targets available for Firecrawl enrichment',
      durationMs: Date.now() - startedAt,
    }
  }

  if (!apiKey) {
    return {
      ok: false,
      enabled: false,
      provider: 'firecrawl',
      attempted: targets.length,
      results: [],
      error: 'FIRECRAWL_API_KEY is not configured',
      durationMs: Date.now() - startedAt,
    }
  }

  const settled = await Promise.allSettled(targets.map(async candidate => {
    const response = await fetch(FIRECRAWL_SCRAPE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: candidate.url,
        formats: ['markdown'],
        onlyMainContent: true,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    const data = await response.json() as FirecrawlScrapeResponse
    if (!response.ok || data.success === false) {
      throw new Error(data.error || `Firecrawl scrape failed for ${candidate.url}`)
    }
    const markdown = String(data.data?.markdown ?? '').replace(/\s+/g, ' ').trim()
    if (!markdown) throw new Error(`Firecrawl returned no markdown for ${candidate.url}`)
    return {
      provider: 'firecrawl' as const,
      query: candidate.evidence.query,
      title: String(data.data?.metadata?.title ?? candidate.title),
      url: candidate.url ?? '',
      snippet: markdown.slice(0, 1600),
      rawScore: candidate.rank_score,
    }
  }))

  const results = settled.flatMap(row => row.status === 'fulfilled' ? [row.value] : [])
  const errors = settled
    .filter((row): row is PromiseRejectedResult => row.status === 'rejected')
    .map(row => row.reason instanceof Error ? row.reason.message : String(row.reason))

  return {
    ok: results.length > 0,
    enabled: true,
    provider: 'firecrawl',
    attempted: targets.length,
    results,
    error: results.length ? errors[0] : errors.join('; ') || undefined,
    durationMs: Date.now() - startedAt,
  }
}
