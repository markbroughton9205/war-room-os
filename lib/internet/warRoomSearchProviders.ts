type TavilyResult = { title?: string; url?: string; content?: string; score?: number }
type TavilyResponse = { results?: TavilyResult[]; error?: string }

export async function tavilyWarRoomSearch(query: string, maxResults = 8) {
  const apiKey = process.env.TAVILY_API_KEY?.trim()
  if (!apiKey) {
    return { ok: false as const, skipped: true as const, reason: 'TAVILY_API_KEY missing', results: [] as TavilyResult[], durationMs: 0, statusCode: null as number | null }
  }
  const started = Date.now()
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      search_depth: 'basic',
      max_results: maxResults,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      include_favicon: false,
    }),
    signal: AbortSignal.timeout(20000),
  })
  const durationMs = Date.now() - started
  const data = (await response.json()) as TavilyResponse
  if (!response.ok) {
    return { ok: false as const, skipped: false as const, error: data.error || `HTTP ${response.status}`, results: [] as TavilyResult[], durationMs, statusCode: response.status }
  }
  return { ok: true as const, skipped: false as const, results: data.results ?? [], durationMs, statusCode: response.status }
}

type FirecrawlSearchResponse = {
  success?: boolean
  data?: { web?: { title?: string; url?: string; description?: string }[] } | { title?: string; url?: string; description?: string }[]
  error?: string
}

function webResultsFromResponse(response: FirecrawlSearchResponse) {
  if (Array.isArray(response.data)) return response.data
  return response.data?.web ?? []
}

export async function firecrawlWarRoomSearch(query: string, limit = 8) {
  const apiKey = process.env.FIRECRAWL_API_KEY?.trim()
  if (!apiKey) {
    return { ok: false as const, skipped: true as const, reason: 'FIRECRAWL_API_KEY missing', results: [] as { title: string; url: string; description: string }[], durationMs: 0, statusCode: null as number | null }
  }
  const started = Date.now()
  const response = await fetch('https://api.firecrawl.dev/v2/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, limit, sources: ['web'] }),
    signal: AbortSignal.timeout(20000),
  })
  const durationMs = Date.now() - started
  const data = (await response.json()) as FirecrawlSearchResponse
  if (!response.ok || data.success === false) {
    return {
      ok: false as const,
      skipped: false as const,
      error: data.error || `HTTP ${response.status}`,
      results: [] as { title: string; url: string; description: string }[],
      durationMs,
      statusCode: response.status,
    }
  }
  const raw = webResultsFromResponse(data)
  const results = raw.map(r => {
    const row = r as { title?: string; url?: string; description?: string; markdown?: string }
    return {
      title: String(row.title ?? ''),
      url: String(row.url ?? ''),
      description: String(row.description ?? row.markdown ?? ''),
    }
  })
  return { ok: true as const, skipped: false as const, results, durationMs, statusCode: response.status }
}
