import { NextResponse } from 'next/server'
import { orchestrateIncomeWorkerScout } from '@/lib/income-workers/scoutOrchestrator'

export const runtime = 'nodejs'

export async function POST() {
  const started = Date.now()
  try {
    const result = await orchestrateIncomeWorkerScout('opportunity-scout')
    const providerUsed = result.providerUsed
    const fallbackPath = result.diagnostics?.fallbackPath ?? []
    const providerStatus: Record<string, 'online' | 'standby' | 'offline' | 'error'> = {
      tavily: fallbackPath.includes('tavily_live') ? 'online' : process.env.TAVILY_API_KEY ? 'standby' : 'offline',
      firecrawl: fallbackPath.includes('firecrawl_live') ? 'online' : process.env.FIRECRAWL_API_KEY ? 'standby' : 'offline',
      brave: fallbackPath.includes('brave_live') ? 'online' : process.env.BRAVE_API_KEY ? 'standby' : 'offline',
      rss: fallbackPath.includes('rss_intelligence') ? 'online' : 'standby',
    }

    return NextResponse.json({
      tool: 'opportunity-scout',
      provider: providerUsed,
      providerUsed,
      providerStatus,
      federation: {
        fallbackPath,
        degradedMode: result.degradedMode ?? false,
        operatorGuidance: result.message,
        sourceType: result.diagnostics?.sourceType ?? 'local_manual',
      },
      agent: {
        name: 'Opportunity Scout',
        role: 'Global income opportunity researcher',
        purpose: 'Federated multi-source scout with automatic provider failover.',
        categories: ['income', 'gigs', 'freight', 'automation'],
      },
      status: result.status,
      message: result.message,
      lastScanTime: result.scannedAt,
      sourcesChecked: result.sourcesChecked,
      opportunitiesFound: result.candidates.length,
      opportunitiesRejected: result.rejected.length,
      acceptedCandidates: result.candidates.length,
      rejectedCandidates: result.rejected.length,
      scanDurationMs: Date.now() - started,
      riskFilterStatus: 'basic scam-risk filter active',
      nextScanAction: result.candidates.length > 0 ? 'Review candidates before saving' : 'Federation will use cache/historical on next scan',
      opportunities: result.candidates,
      rejected: result.rejected,
      executionState: result.executionState,
      diagnostics: result.diagnostics,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Opportunity Scout federation scan failed.'
    return NextResponse.json({
      tool: 'opportunity-scout',
      provider: 'federation',
      providerUsed: 'federation',
      status: 'error',
      message,
      lastScanTime: new Date().toISOString(),
      sourcesChecked: 0,
      opportunitiesFound: 0,
      opportunitiesRejected: 0,
      scanDurationMs: Date.now() - started,
      opportunities: [],
      rejected: [],
    }, { status: 503 })
  }
}
