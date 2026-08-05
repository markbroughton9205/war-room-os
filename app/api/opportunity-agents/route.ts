import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { scoutIncomeWorkerOpportunities } from '@/lib/income-workers/scout'
import type { IncomeWorkerCandidate, IncomeWorkerScoutSourceType } from '@/lib/income-workers/types'
import { listOpportunityAgentRecords, runOpportunityWorkflow } from '@/lib/opportunity-agents/orchestrator'
import { getOpportunityAgentPersistenceReadiness } from '@/lib/opportunity-agents/durableStore'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type PostBody = {
  candidate?: IncomeWorkerCandidate
  sourceType?: IncomeWorkerScoutSourceType
  threadId?: string
  limit?: number
}

function isCandidate(value: unknown): value is IncomeWorkerCandidate {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<IncomeWorkerCandidate>
  return typeof candidate.title === 'string'
    && typeof candidate.url === 'string'
    && typeof candidate.source === 'string'
    && typeof candidate.type === 'string'
    && typeof candidate.reason === 'string'
}

export async function GET() {
  const commander = await requireCommanderSession('Opportunity Agent Workforce')
  if (!commander.ok) return commander.response
  const listed = listOpportunityAgentRecords()
  return NextResponse.json({
    tool: 'opportunity-agent-workforce',
    status: 'ready',
    message: 'Opportunity Agent Workforce records loaded from session-only memory.',
    ...listed,
    durablePersistence: getOpportunityAgentPersistenceReadiness(),
  })
}

export async function POST(req: Request) {
  const commander = await requireCommanderSession('Opportunity Agent Workforce')
  if (!commander.ok) return commander.response
  let body: PostBody = {}
  try {
    body = await req.json() as PostBody
  } catch {
    body = {}
  }

  const sourceType = body.sourceType ?? 'local_manual'
  if (body.candidate !== undefined) {
    if (!isCandidate(body.candidate)) {
      return NextResponse.json({
        tool: 'opportunity-agent-workforce',
        status: 'error',
        message: 'Invalid candidate payload. Work packet was not created.',
        persistence: 'session_only',
      }, { status: 400 })
    }
    const run = runOpportunityWorkflow(body.candidate, sourceType)
    return NextResponse.json({
      tool: 'opportunity-agent-workforce',
      status: 'packet_ready',
      message: 'Opportunity work packet prepared. Commander approval required before any external action.',
      run,
      runs: [run],
      records: listOpportunityAgentRecords().records,
      persistence: 'session_only',
      externalActionsExecuted: false,
      durablePersistence: getOpportunityAgentPersistenceReadiness(),
    })
  }

  const scout = await scoutIncomeWorkerOpportunities(body.threadId ?? 'opportunity-agent-workforce')
  const limit = Math.max(1, Math.min(Number(body.limit ?? 3), 8))
  const runs = scout.candidates.slice(0, limit).map(candidate => runOpportunityWorkflow(candidate, scout.diagnostics?.sourceType ?? sourceType))
  return NextResponse.json({
    tool: 'opportunity-agent-workforce',
    status: runs.length ? 'packets_ready' : 'no_results',
    message: runs.length
      ? `Prepared ${runs.length} opportunity work packet(s). Commander approval required before any external action.`
      : scout.message,
    scoutStatus: scout.status,
    providerUsed: scout.providerUsed,
    degradedMode: Boolean(scout.degradedMode),
    runs,
    records: listOpportunityAgentRecords().records,
    persistence: 'session_only',
    externalActionsExecuted: false,
    durablePersistence: getOpportunityAgentPersistenceReadiness(),
  }, { status: scout.status === 'error' && runs.length === 0 ? 503 : 200 })
}
