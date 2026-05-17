import { buildAutomationReadinessSnapshot } from '@/lib/automation/automationReadiness'
import { jsonWithPersistence } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const snapshot = await buildAutomationReadinessSnapshot()
  return jsonWithPersistence({
    generatedAt: snapshot.generatedAt,
    financialGuardrails: snapshot.domains.map(domain => ({
      domainId: domain.id,
      label: domain.label,
      limits: domain.financialLimits,
      restrictions: domain.restrictions,
    })),
    throttles: snapshot.throttles,
    rollbackPlans: snapshot.rollbackPlans,
  }, snapshot.persistenceAvailable)
}
