import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { listEconomicSurface } from '@/lib/economic/store'

export const dynamic = 'force-dynamic'

export async function GET() {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) {
    return jsonWithPersistence({
      opportunities: [],
      workflows: [],
      proposals: [],
      missions: [],
      telemetry: [],
      providerEffectiveness: [],
      unresolvedOperations: [],
      assignmentHistory: [],
      stats: null,
    }, false)
  }

  const rows = await listEconomicSurface(sup.client, 80)
  if (!rows.ok) {
    return jsonWithPersistence({ error: rows.error }, true, { status: 500 })
  }

  const activeOpportunities = rows.value.opportunities.filter(o => !['completed', 'rejected', 'archived'].includes(o.status))
  const completedWorkflows = rows.value.workflows.filter(w => w.status === 'completed')
  const approvedOpportunities = rows.value.opportunities.filter(o => ['approved', 'queued', 'executing', 'completed'].includes(o.status))
  const estimatedPipelineValue = activeOpportunities.reduce((sum, opp) => sum + (opp.estimated_value ?? 0), 0)
  const providerTotals = rows.value.providerEffectiveness.reduce(
    (acc, row) => ({
      success: acc.success + row.success_count,
      failure: acc.failure + row.failure_count,
    }),
    { success: 0, failure: 0 },
  )
  const providerSuccessRate = providerTotals.success + providerTotals.failure === 0
    ? 0
    : providerTotals.success / (providerTotals.success + providerTotals.failure)

  return jsonWithPersistence({
    ...rows.value,
    stats: {
      activeOpportunities: activeOpportunities.length,
      estimatedPipelineValue,
      completedWorkflows: completedWorkflows.length,
      providerSuccessRate,
      proposalGenerationVolume: rows.value.proposals.length,
      opportunityConversionRate: rows.value.opportunities.length === 0
        ? 0
        : approvedOpportunities.length / rows.value.opportunities.length,
      missionThroughput: rows.value.missions.filter(m => ['queued', 'executing', 'completed'].includes(m.status)).length,
      unresolvedOperations: rows.value.unresolvedOperations.filter(o => o.status !== 'resolved' && o.status !== 'archived').length,
    },
  }, true)
}
