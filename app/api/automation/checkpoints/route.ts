import { buildAutomationReadinessSnapshot } from '@/lib/automation/automationReadiness'
import { jsonWithPersistence } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const snapshot = await buildAutomationReadinessSnapshot()
  return jsonWithPersistence({
    generatedAt: snapshot.generatedAt,
    checkpoints: snapshot.checkpoints,
    policies: snapshot.policies,
  }, snapshot.persistenceAvailable)
}
