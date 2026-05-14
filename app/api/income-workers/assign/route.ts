import { NextResponse } from 'next/server'
import { emitEvent } from '@/lib/events/bus'
import { createIncomeWorkerAssignmentPlan } from '@/lib/income-workers/assignment'
import { createIncomeCouncilReview } from '@/lib/income-workers/councilReview'
import type { IncomeWorkerAssignmentRequest } from '@/lib/income-workers/types'
import { createExpectedDepositRecord } from '@/lib/payments/depositStore'
import { recordPaymentAudit } from '@/lib/payments/paymentAudit'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let body: IncomeWorkerAssignmentRequest
  try {
    body = await req.json() as IncomeWorkerAssignmentRequest
  } catch {
    return NextResponse.json({ tool: 'income-workers-assign', status: 'error', message: 'Invalid JSON body.' }, { status: 400 })
  }

  let plan
  try {
    plan = createIncomeWorkerAssignmentPlan(body)
  } catch (error) {
    return NextResponse.json({
      tool: 'income-workers-assign',
      status: 'error',
      message: error instanceof Error ? error.message : 'Unable to create assignment plan.',
    }, { status: 400 })
  }

  const sup = tryWarRoomSupabase()
  const review = body.candidate ? createIncomeCouncilReview(body.candidate, [plan.missionId]) : null
  if (!sup.ok) {
    return NextResponse.json({
      tool: 'income-workers-assign',
      status: 'queued_without_persistence',
      message: 'Assignment plan created, but Supabase action queue is unavailable.',
      plan,
      councilReview: review,
      actionQueued: false,
      persistence: 'unavailable',
    })
  }

  const { data, error } = await sup.client
    .from('rael_action_queue')
    .upsert([{
      action_id: plan.missionId,
      related_opportunity_id: body.opportunityId ?? null,
      title: `Income mission: ${plan.title}`,
      question: `Assign ${plan.workerName} to work this opportunity under approval gates?`,
      response_options: ['Approve', 'Decline', 'Summarize first'],
      status: 'pending',
      urgency: body.candidate?.riskLevel === 'high' ? 'high' : 'medium',
      expires_at: null,
      source_agent: 'Income Workers',
    }], { onConflict: 'action_id' })
    .select('action_id,status')
    .single()

  if (error) {
    return NextResponse.json({
      tool: 'income-workers-assign',
      status: 'error',
      message: error.message,
      plan,
      actionQueued: false,
      persistence: 'available',
    }, { status: 500 })
  }

  if (review) {
    await emitEvent({
      supabase: sup.client,
      type: 'income.opportunity.reviewed',
      source: 'worker',
      correlationId: review.opportunityId,
      payload: review as unknown as Record<string, unknown>,
    })
    await emitEvent({
      supabase: sup.client,
      type: 'income.opportunity.assigned',
      source: 'worker',
      correlationId: review.opportunityId,
      payload: {
        opportunityId: review.opportunityId,
        actionQueueIds: [data.action_id],
        workerId: plan.workerId,
        workerName: plan.workerName,
        approvalRequired: true,
      },
    })

    if (plan.expectedPayout) {
      const createdDeposit = await createExpectedDepositRecord({
        opportunityId: review.opportunityId,
        incomeWorkerId: plan.workerId,
        platformProvider: 'manual_proof',
        payerPlatformName: body.candidate?.source ?? 'Opportunity platform',
        expectedAmount: plan.expectedPayout,
        currency: body.candidate?.currency ?? 'USD',
        proofRequired: true,
      })
      const deposit = createdDeposit.data
      await emitEvent({
        supabase: sup.client,
        type: 'income.deposit.expected',
        source: 'worker',
        correlationId: deposit.depositId,
        payload: deposit as unknown as Record<string, unknown>,
      })
      await recordPaymentAudit(sup.client, 'Deposit expected', {
        depositId: deposit.depositId,
        opportunityId: review.opportunityId,
        incomeWorkerId: plan.workerId,
        persistence: createdDeposit.persistence,
      })
    }
  }

  return NextResponse.json({
    tool: 'income-workers-assign',
    status: 'queued',
    message: 'Income mission queued for Ra’el approval.',
    plan,
    councilReview: review,
    actionQueued: true,
    actionId: data.action_id,
    actionStatus: data.status,
    persistence: 'available',
  })
}
