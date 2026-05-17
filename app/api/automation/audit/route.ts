import { buildAutomationReadinessSnapshot } from '@/lib/automation/automationReadiness'
import { jsonWithPersistence } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const snapshot = await buildAutomationReadinessSnapshot()
  return jsonWithPersistence({
    generatedAt: snapshot.generatedAt,
    audits: snapshot.audits,
    escalations: snapshot.escalations,
    rollbackPlans: snapshot.rollbackPlans,
  }, snapshot.persistenceAvailable)
}
