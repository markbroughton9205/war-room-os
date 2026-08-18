import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { getRecord } from '@/lib/opportunity-agents/store'
import { fromOpportunityAgentRecord } from '@/lib/opportunity-readiness/adapters'
import { assessOpportunityReadiness } from '@/lib/opportunity-readiness/readinessEngine'
import { detectRecurringGaps } from '@/lib/opportunity-readiness/developmentGapDetector'
import { parseAssessRequestBody } from '@/lib/opportunity-readiness/requestValidation'
import type { AssessmentInput, NormalizedOpportunityInput } from '@/lib/opportunity-readiness/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function errorResponse(message: string, status: number) {
  return NextResponse.json({
    tool: 'opportunity-readiness',
    status: 'error',
    message,
    persistence: 'session_only',
    externalActionsExecuted: false,
  }, { status })
}

export async function POST(req: Request) {
  const commander = await requireCommanderSession('Commander Qualification & Readiness Engine')
  if (!commander.ok) return commander.response

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('Invalid JSON body.', 400)
  }

  const parsed = parseAssessRequestBody(body)
  if (!parsed.ok) return errorResponse(parsed.message, parsed.status)

  let opportunity: NormalizedOpportunityInput
  if (parsed.value.opportunity) {
    opportunity = parsed.value.opportunity
  } else {
    // opportunityId path — read-only lookup against the existing Phase 49-C
    // in-memory store. That store has no per-owner scoping (single-Commander
    // architecture, same as every other route reading it), so this carries
    // no different exposure than the existing /api/opportunity-agents/[id] route.
    const record = getRecord(parsed.value.opportunityId as string)
    if (!record) return errorResponse('No opportunity record found for the supplied opportunityId.', 404)
    opportunity = fromOpportunityAgentRecord(record)
  }

  const input: AssessmentInput = {
    opportunity,
    commanderFacts: parsed.value.commanderFacts,
    commanderDecision: parsed.value.commanderDecision,
  }

  const card = assessOpportunityReadiness(input)

  return NextResponse.json({
    tool: 'opportunity-readiness',
    status: 'assessed',
    message: 'Commander Readiness Card prepared. No external action was taken and no durable memory was written.',
    card,
    recurringDevelopmentGaps: detectRecurringGaps(),
    persistence: 'session_only',
    externalActionsExecuted: false,
    durableMemoryWritten: false,
  })
}
