import type { CouncilRepairPacket } from './model'

export type RepairPacketReportContext = {
  actionId?: string
  actionStatus?: string
}

/** rollbackPlan is the spec-aligned field; rollbackNotes is the legacy backing field with the same content today. */
function sameStringArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index])
}

/** Plain-text report drawn only from fields that exist on the packet — no invented content. */
export function formatRepairPacketReport(packet: CouncilRepairPacket, context?: RepairPacketReportContext): string {
  const lines: string[] = [
    `Repair Packet Report — ${packet.title}`,
    '',
    `Packet id: ${packet.id}`,
    `Timestamp: ${packet.createdAt}`,
    `Source: ${packet.source.packetSource}`,
    `Severity: ${packet.severity}`,
    `Status: ${packet.status}`,
    `Approval state: ${packet.approvalStatus}`,
  ]

  if (context?.actionId) lines.push(`Approval action id: ${context.actionId}`)
  if (context?.actionStatus) lines.push(`Approval action status: ${context.actionStatus}`)

  lines.push(
    '',
    'Issue summary:',
    packet.summary,
    '',
    'Concrete issue:',
    packet.concreteIssue,
    '',
    'Evidence:',
    ...packet.evidence.map(item => `- ${item}`),
    '',
    'Security impact:',
    packet.securityImpact,
    '',
    'User impact:',
    packet.userImpact,
    '',
    'Reliability impact:',
    packet.reliabilityImpact,
    '',
    'Council recommendation:',
    packet.councilRecommendation,
    '',
    'Red Team recommendation:',
    packet.redTeamRecommendation,
    '',
    'Proposed repair:',
    packet.proposedRepair,
    '',
    'Verification requirements:',
    ...packet.verificationRequirements.map(item => `- ${item}`),
    '',
    'Rollback plan:',
    ...packet.rollbackPlan.map(item => `- ${item}`),
  )

  if (packet.rollbackNotes.length && !sameStringArray(packet.rollbackPlan, packet.rollbackNotes)) {
    lines.push(
      '',
      'Rollback notes:',
      ...packet.rollbackNotes.map(item => `- ${item}`),
    )
  }

  lines.push(
    '',
    'Guardrails:',
    ...Object.entries(packet.guardrails).map(([key, value]) => `- ${key}: ${value}`),
  )

  return lines.join('\n')
}
