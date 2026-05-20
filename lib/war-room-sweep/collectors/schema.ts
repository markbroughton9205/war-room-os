import 'server-only'

import { collectRepairIntelligence } from '@/lib/evolution/repairIntelligence'
import type { SweepFinding } from '../types'

export async function collectSchemaFindings(req: Request): Promise<SweepFinding[]> {
  const snapshot = await collectRepairIntelligence(req)
  const schemaItems = [
    ...snapshot.sections.schema_drift,
    ...snapshot.sections.required_migrations,
  ]
  return schemaItems.map(item => ({
    id: `sweep:schema:${item.id}`,
    title: item.title,
    category: 'schema_database' as const,
    severity: item.severity,
    evidence: item.evidence,
    affectedFeature: 'Database persistence',
    affectedPanel: item.affectedPanel,
    suggestedAction: item.suggestedSqlMigration
      ? 'Review schema repair packet in Engineering drawer → Schema Sweep.'
      : 'Apply listed migration from supabase/ and re-run schema sweep.',
    classification: 'fix' as const,
    repairPacketAvailable: item.repairPacketAvailable,
    cursorReadyCommand: item.cursorCommand,
  }))
}
