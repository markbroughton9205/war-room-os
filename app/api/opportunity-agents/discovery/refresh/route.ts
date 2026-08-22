import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { runOpportunityDiscovery } from '@/lib/opportunity-discovery/pipeline'
import type { DiscoveryProvider } from '@/lib/opportunity-discovery/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const PROVIDERS = new Set<DiscoveryProvider>(['adzuna', 'remote_ok', 'sam_gov', 'usaspending'])

export async function POST(req: Request) {
  const commander = await requireCommanderSession('Opportunity discovery refresh')
  if (!commander.ok) return commander.response
  const body = await req.json().catch(() => ({})) as { providers?: unknown; deliverExternal?: unknown }
  const providers = Array.isArray(body.providers) ? body.providers.filter((value): value is DiscoveryProvider => typeof value === 'string' && PROVIDERS.has(value as DiscoveryProvider)) : undefined
  try {
    const result = await runOpportunityDiscovery({ providers, deliverExternal: body.deliverExternal === true })
    return NextResponse.json({ tool: 'REFRESH_OPPORTUNITY_DISCOVERY', status: 'complete', ...result, secretsExposed: false, applicationsOrSubmissionsPerformed: false })
  } catch (error) {
    return NextResponse.json({ tool: 'REFRESH_OPPORTUNITY_DISCOVERY', status: 'error', error: error instanceof Error ? error.message : 'Discovery refresh failed.', discoveryOnly: true, applicationsOrSubmissionsPerformed: false }, { status: 502 })
  }
}
