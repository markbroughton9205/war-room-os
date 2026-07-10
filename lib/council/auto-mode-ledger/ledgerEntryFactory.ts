import { randomUUID } from 'crypto'
import type {
  AppleReminderActionPacket,
  AppleReminderRollbackPacket,
} from '../apple-reminders-bridge'
import type { AutoModeSingleUseLedgerEntry } from './types'

export function ledgerEntryFromApplePacket(
  packet: AppleReminderActionPacket,
  overrides: Partial<AutoModeSingleUseLedgerEntry> = {}
): AutoModeSingleUseLedgerEntry {
  return {
    ledgerId: overrides.ledgerId ?? randomUUID(),
    packetId: packet.packetId,
    explicitExecutionApprovalId: packet.explicitExecutionApprovalId,
    receiptId: null,
    rollbackPacketId: null,
    rollbackReceiptId: null,
    nonce: packet.constraints.nonce,
    actionType: 'mark_apple_reminder_read',
    targetSystem: 'apple_reminders',
    targetId: packet.scope.reminderId,
    ledgerEntryKind: 'action_packet',
    status: 'issued',
    createdAt: packet.constraints.createdAt,
    expiresAt: packet.constraints.expiresAt,
    consumedAt: null,
    rejectedAt: null,
    rejectionReason: null,
    verificationHash: stableVerificationHash([
      packet.packetId,
      packet.approvalId,
      packet.constraints.nonce,
      packet.scope.reminderId,
    ]),
    metadata: {
      bridge: 'iphone_shortcut',
      singleUse: true,
      manualExecutionRequired: true,
      sourcePhase: '46L',
    },
    ...overrides,
  }
}

export function ledgerEntryFromRollbackPacket(
  rollbackPacket: AppleReminderRollbackPacket,
  original: AutoModeSingleUseLedgerEntry,
  overrides: Partial<AutoModeSingleUseLedgerEntry> = {}
): AutoModeSingleUseLedgerEntry {
  return {
    ledgerId: overrides.ledgerId ?? randomUUID(),
    packetId: rollbackPacket.rollbackPacketId,
    explicitExecutionApprovalId: original.explicitExecutionApprovalId,
    receiptId: original.receiptId,
    rollbackPacketId: rollbackPacket.rollbackPacketId,
    rollbackReceiptId: null,
    nonce: rollbackPacket.nonce,
    actionType: 'mark_apple_reminder_read',
    targetSystem: 'apple_reminders',
    targetId: rollbackPacket.rollbackPlan.reminderId,
    ledgerEntryKind: 'rollback_packet',
    status: 'rollback_issued',
    createdAt: rollbackPacket.createdAt,
    expiresAt: rollbackPacket.expiresAt,
    consumedAt: null,
    rejectedAt: null,
    rejectionReason: null,
    verificationHash: stableVerificationHash([
      rollbackPacket.rollbackPacketId,
      rollbackPacket.originalPacketId,
      rollbackPacket.nonce,
      rollbackPacket.rollbackPlan.reminderId,
    ]),
    metadata: {
      bridge: 'iphone_shortcut',
      singleUse: true,
      manualExecutionRequired: true,
      sourcePhase: '46L',
    },
    ...overrides,
  }
}

export function stableVerificationHash(parts: string[]): string {
  let hash = 0
  const source = parts.join('|')

  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0
  }

  return `stable_${hash.toString(16).padStart(8, '0')}`
}
