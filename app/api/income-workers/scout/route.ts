import { NextResponse } from 'next/server'
import { emitEvent } from '@/lib/events/bus'
import { createIncomeCouncilReview } from '@/lib/income-workers/councilReview'
import { scoutIncomeWorkerOpportunities } from '@/lib/income-workers/scout'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  const result = await scoutIncomeWorkerOpportunities()
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
    },
  })))

  const httpStatus = result.status === 'error' ? 503 : 200

  return NextResponse.json({
    tool: 'income-workers-scout',
    ...result,
    councilReviews: reviews,
    eventBus: {
      emitted: reviews.length,
      type: 'income.opportunity.discovered',
      persistence: sup.ok ? 'available' : 'unavailable',
    },
  }, { status: httpStatus })
}
