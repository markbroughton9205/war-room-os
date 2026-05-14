import { NextResponse } from 'next/server'
import { INCOME_WORKER_WORKFLOW, INCOME_WORKERS } from '@/lib/income-workers/registry'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'

export async function GET() {
  const sup = tryWarRoomSupabase()
  const status = {
    activeMissions: 0,
    pendingApprovals: 0,
    expectedPayouts: 0,
    completedWork: 0,
  }

  if (sup.ok) {
    const [{ count: opportunities }, { count: approvals }] = await Promise.all([
      sup.client
        .from('income_opportunities')
        .select('id', { count: 'exact', head: true })
        .in('status', ['applied', 'active']),
      sup.client
        .from('rael_action_queue')
        .select('action_id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .eq('source_agent', 'Income Workers'),
    ])
    status.activeMissions = opportunities ?? 0
    status.pendingApprovals = approvals ?? 0
  }

  return NextResponse.json({
    tool: 'income-workers',
    status: 'ready',
    workers: INCOME_WORKERS,
    workflow: INCOME_WORKER_WORKFLOW,
    runtimeRules: [
      'no fake opportunities',
      'all opportunities source-linked',
      'external applications require approval unless standing permission exists',
      'no autonomous banking or transfers',
      'actual payout requires recorded proof',
    ],
    metrics: status,
    persistence: sup.ok ? 'available' : 'unavailable',
  })
}
