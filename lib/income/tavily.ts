export type ScoutRiskLevel = 'low' | 'medium' | 'high'
export type ScoutVerificationStatus = 'candidate' | 'rejected'

export type OpportunityScoutCandidate = {
  title: string
  url: string
  source: string
  country: string
  payout: string | null
  currency: string | null
  expiration: string | null
  type: string
  riskLevel: ScoutRiskLevel
  verificationStatus: ScoutVerificationStatus
  reason: string
  provider: string
}

type TavilyResult = {
  title?: string
  url?: string
  content?: string
  raw_content?: string | null
  score?: number
}

type TavilyResponse = {
  results?: TavilyResult[]
  response_time?: number | string
  error?: string
}

export const OPPORTUNITY_SCOUT_QUERIES = [
  { query: 'paid research studies accepting participants this month', type: 'research studies', country: 'USA' },
  { query: 'remote AI evaluator jobs hiring now', type: 'AI evaluation', country: 'remote' },
  { query: 'paid user testing studies accepting testers', type: 'user testing', country: 'remote' },
  { query: 'paid interviews remote research participants', type: 'research studies', country: 'remote' },
  { query: 'remote microtask platforms paid work accepting applicants', type: 'remote micro-contracts', country: 'remote' },
  { query: 'international paid research studies participants online', type: 'research studies', country: 'international' },
  { query: 'digital service gigs remote quick contract work', type: 'digital service gigs', country: 'remote' },
]

const suspiciousPatterns = [
  /\bpay upfront\b/i,
  /\bupfront fee\b/i,
  /\bgift card\b/i,
  /\bcrypto\b/i,
  /\bwire transfer\b/i,
  /\bbank login\b/i,
  /\bdeposit check\b/i,
  /\bguaranteed income\b/i,
  /\bget rich quick\b/i,
]

const opportunityPatterns = [
  /\bpaid\b/i,
  /\bresearch stud/i,
  /\bparticipant/i,
  /\binterview/i,
  /\buser testing\b/i,
  /\bAI evaluator\b/i,
  /\bevaluation\b/i,
  /\bmicrotask\b/i,
  /\bremote\b/i,
  /\bcontract\b/i,
  /\bgig\b/i,
]

function getTavilyApiKey() {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) throw new Error('TAVILY_API_KEY is not configured')
  return apiKey
}

export function sourceFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'unknown source'
  }
}

export function extractPayout(text: string) {
  const match = text.match(/(?:\$|USD\s?)\s?\d{1,5}(?:[,.]\d{2})?|\d{1,5}\s?(?:USD|dollars|GBP|EUR|CAD|AUD)/i)
  if (!match) return { payout: null, currency: null }

  const payout = match[0].trim()
  const currency = /GBP/i.test(payout)
    ? 'GBP'
    : /EUR/i.test(payout)
      ? 'EUR'
      : /CAD/i.test(payout)
        ? 'CAD'
        : /AUD/i.test(payout)
          ? 'AUD'
          : 'USD'

  return { payout, currency }
}

export function extractExpiration(text: string) {
  const match = text.match(/\b(?:deadline|expires|apply by|closes)\s*:?\s*([A-Z][a-z]{2,8}\.?\s+\d{1,2}(?:,\s*\d{4})?|\d{1,2}\/\d{1,2}\/\d{2,4})/i)
  return match?.[1] ?? null
}

export function validateOpportunityResult({
  title,
  url,
  content,
  type,
  country,
  provider,
}: {
  title: string
  url: string
  content: string
  type: string
  country: string
  provider: string
}): OpportunityScoutCandidate | null {
  const cleanTitle = title.trim()
  const cleanUrl = url.trim()
  const text = `${cleanTitle} ${content} ${cleanUrl}`

  if (!cleanTitle || !/^https?:\/\//i.test(cleanUrl)) return null

  const suspicious = suspiciousPatterns.some(pattern => pattern.test(text))
  const relevant = opportunityPatterns.some(pattern => pattern.test(text))
  const { payout, currency } = extractPayout(text)
  const expiration = extractExpiration(text)

  if (suspicious) {
    return {
      title: cleanTitle,
      url: cleanUrl,
      source: sourceFromUrl(cleanUrl),
      country,
      payout,
      currency,
      expiration,
      type,
      riskLevel: 'high',
      verificationStatus: 'rejected',
      reason: 'Rejected by basic scam-risk filter.',
      provider,
    }
  }

  if (!relevant) {
    return {
      title: cleanTitle,
      url: cleanUrl,
      source: sourceFromUrl(cleanUrl),
      country,
      payout,
      currency,
      expiration,
      type,
      riskLevel: 'medium',
      verificationStatus: 'rejected',
      reason: 'Rejected because the result did not clearly describe a paid opportunity.',
      provider,
    }
  }

  return {
    title: cleanTitle,
    url: cleanUrl,
    source: sourceFromUrl(cleanUrl),
    country,
    payout,
    currency,
    expiration,
    type,
    riskLevel: payout ? 'low' : 'medium',
    verificationStatus: 'candidate',
    reason: payout
      ? 'Accepted as a real Tavily result with payout language present; review before saving.'
      : 'Accepted as a real Tavily result; payout not found in search snippet.',
    provider,
  }
}

export async function searchTavilyIncomeOpportunities() {
  const apiKey = getTavilyApiKey()
  const started = Date.now()
  const candidates = new Map<string, OpportunityScoutCandidate>()
  const rejected: OpportunityScoutCandidate[] = []

  const searches = await Promise.all(OPPORTUNITY_SCOUT_QUERIES.map(async search => {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: search.query,
        search_depth: 'advanced',
        topic: 'general',
        time_range: 'month',
        max_results: 5,
        include_answer: false,
        include_raw_content: 'markdown',
        include_images: false,
        include_favicon: false,
      }),
      signal: AbortSignal.timeout(20000),
    })

    const data = await response.json() as TavilyResponse
    if (!response.ok) throw new Error(data.error || `Tavily search failed for: ${search.query}`)
    return { search, results: data.results ?? [] }
  }))

  for (const { search, results } of searches) {
    for (const result of results) {
      const normalized = validateOpportunityResult({
        title: String(result.title ?? ''),
        url: String(result.url ?? ''),
        content: `${String(result.content ?? '')} ${String(result.raw_content ?? '')}`,
        type: search.type,
        country: search.country,
        provider: 'tavily',
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
    durationMs: Date.now() - started,
  }
}
