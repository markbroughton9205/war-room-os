import 'server-only'

import { collectRepairIntelligence } from '@/lib/evolution/repairIntelligence'
import type { SweepFinding } from '../types'

export async function collectMissingConfigFindings(req: Request): Promise<SweepFinding[]> {
  const snapshot = await collectRepairIntelligence(req)
  return snapshot.missingConfiguration.map(item => ({
    id: `sweep:config:${item.id}`,
    title: item.name,
    category: 'missing_configuration' as const,
    severity: item.severity,
    evidence: [item.reason, item.requiredFix].filter(Boolean),
    affectedFeature: item.affectedFeature,
    affectedPanel: item.affectedPanel ?? 'Configuration',
    suggestedAction: item.requiredFix,
    classification: 'fix' as const,
    repairPacketAvailable: item.repairPacketAvailable,
    cursorReadyCommand: item.envVarNames?.length
      ? `Configure env vars (names only): ${item.envVarNames.join(', ')}. Then GET /api/configuration/sweep`
      : undefined,
  }))
}
