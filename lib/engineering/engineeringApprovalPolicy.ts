import type { EngineeringAuditEntry, EngineeringRepairMemoryEntry, EngineeringTaskPacket } from './engineeringTaskPacket'

export type EngineeringApprovalDecision = {
  approvalRequired: true
  status: 'awaiting_commander_approval'
  canExecute: false
  canModifyFiles: false
  canCommit: false
  canPush: false
  canDeploy: false
  canDelete: false
  reason: string
}

export const ENGINEERING_APPROVAL_POLICY: EngineeringApprovalDecision = {
  approvalRequired: true,
  status: 'awaiting_commander_approval',
  canExecute: false,
  canModifyFiles: false,
  canCommit: false,
  canPush: false,
  canDeploy: false,
  canDelete: false,
  reason: 'Engineering work may be prepared and reviewed, but execution and repo mutation require Commander approval.',
}

export function evaluateEngineeringApprovalPolicy(): EngineeringApprovalDecision {
  return { ...ENGINEERING_APPROVAL_POLICY }
}

export function buildEngineeringAuditEntry(packet: EngineeringTaskPacket): EngineeringAuditEntry {
  return {
    category: 'engineering',
    message: `Engineering task prepared; awaiting Commander approval: ${packet.title}`,
    metadata: {
      taskPacketId: packet.id,
      executor: 'cursor',
      approvalRequired: true,
      canMutateFromWarRoom: false,
      source: 'live_council',
    },
  }
}

export function buildEngineeringRepairMemoryEntry(packet: EngineeringTaskPacket): EngineeringRepairMemoryEntry {
  return {
    issue: packet.currentIssue,
    expectedFiles: [...packet.filesToInspect],
    validationPlan: [...packet.validationCommands],
    rollbackNotes: packet.rollbackRecommendation,
    status: 'prepared_not_executed',
  }
}
