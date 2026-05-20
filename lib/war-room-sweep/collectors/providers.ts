import 'server-only'

import { collectRepairIntelligence } from '@/lib/evolution/repairIntelligence'
import type { SweepFinding } from '../types'

export async function collectProviderFindings(req: Request): Promise<SweepFinding[]> {
  const snapshot = await collectRepairIntelligence(req)
  const items = [
    ...snapshot.sections.provider_issues,
    ...snapshot.sections.runtime_degradation,
  ]
  return items.map(item => ({
    id: `sweep:provider:${item.id}`,
    title: item.title,
    category: 'provider_runtime' as const,
    severity: item.severity,
    evidence: item.evidence,
    affectedFeature: item.affectedPanel,
    affectedPanel: item.affectedPanel,
    suggestedAction: item.validationCommands[0]
      ? `Validate: ${item.validationCommands.join(' · ')}`
      : 'Refresh canonical runtime and provider health probes.',
    classification: 'fix' as const,
    repairPacketAvailable: item.repairPacketAvailable,
    cursorReadyCommand: item.cursorCommand,
  }))
}
