import { NextResponse } from 'next/server'

import { getSignalSources } from '@/lib/signals'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const sources = getSignalSources()
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    sources,
    configuredCount: sources.filter(source => source.configured).length,
    guardrails: {
      cloudOnly: true,
      noLocalhost: true,
      noLocalAgents: true,
      approvalRequiredBeforeAction: true,
    },
  })
}
