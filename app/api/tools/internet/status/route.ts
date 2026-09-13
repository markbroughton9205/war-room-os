import { NextResponse } from 'next/server'
import {
  deriveInternetResearchOverall,
  internetResearchAdapterSummary,
  isInternetResearchLayerUnwired,
} from '@/lib/internet/internetResearchSummary'
import { buildInternetToolMatrix } from '@/lib/internet/probes'
import type { InternetStatusResponse } from '@/lib/tools/internet/types'
import { envHasUsableProviderSecret } from '@/lib/providers/secretPresence'
import { EXTERNAL_COUNCIL_PROVIDER_TOTAL } from '@/lib/council/live-orchestration/councilContinuity'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { tools, lastChecked } = await buildInternetToolMatrix()
  const unwired = isInternetResearchLayerUnwired()
  const tavily = internetResearchAdapterSummary(tools.tavily)
  const firecrawl = internetResearchAdapterSummary(tools.firecrawl)
  const { overallStatus, label } = deriveInternetResearchOverall({ tavily, firecrawl, unwired })
  const direct = tools.direct_fetch
  const networkEgress =
    direct.status === 'reachable' ? 'AVAILABLE' as const
      : direct.status === 'error' ? 'UNAVAILABLE' as const
        : 'UNKNOWN' as const
  const searchConfigured = tavily.keyPresent || firecrawl.keyPresent || tools.grok_xai.status !== 'config_needed'
  const councilConfigured = [
    envHasUsableProviderSecret('OPENAI_API_KEY'),
    envHasUsableProviderSecret('ANTHROPIC_API_KEY'),
    envHasUsableProviderSecret('XAI_API_KEY'),
    envHasUsableProviderSecret('GEMINI_API_KEY'),
  ].filter(Boolean).length

  return NextResponse.json({
    tools,
    serverSideOnly: true,
    canUseInternet: overallStatus === 'live',
    lastChecked,
    overallStatus,
    label,
    tavily,
    firecrawl,
    NETWORK_EGRESS: networkEgress,
    SEARCH_PROVIDER_CONFIGURATION: searchConfigured ? 'CONFIGURED' : 'CONFIG_NEEDED',
    COUNCIL_PROVIDER_CONFIGURATION: { configured: councilConfigured, total: EXTERNAL_COUNCIL_PROVIDER_TOTAL },
  } satisfies InternetStatusResponse)
}
