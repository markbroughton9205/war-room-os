import { NextResponse } from 'next/server'
import { searchAcrossCategories } from '@/lib/search/query'
import type { SearchCategory } from '@/lib/search/types'
import { federatedSearch } from '@/lib/war-room-search/federatedSearch'
import { isSearchRequestEmpty } from '@/lib/war-room-search/searchQuery'
import type { SearchRequest, SearchRequestOptions } from '@/lib/war-room-search/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const VALID_CATEGORIES: SearchCategory[] = [
  'conversation', 'memory', 'project', 'open_loop', 'prompt_artifact', 'world_knowledge', 'source', 'claim',
]

export async function GET(req: Request) {
  const url = new URL(req.url)
  const q = url.searchParams.get('q')?.trim()
  if (!q) return NextResponse.json({ error: 'q is required' }, { status: 400 })

  const categoriesParam = url.searchParams.get('categories')
  const categories = categoriesParam
    ? categoriesParam.split(',').filter((c): c is SearchCategory => VALID_CATEGORIES.includes(c as SearchCategory))
    : undefined

  const projectId = url.searchParams.get('projectId')
  const conversationId = url.searchParams.get('conversationId')
  const includeInactive = url.searchParams.get('includeInactive') === '1'
  const limit = Number(url.searchParams.get('limit') ?? '20')

  const results = await searchAcrossCategories({
    query: q,
    categories,
    scope: { projectId: projectId ?? null, conversationId: conversationId ?? null },
    includeInactive,
    limit: Number.isFinite(limit) ? limit : 20,
  })

  return NextResponse.json({ query: q, results })
}

export async function POST(req: Request) {
  let body: { query?: unknown; options?: unknown }
  try {
    body = await req.json() as { query?: unknown; options?: unknown }
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.', warnings: ['invalid_json'] }, { status: 400 })
  }

  const query = typeof body.query === 'string' ? body.query : ''
  if (isSearchRequestEmpty(query)) {
    return NextResponse.json({ error: 'query is required.', warnings: ['empty_query'] }, { status: 400 })
  }

  const options = (body.options && typeof body.options === 'object' ? body.options : {}) as SearchRequestOptions
  const request: SearchRequest = { query, options }

  try {
    const result = await federatedSearch(request, { signal: req.signal })
    if (result.aborted && result.resultCount === 0) {
      return NextResponse.json(result, { status: 499 })
    }
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Search failed'
    if (req.signal.aborted || /abort/i.test(message)) {
      return NextResponse.json({
        query,
        tookMs: 0,
        resultCount: 0,
        rawCount: 0,
        deduplicatedCount: 0,
        results: [],
        sourceSummary: {
          tavilyOk: false,
          researchEngineOk: false,
          researchEngineProviders: [],
          publicRssOk: false,
          primaryAttempted: [],
          primaryOk: false,
          genericRssUsedAsFallback: false,
        },
        fallbackUsed: false,
        warnings: ['Search aborted.'],
        aborted: true,
        timedOut: false,
        profile: 'STANDARD_RESEARCH',
      }, { status: 499 })
    }
    return NextResponse.json({
      query,
      tookMs: 0,
      resultCount: 0,
      rawCount: 0,
      deduplicatedCount: 0,
      results: [],
      sourceSummary: {
        tavilyOk: false,
        researchEngineOk: false,
        researchEngineProviders: [],
        publicRssOk: false,
        primaryAttempted: [],
        primaryOk: false,
        genericRssUsedAsFallback: false,
      },
      fallbackUsed: false,
      warnings: [message.replace(/(?:sk-|Bearer\s+)[A-Za-z0-9._-]+/gi, '[redacted]')],
      aborted: false,
      timedOut: false,
      profile: 'STANDARD_RESEARCH',
      error: 'Search failed.',
    }, { status: 200 })
  }
}

