import {
  extractExpiration,
  extractPayout,
  OPPORTUNITY_SCOUT_QUERIES,
  sourceFromUrl,
  validateOpportunityResult,
  type OpportunityScoutCandidate,
} from './tavily'

type FirecrawlWebResult = {
  title?: string
  description?: string
  url?: string
  markdown?: string
}

type FirecrawlSearchResponse = {
  success?: boolean
  data?: {
    web?: FirecrawlWebResult[]
  } | FirecrawlWebResult[]
  error?: string
}

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

const FIRECRAWL_SEARCH_URL = 'https://api.firecrawl.dev/v2/search'
const FIRECRAWL_SCRAPE_URL = 'https://api.firecrawl.dev/v2/scrape'

function getFirecrawlApiKey() {
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) throw new Error('FIRECRAWL_API_KEY is not configured')
  return apiKey
}

function webResultsFromResponse(response: FirecrawlSearchResponse) {
  if (Array.isArray(response.data)) return response.data
  return response.data?.web ?? []
}

export async function searchIncomeOpportunities() {
  const apiKey = getFirecrawlApiKey()
  const candidates = new Map<string, OpportunityScoutCandidate>()
  const rejected: OpportunityScoutCandidate[] = []

  const searchResults = await Promise.all(OPPORTUNITY_SCOUT_QUERIES.map(async search => {
    const response = await fetch(FIRECRAWL_SEARCH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: search.query,
        limit: 3,
        sources: ['web'],
        country: 'US',
        scrapeOptions: {
          formats: ['markdown'],
          onlyMainContent: true,
        },
      }),
      signal: AbortSignal.timeout(18000),
    })

    const data = await response.json() as FirecrawlSearchResponse
    if (!response.ok || data.success === false) {
      throw new Error(data.error || `Firecrawl search failed for: ${search.query}`)
    }

    return { search, results: webResultsFromResponse(data) }
  }))

  for (const { search, results } of searchResults) {
    for (const result of results) {
      const normalized = validateOpportunityResult({
        title: String(result.title ?? ''),
        url: String(result.url ?? ''),
        content: `${String(result.description ?? '')} ${String(result.markdown ?? '')}`,
        type: search.type,
        country: search.country,
        provider: 'firecrawl',
      })
      if (!normalized) continue

      if (normalized.verificationStatus === 'candidate') {
        candidates.set(normalized.url, normalized)
      } else {
        rejected.push(normalized)
      }
    }
  }

  return {
    opportunities: Array.from(candidates.values()),
    rejected,
    sourcesChecked: OPPORTUNITY_SCOUT_QUERIES.length,
  }
}

export async function enrichCandidatesWithFirecrawl(candidates: OpportunityScoutCandidate[]) {
  if (candidates.length === 0) return { candidates, online: Boolean(process.env.FIRECRAWL_API_KEY) }

  const apiKey = getFirecrawlApiKey()
  const topCandidates = candidates.slice(0, 8)
  const enriched = new Map(candidates.map(candidate => [candidate.url, candidate]))

  await Promise.all(topCandidates.map(async candidate => {
    try {
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
        signal: AbortSignal.timeout(12000),
      })
      const data = await response.json() as FirecrawlScrapeResponse
      if (!response.ok || data.success === false) return

      const markdown = String(data.data?.markdown ?? '')
      const payout = candidate.payout ? { payout: candidate.payout, currency: candidate.currency } : extractPayout(markdown)
      const expiration = candidate.expiration ?? extractExpiration(markdown)

      enriched.set(candidate.url, {
        ...candidate,
        title: candidate.title || String(data.data?.metadata?.title ?? ''),
        source: sourceFromUrl(candidate.url),
        payout: payout.payout,
        currency: payout.currency,
        expiration,
        reason: payout.payout || expiration
          ? `${candidate.reason} Firecrawl extracted additional page details.`
          : candidate.reason,
      })
    } catch {
      // Keep the original candidate when extraction fails.
    }
  }))

  return {
    candidates: Array.from(enriched.values()),
    online: true,
  }
}
