import { NextResponse } from 'next/server'
import { detectRedTeamCoderIssues } from '@/lib/red-team-coder/detector'
import { createLatestRepairPlan } from '@/lib/red-team-coder/repairPlanner'
import type { RedTeamCoderRepairPlan, RedTeamCoderSignal } from '@/lib/red-team-coder/types'
import { appendWarRoomActionLog } from '@/lib/war-room/actionLogs'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'

/** Queue persistence: primary `war_room_actions`; legacy fallback `rael_action_queue` (JSON `queue` labels path). */

export const dynamic = 'force-dynamic'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asSignal(value: unknown): RedTeamCoderSignal {
  return isRecord(value) && isRecord(value.signal) ? value.signal as RedTeamCoderSignal : {}
}

function conversationIdFromBody(value: unknown, signal: RedTeamCoderSignal): string | null {
  if (typeof signal.conversationId === 'string' && signal.conversationId.trim()) return signal.conversationId.trim()
  if (isRecord(value) && typeof value.conversationId === 'string' && value.conversationId.trim()) return value.conversationId.trim()
  return null
}

async function queueRepairAction(
  plan: RedTeamCoderRepairPlan,
  body: unknown,
  signal: RedTeamCoderSignal,
): Promise<{
  actionQueued: boolean
  actionId: string | null
  persistence: 'available' | 'unavailable'
  message?: string
  queue?: 'war_room_actions' | 'legacy_fallback'
}> {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) {
    return {
      actionQueued: false,
      actionId: null,
      persistence: 'unavailable',
      message: 'Supabase is not configured; repair plan returned without queue persistence.',
    }
  }

  const conversationId = conversationIdFromBody(body, signal)
  const { data: recent } = await sup.client
    .from('war_room_actions')
    .select('id,status,payload,created_at')
    .eq('type', 'red_team_coder_repair')
    .order('created_at', { ascending: false })
    .limit(20)

  const duplicate = (recent ?? []).find(row => {
    const payload = row.payload as { repairPlan?: { issueId?: string } } | null
    return payload?.repairPlan?.issueId === plan.issueId && row.status === 'requested'
  })

  if (duplicate) {
    return {
      actionQueued: true,
      actionId: duplicate.id as string,
      persistence: 'available',
      message: 'Existing open repair task reused.',
      queue: 'war_room_actions',
    }
  }

  const insert = {
    type: 'red_team_coder_repair',
    payload: {
      issue: {
        issueId: plan.issueId,
        severity: plan.severity,
        detectedAt: plan.detectedAt,
        symptom: plan.symptom,
      },
      repairPlan: plan,
      recommendedAgent: plan.recommendedAgent,
      approvalRequired: true,
      source: 'red_team_coder',
    },
    conversation_id: conversationId,
    status: 'requested',
    approval_granted: false,
  }

  const { data, error } = await sup.client
    .from('war_room_actions')
    .insert(insert)
    .select('id,status')
    .single()

  if (error) {
    const actionId = `red_team_coder_${plan.issueId}`.slice(0, 120)
    const { data: raelAction, error: raelError } = await sup.client
      .from('rael_action_queue')
      .upsert([{
        action_id: actionId,
        related_opportunity_id: null,
        title: 'Red Team Coder repair plan',
        question: `${plan.symptom} Recommended agent: ${plan.recommendedAgent}. Approve repair planning?`,
        response_options: ['Approve', 'Decline', 'Assign Cursor'],
        status: 'pending',
        urgency: plan.severity === 'critical' ? 'high' : 'medium',
        expires_at: null,
        source_agent: 'Red Team Coder',
      }], { onConflict: 'action_id' })
      .select('action_id')
      .single()

    if (raelError) {
      return {
        actionQueued: false,
        actionId: null,
        persistence: 'available',
        message: `${error.message}; fallback action queue failed: ${raelError.message}`,
      }
    }

    return {
      actionQueued: true,
      actionId: String(raelAction.action_id),
      persistence: 'available',
      message: 'Repair task queued in Rael Action Queue fallback.',
      queue: 'legacy_fallback',
    }
  }

  await appendWarRoomActionLog(sup.client, data.id, 'Red Team Coder repair plan queued.', 'warn', {
    issueId: plan.issueId,
    recommendedAgent: plan.recommendedAgent,
  })

  return { actionQueued: true, actionId: data.id, persistence: 'available', queue: 'war_room_actions' }
}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const signal = asSignal(body)
  const issues = detectRedTeamCoderIssues(signal)
  const latestRepairPlan = createLatestRepairPlan(issues)

  if (!latestRepairPlan) {
    return NextResponse.json({
      status: 'watching',
      issues,
      latestRepairPlan: null,
      actionQueued: false,
      actionId: null,
      persistence: 'unavailable',
      message: 'No chat/orchestration failure detected.',
    })
  }

  const queue = await queueRepairAction(latestRepairPlan, body, signal)

  return NextResponse.json({
    status: 'repair_planned',
    issues,
    latestRepairPlan,
    actionQueued: queue.actionQueued,
    actionId: queue.actionId,
    persistence: queue.persistence,
    message: queue.message,
    ...(queue.queue ? { queue: queue.queue } : {}),
  })
}
