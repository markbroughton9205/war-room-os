import {
  AppleReminderActionPacketFactory,
  AppleReminderRollbackPlanner,
} from '../apple-reminders-bridge'
import {
  createValidPacketInput,
  createValidReceipt,
  createValidRollbackReceipt,
} from '../apple-reminders-bridge/appleReminderFixtures'
import type {
  AppleReminderActionPacket,
  AppleReminderRollbackPacket,
  AppleReminderShortcutReceipt,
} from '../apple-reminders-bridge'
import { ledgerEntryFromApplePacket, ledgerEntryFromRollbackPacket } from './ledgerEntryFactory'
import type { AutoModeSingleUseLedgerEntry } from './types'

export const LEDGER_NOW = '2026-07-07T12:01:00.000Z'

export type LedgerFixture = {
  packet: AppleReminderActionPacket
  receipt: AppleReminderShortcutReceipt
  entry: AutoModeSingleUseLedgerEntry
}

export function createLedgerFixture(overrides: {
  packetId?: string
  nonce?: string
  receiptId?: string
  expiresAt?: string
  targetId?: string
} = {}): LedgerFixture {
  const input = createValidPacketInput({
    packetId: overrides.packetId,
    expiresAt: overrides.expiresAt,
  })
  const packet = new AppleReminderActionPacketFactory().create(input).packet
  if (!packet) throw new Error('Unable to create 46L fixture packet.')
  const patchedPacket: AppleReminderActionPacket = {
    ...packet,
    packetId: overrides.packetId ?? packet.packetId,
    scope: {
      ...packet.scope,
      reminderId: overrides.targetId ?? packet.scope.reminderId,
    },
    constraints: {
      ...packet.constraints,
      nonce: overrides.nonce ?? packet.constraints.nonce,
      expiresAt: overrides.expiresAt ?? packet.constraints.expiresAt,
    },
  }
  const receipt = createValidReceipt(patchedPacket, {
    receiptId: overrides.receiptId ?? 'receipt_46l_valid',
    nonce: patchedPacket.constraints.nonce,
  })
  const entry = ledgerEntryFromApplePacket(patchedPacket)

  return { packet: patchedPacket, receipt, entry }
}

export function createRollbackLedgerFixture(originalEntry: AutoModeSingleUseLedgerEntry): {
  rollbackPacket: AppleReminderRollbackPacket
  rollbackEntry: AutoModeSingleUseLedgerEntry
  rollbackReceiptId: string
} {
  const fixture = createLedgerFixture()
  const receipt = createValidReceipt(fixture.packet)
  const rollbackPacket = new AppleReminderRollbackPlanner().createRollbackPacket({
    originalReceipt: receipt,
    exactApprovedText: fixture.packet.exactApprovedText,
    nonce: 'rollback_nonce_46l',
  })
  const rollbackEntry = ledgerEntryFromRollbackPacket(rollbackPacket, originalEntry)
  const rollbackReceipt = createValidRollbackReceipt(rollbackPacket)

  return {
    rollbackPacket,
    rollbackEntry,
    rollbackReceiptId: rollbackReceipt.rollbackReceiptId,
  }
}
