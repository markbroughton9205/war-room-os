import { buildAutomationReadinessSnapshot } from '@/lib/automation/automationReadiness'
import { jsonWithPersistence } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const snapshot = await buildAutomationReadinessSnapshot()
  return jsonWithPersistence({
    generatedAt: snapshot.generatedAt,
    integrationStatus: snapshot.integrationStatus,
    persistenceAvailable: snapshot.persistenceAvailable,
    guardrails: snapshot.guardrails,
    tables: snapshot.tables,
    modes: snapshot.modes,
    planCount: snapshot.plans.length,
    lifecycle: snapshot.lifecycle,
    foundryAssignments: snapshot.foundryAssignments,
  }, snapshot.persistenceAvailable)
}
