import { NextResponse } from 'next/server'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'

type RedTeamCoderActionRow = {
  id: string
  status: string
  payload: Record<string, unknown> | null
  created_at: string
}

export async function GET() {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) {
    return NextResponse.json({
      status: 'watching',
      latestDetectedIssue: null,
      latestRepairPlan: null,
      recommendedAgent: null,
      approvalRequired: true,
      persistence: 'unavailable',
      message: 'Red Team Coder is watching locally. Action queue persistence is unavailable.',
    })
  }

  const { data, error } = await sup.client
    .from('war_room_actions')
    .select('id,status,payload,created_at')
    .eq('type', 'red_team_coder_repair')
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) {
    const fallback = await sup.client
      .from('rael_action_queue')
      .select('action_id,status,title,question,source_agent,created_at')
      .eq('source_agent', 'Red Team Coder')
      .order('created_at', { ascending: false })
      .limit(1)

    if (fallback.error) {
      return NextResponse.json({
        status: 'error',
        latestDetectedIssue: null,
        latestRepairPlan: null,
        recommendedAgent: null,
        approvalRequired: true,
        persistence: 'available',
        message: `${error.message}; fallback queue unavailable: ${fallback.error.message}`,
      })
    }

    const fallbackRow = fallback.data?.[0] ?? null
    return NextResponse.json({
      status: fallbackRow ? 'repair_planned' : 'watching',
      latestDetectedIssue: fallbackRow ? { symptom: fallbackRow.question, issueId: fallbackRow.action_id } : null,
      latestRepairPlan: null,
      recommendedAgent: null,
      approvalRequired: true,
      actionId: fallbackRow?.action_id ?? null,
      actionStatus: fallbackRow?.status ?? null,
      persistence: 'available',
      message: fallbackRow ? 'Latest Red Team Coder task is in Rael Action Queue fallback.' : error.message,
    })
  }

  const row = (data?.[0] ?? null) as RedTeamCoderActionRow | null
  const payload = row?.payload ?? {}
  const latestRepairPlan = payload.repairPlan ?? null
  const latestDetectedIssue = payload.issue ?? null
  const recommendedAgent = typeof payload.recommendedAgent === 'string' ? payload.recommendedAgent : null

  return NextResponse.json({
    status: row ? 'repair_planned' : 'watching',
    latestDetectedIssue,
    latestRepairPlan,
    recommendedAgent,
    approvalRequired: true,
    actionId: row?.id ?? null,
    actionStatus: row?.status ?? null,
    persistence: 'available',
  })
}
