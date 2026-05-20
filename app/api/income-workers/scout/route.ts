import { NextResponse } from 'next/server'
import { emitEvent } from '@/lib/events/bus'
import { createIncomeCouncilReview } from '@/lib/income-workers/councilReview'
import { scoutIncomeWorkerOpportunities } from '@/lib/income-workers/scout'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function sanitizeClientMessage(message: string): string {
  if (/api[_-]?key|secret|token|bearer|stack trace|at\s+\w+\./i.test(message)) {
    return 'Income Worker scout completed in degraded mode. Review fallback opportunities.'
  }
  return message
}

export async function POST(req: Request) {
  let threadId = 'income-workers'
  try {
    const raw = await req.json().catch(() => ({}))
    if (raw && typeof raw === 'object' && typeof (raw as { threadId?: string }).threadId === 'string') {
      const trimmed = (raw as { threadId: string }).threadId.trim()
      if (trimmed) threadId = trimmed
    }
  } catch {
    // empty body is fine
  }

  const result = await scoutIncomeWorkerOpportunities(threadId)
  const sup = tryWarRoomSupabase()
  const reviews = result.candidates.map(candidate => createIncomeCouncilReview(candidate))

  await Promise.all(reviews.map(review => emitEvent({
    supabase: sup.ok ? sup.client : null,
    type: 'income.opportunity.discovered',
    source: 'worker',
    correlationId: review.opportunityId,
    payload: {
      opportunityId: review.opportunityId,
      summary: review.summary,
      source: review.source,
      riskLevel: review.riskLevel,
      incomePotential: review.incomePotential,
      nextAction: review.nextAction,
      degradedMode: Boolean(result.degradedMode),
      evidenceLabel: result.degradedMode ? 'HISTORICAL_PATTERN_BASED' : 'LIVE_SIGNAL_BACKED',
    },
  })))

  const hasResults = result.candidates.length > 0
  const httpStatus = result.status === 'error' && !hasResults ? 503 : 200

  return NextResponse.json({
    tool: 'income-workers-scout',
    state: result.executionState ?? (hasResults ? 'awaiting_commander_review' : 'failed'),
    ...result,
    message: sanitizeClientMessage(result.message),
    councilReviews: reviews,
    diagnostics: result.diagnostics,
    activityLog: result.activityLog ?? [],
    opportunities: result.opportunityPackets ?? [],
    eventBus: {
      emitted: reviews.length,
      type: 'income.opportunity.discovered',
      persistence: sup.ok ? 'available' : 'unavailable',
    },
  }, { status: httpStatus })
}
