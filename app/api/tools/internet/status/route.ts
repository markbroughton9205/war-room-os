import { NextResponse } from 'next/server'
import {
  deriveInternetResearchOverall,
  internetResearchAdapterSummary,
  isInternetResearchLayerUnwired,
} from '@/lib/internet/internetResearchSummary'
import { buildInternetToolMatrix } from '@/lib/internet/probes'
import type { InternetStatusResponse } from '@/lib/tools/internet/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { tools, lastChecked } = await buildInternetToolMatrix()
  const unwired = isInternetResearchLayerUnwired()
  const tavily = internetResearchAdapterSummary(tools.tavily)
  const firecrawl = internetResearchAdapterSummary(tools.firecrawl)
  const { overallStatus, label } = deriveInternetResearchOverall({ tavily, firecrawl, unwired })

  return NextResponse.json({
    tools,
    serverSideOnly: true,
    canUseInternet: overallStatus === 'live',
    lastChecked,
    overallStatus,
    label,
    tavily,
    firecrawl,
  } satisfies InternetStatusResponse)
}
