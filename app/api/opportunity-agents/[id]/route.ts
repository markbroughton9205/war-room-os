import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { getRecord } from '@/lib/opportunity-agents/store'
import { approveForPursuit, transitionOpportunityStatus } from '@/lib/opportunity-agents/agents/workExecutionCoordinator'
import type { CommanderDecisionAction } from '@/lib/opportunity-agents/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }
type PatchBody = { decision?: CommanderDecisionAction; evidence?: string }

export async function GET(_req: Request, context: Context) {
  const commander = await requireCommanderSession('Opportunity Agent record')
  if (!commander.ok) return commander.response
  const { id } = await context.params
  const record = getRecord(id)
  if (!record) {
    return NextResponse.json({ tool: 'opportunity-agent-workforce', status: 'not_found', message: 'Opportunity record not found.' }, { status: 404 })
  }
  return NextResponse.json({ tool: 'opportunity-agent-workforce', status: 'ready', record, persistence: 'session_only' })
}

export async function PATCH(req: Request, context: Context) {
  const commander = await requireCommanderSession('Opportunity Agent decision')
  if (!commander.ok) return commander.response
  const { id } = await context.params
  const record = getRecord(id)
  if (!record) {
    return NextResponse.json({ tool: 'opportunity-agent-workforce', status: 'not_found', message: 'Opportunity record not found.' }, { status: 404 })
  }
  let body: PatchBody
  try {
    body = await req.json() as PatchBody
  } catch {
    return NextResponse.json({ tool: 'opportunity-agent-workforce', status: 'error', message: 'Invalid JSON body.' }, { status: 400 })
  }
  const evidence = body.evidence?.trim() || null
  if (body.decision === 'approve') {
    const result = approveForPursuit(record, evidence ?? 'Commander approved pursuit from Opportunity Agent Workforce UI.')
    return NextResponse.json({ tool: 'opportunity-agent-workforce', status: result.ok ? 'approved_for_pursuit' : 'blocked', record, result, persistence: 'session_only' })
  }
  if (body.decision === 'reject') {
    const result = transitionOpportunityStatus(record, 'REJECTED', evidence ?? 'Commander rejected pursuit.', 'commander')
    return NextResponse.json({ tool: 'opportunity-agent-workforce', status: 'rejected', record, result, persistence: 'session_only' })
  }
  if (body.decision === 'defer') {
    const result = transitionOpportunityStatus(record, 'DEFERRED', evidence ?? 'Commander deferred pursuit.', 'commander')
    return NextResponse.json({ tool: 'opportunity-agent-workforce', status: 'deferred', record, result, persistence: 'session_only' })
  }
  if (body.decision === 'request_research') {
    const result = transitionOpportunityStatus(record, 'RESEARCHING', evidence ?? 'Commander requested more research.', 'commander')
    return NextResponse.json({ tool: 'opportunity-agent-workforce', status: 'research_requested', record, result, persistence: 'session_only' })
  }
  return NextResponse.json({ tool: 'opportunity-agent-workforce', status: 'error', message: 'Unsupported decision.' }, { status: 400 })
}
