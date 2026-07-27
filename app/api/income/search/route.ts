import { NextResponse } from 'next/server'
import { searchIncomeOpportunities } from '@/lib/income/firecrawl'
import { searchTavilyIncomeOpportunities } from '@/lib/income/tavily'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function providerState() {
  return {
    tavily: process.env.TAVILY_API_KEY ? 'configured' : 'config_needed',
    firecrawl: process.env.FIRECRAWL_API_KEY ? 'configured' : 'config_needed',
  }
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Income web search failed.'
  if (/api[_-]?key|secret|token|bearer|authorization|unauthorized|401|403/i.test(message)) return 'Configured provider rejected the request.'
  return message.length > 180 ? `${message.slice(0, 177)}...` : message
}

export async function GET() {
  const started = Date.now()
  const providers = providerState()
  if (!process.env.TAVILY_API_KEY && !process.env.FIRECRAWL_API_KEY) {
    return NextResponse.json({
      tool: 'income-web-opportunity-search',
      status: 'config_needed',
      message: 'Income web search requires TAVILY_API_KEY or FIRECRAWL_API_KEY. No fallback or generated opportunities are returned from this route.',
      providers,
      sourcesChecked: 0,
      opportunities: [],
      rejected: [],
    }, { status: 503, headers: { 'cache-control': 'no-store' } })
  }

  try {
    if (process.env.TAVILY_API_KEY) {
      const result = await searchTavilyIncomeOpportunities()
      return NextResponse.json({
        tool: 'income-web-opportunity-search',
        status: result.opportunities.length ? 'found' : 'no_results',
        providerUsed: 'tavily',
        providers: { ...providers, tavily: 'online' },
        message: result.opportunities.length
          ? 'Tavily returned source-linked opportunity candidates. Review before saving or acting.'
          : 'Tavily responded, but no candidate passed the opportunity/risk filters.',
        sourcesChecked: result.sourcesChecked,
        durationMs: result.durationMs,
        opportunities: result.opportunities,
        rejected: result.rejected,
      }, { headers: { 'cache-control': 'no-store' } })
    }

    const result = await searchIncomeOpportunities()
    return NextResponse.json({
      tool: 'income-web-opportunity-search',
      status: result.opportunities.length ? 'found' : 'no_results',
      providerUsed: 'firecrawl',
      providers: { ...providers, firecrawl: 'online' },
      message: result.opportunities.length
        ? 'Firecrawl returned source-linked opportunity candidates. Review before saving or acting.'
        : 'Firecrawl responded, but no candidate passed the opportunity/risk filters.',
      sourcesChecked: result.sourcesChecked,
      durationMs: Date.now() - started,
      opportunities: result.opportunities,
      rejected: result.rejected,
    }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({
      tool: 'income-web-opportunity-search',
      status: 'error',
      providerUsed: process.env.TAVILY_API_KEY ? 'tavily' : 'firecrawl',
      providers,
      message: safeError(error),
      sourcesChecked: 0,
      durationMs: Date.now() - started,
      opportunities: [],
      rejected: [],
    }, { status: 502, headers: { 'cache-control': 'no-store' } })
  }
}
