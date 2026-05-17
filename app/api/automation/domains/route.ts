import { buildAutomationReadinessSnapshot } from '@/lib/automation/automationReadiness'
import { jsonWithPersistence } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const snapshot = await buildAutomationReadinessSnapshot()
  return jsonWithPersistence({
    generatedAt: snapshot.generatedAt,
    domains: snapshot.domains,
    plans: snapshot.plans.map(plan => ({
      id: plan.id,
      domainId: plan.domainId,
      modeId: plan.modeId,
      queueScope: plan.queueScope,
      policy: plan.policy.status,
      checkpoint: plan.checkpoint.decision,
      actualExecutionAllowed: plan.actualExecutionAllowed,
    })),
  }, snapshot.persistenceAvailable)
}
