import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { isActionableSourceOpportunity, runSourceRefreshPipeline } from '@/lib/opportunity-agents/sources/refreshPipeline'
import { runOpportunityWorkflowFromSourceRecord } from '@/lib/opportunity-agents/orchestrator'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RefreshBody = { sourceId?: string; query?: string; limit?: number; maxPages?: number; maxRecords?: number }

export async function POST(req: Request) {
  const commander = await requireCommanderSession('Opportunity source refresh')
  if (!commander.ok) return commander.response

  let body: RefreshBody
  try {
    body = await req.json() as RefreshBody
  } catch {
    return NextResponse.json({ tool: 'opportunity-source-refresh', status: 'error', message: 'Invalid JSON body.' }, { status: 400 })
  }
  const sourceId = typeof body.sourceId === 'string' && body.sourceId.trim() ? body.sourceId.trim() : null
  if (!sourceId) {
    return NextResponse.json({ tool: 'opportunity-source-refresh', status: 'error', message: 'sourceId is required.' }, { status: 400 })
  }
  try {
    const result = await runSourceRefreshPipeline(sourceId, { query: body.query, limit: body.limit, maxPages: body.maxPages, maxRecords: body.maxRecords })
    const runs = result.records
      .filter(isActionableSourceOpportunity)
      .slice(0, 5)
      .map(record => runOpportunityWorkflowFromSourceRecord(record))
    return NextResponse.json({
      tool: 'opportunity-source-refresh',
      status: result.status,
      message: result.status === 'success' || result.status === 'partial_success'
        ? 'Live source refresh completed. Review accepted records before action.'
        : result.failure ?? 'Source refresh did not complete.',
      result,
      runs,
      externalActionsExecuted: false,
    }, { status: result.status === 'failed' ? 502 : 200 })
  } catch (error) {
    return NextResponse.json({
      tool: 'opportunity-source-refresh',
      status: 'error',
      message: error instanceof Error ? error.message : 'Opportunity source refresh failed.',
      externalActionsExecuted: false,
    }, { status: 500 })
  }
}
