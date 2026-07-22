import { formatRepairPacketReport, type CouncilRepairPacket } from '@/lib/council-repair'

import type { RedTeamWorkspaceItem } from './types'

/** No invented fields — if a repair packet exists for this item, its report is the canonical one. */
export function formatRedTeamWorkspaceItemReport(item: RedTeamWorkspaceItem, packet?: CouncilRepairPacket | null): string {
  if (packet) return formatRepairPacketReport(packet)

  const lines: string[] = [
    `Red Team Workspace Item Report — ${item.id}`,
    '',
    `Source: ${item.source}`,
    `Classification: ${item.classification}`,
    `Severity: ${item.severity}`,
    `Affected subsystem: ${item.affectedSubsystem}`,
    '',
    'Observation:',
    item.observation,
    '',
    'Evidence:',
    ...item.evidence.map(e => `- ${e}`),
    '',
    'Suspected cause:',
    item.suspectedCause,
    '',
    'Confirmed cause:',
    item.confirmedCause ?? 'Not confirmed — no confirmation mechanism exists.',
    '',
    'Security impact:',
    item.securityImpact,
    '',
    'User impact:',
    item.userImpact,
    '',
    'Reliability impact:',
    item.reliabilityImpact,
    '',
    'Recommended repair:',
    item.recommendedRepair,
    '',
    'Verification plan:',
    ...(item.verificationPlan.length ? item.verificationPlan.map(v => `- ${v}`) : ['- Not tracked by this source.']),
    '',
    'Rollback plan:',
    ...(item.rollbackPlan?.length ? item.rollbackPlan.map(r => `- ${r}`) : ['- Not produced by this source.']),
    '',
    'Unresolved questions:',
    ...item.unresolvedQuestions.map(q => `- ${q}`),
  ]

  return lines.join('\n')
}
