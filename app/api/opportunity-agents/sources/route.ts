import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { browserSafeConnectionRows } from '@/lib/opportunity-agents/sources/registry'
import { getOpportunitySourceAdapter } from '@/lib/opportunity-agents/sources/adapters'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const commander = await requireCommanderSession('Opportunity source connections')
  if (!commander.ok) return commander.response

  const url = new URL(req.url)
  const test = url.searchParams.get('test') === '1'
  const base = browserSafeConnectionRows()
  if (!test) {
    return NextResponse.json({
      tool: 'opportunity-source-connections',
      status: 'ready',
      message: 'Source connections loaded. CONNECTED is only shown after a server-side test.',
      connections: base,
      secretsExposed: false,
    })
  }

  const tested = await Promise.all(base.map(async row => {
    const result = await getOpportunitySourceAdapter(row.id).testConnection()
    return {
      ...row,
      connectionState: result.state,
      lastTest: result.checkedAt,
      lastSuccessfulResponse: result.lastSuccessfulResponse,
      currentFailure: result.failure,
      requiredCommanderAction: result.failure ?? row.requiredCommanderAction,
    }
  }))
  return NextResponse.json({
    tool: 'opportunity-source-connections',
    status: 'tested',
    message: 'Source connection tests completed server-side. Secrets were not returned.',
    connections: tested,
    secretsExposed: false,
  })
}
