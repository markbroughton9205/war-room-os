import { NextResponse } from 'next/server'
import { enrichCandidatesWithFirecrawl } from '@/lib/income/firecrawl'
import { OPPORTUNITY_SCOUT_QUERIES, searchTavilyIncomeOpportunities } from '@/lib/income/tavily'

export const runtime = 'nodejs'

type ProviderStatus = 'online' | 'standby' | 'offline' | 'error'

export async function POST() {
  const lastScanTime = new Date().toISOString()
  const started = Date.now()
  const providerStatus: Record<'tavily' | 'firecrawl', ProviderStatus> = {
    tavily: process.env.TAVILY_API_KEY ? 'standby' : 'offline',
    firecrawl: process.env.FIRECRAWL_API_KEY ? 'standby' : 'offline',
  }

  try {
    const providerUsed = 'tavily'
    const scan = await searchTavilyIncomeOpportunities()
    providerStatus.tavily = 'online'

    let opportunities = scan.opportunities
    if (process.env.FIRECRAWL_API_KEY && opportunities.length > 0) {
      const enrichment = await enrichCandidatesWithFirecrawl(opportunities)
      opportunities = enrichment.candidates
      providerStatus.firecrawl = enrichment.online ? 'online' : 'error'
    }

    const scanDurationMs = Date.now() - started

    return NextResponse.json({
      tool: 'opportunity-scout',
      provider: providerUsed,
      providerUsed,
      providerStatus,
      agent: {
        name: 'Opportunity Scout',
        role: 'Global income opportunity researcher',
        purpose: 'Search for real opportunities and add them into Income Radar only after verification.',
        categories: OPPORTUNITY_SCOUT_QUERIES.map(search => search.query),
      },
      status: opportunities.length > 0 ? 'found' : 'found',
      message: opportunities.length > 0
        ? `Opportunity Scout found live candidates through ${providerUsed}. Review before saving.`
        : `Opportunity Scout completed a ${providerUsed} scan. No live opportunities passed the basic filter.`,
      lastScanTime,
      sourcesChecked: scan.sourcesChecked,
      opportunitiesFound: opportunities.length,
      opportunitiesRejected: scan.rejected.length,
      acceptedCandidates: opportunities.length,
      rejectedCandidates: scan.rejected.length,
      scanDurationMs,
      riskFilterStatus: 'basic scam-risk filter active',
      nextScanAction: opportunities.length > 0 ? 'Review candidates before saving' : 'Try another scan later',
      opportunities,
      rejected: scan.rejected,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Opportunity Scout Tavily scan failed.'
    providerStatus.tavily = process.env.TAVILY_API_KEY ? 'error' : 'offline'

    return NextResponse.json({
      tool: 'opportunity-scout',
      provider: 'tavily',
      providerUsed: 'tavily',
      providerStatus,
      status: 'error',
      message,
      lastScanTime,
      sourcesChecked: 0,
      opportunitiesFound: 0,
      opportunitiesRejected: 0,
      acceptedCandidates: 0,
      rejectedCandidates: 0,
      scanDurationMs: Date.now() - started,
      riskFilterStatus: 'basic scam-risk filter active',
      nextScanAction: 'Check Tavily provider configuration',
      opportunities: [],
      rejected: [],
    }, { status: 503 })
  }
}
