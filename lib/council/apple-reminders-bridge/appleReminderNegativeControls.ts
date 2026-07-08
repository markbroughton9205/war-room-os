import { AppleReminderActionPacketFactory, createAppleRemindersBridgePolicy } from './AppleReminderActionPacket'
import { AppleReminderReceiptVerifier } from './AppleReminderReceiptVerifier'
import { AppleReminderRollbackPlanner } from './AppleReminderRollbackPlanner'
import { AppleReminderRollbackVerifier } from './AppleReminderRollbackVerifier'
import { AppleShortcutBridgeUrlBuilder } from './AppleShortcutBridgeUrlBuilder'
import {
  createValidApproval,
  createValidPacketInput,
  createValidReceipt,
  createValidRollbackReceipt,
} from './appleReminderFixtures'
import type { AppleReminderBridgeValidationResult } from './types'

export function runAppleReminderNegativeControls(): AppleReminderBridgeValidationResult[] {
  return [
    packetCase('negative_01_bridge_disabled', 'Bridge disabled blocks packet.', {
      policy: createAppleRemindersBridgePolicy({ allowedLiveActionTypes: ['mark_apple_reminder_read'] }),
    }, 'blocked'),
    packetCase('negative_02_real_auto_attempted_true', 'Attempted global real Auto Mode remains false.', {
      policy: createAppleRemindersBridgePolicy({
        iphoneShortcutBridgeEnabled: true,
        appleRemindersBridgeEnabled: true,
        realAutoModeEnabledAttempted: true,
        allowedLiveActionTypes: ['mark_apple_reminder_read'],
      }),
    }, 'blocked'),
    packetCase('negative_03_wrong_action', 'Create reminder action blocked.', {
      actionType: 'create_apple_reminder',
    }, 'blocked'),
    packetCase('negative_04_delete_reminder', 'Delete reminder action blocked.', {
      actionType: 'delete_apple_reminder',
    }, 'blocked'),
    packetCase('negative_05_bulk_action', 'Bulk complete action blocked.', {
      actionType: 'bulk_complete_reminders',
    }, 'blocked'),
    packetCase('negative_06_bundled_send', 'Bundled message signal blocks packet.', {
      blockedSignals: ['message_send'],
    }, 'blocked'),
    packetCase('negative_07_bundled_memory', 'Bundled memory signal blocks packet.', {
      blockedSignals: ['memory_commit'],
    }, 'blocked'),
    packetCase('negative_08_bundled_database', 'Bundled database signal blocks packet.', {
      blockedSignals: ['database_mutation'],
    }, 'blocked'),
    packetCase('negative_09_bundled_provider', 'Bundled provider signal blocks packet.', {
      blockedSignals: ['provider_call'],
    }, 'blocked'),
    packetCase('negative_10_missing_approval', 'Missing ExplicitExecutionApproval blocks packet.', {
      approval: null,
    }, 'blocked'),
    packetCase('negative_11_duck_typed_approval', 'Duck-typed approval object blocks packet.', {
      approval: { autoApproved: true, actionType: 'mark_apple_reminder_read' } as never,
    }, 'blocked'),
    packetCase('negative_12_expired_approval', 'Expired approval blocks packet.', {
      approval: createValidApproval({ expiresAt: '2026-07-07T11:59:00.000Z' }),
    }, 'blocked'),
    packetCase('negative_13_approval_text_mismatch', 'Approval text mismatch blocks packet.', {
      exactApprovedText: 'wrong text',
    }, 'blocked'),
    packetCase('negative_14_approval_target_mismatch', 'Approval target mismatch blocks packet.', {
      approval: createValidApproval({ reminderId: 'other_reminder' }),
    }, 'blocked'),
    packetCase('negative_15_missing_reminder_id', 'Missing reminderId blocks packet.', {
      reminderId: null,
    }, 'blocked'),
    packetCase('negative_16_multiple_reminder_ids', 'Multiple reminder IDs block packet.', {
      reminderId: 'one,two',
    }, 'blocked'),
    receiptCase('negative_17_wrong_shortcut_name', 'Wrong Shortcut receipt name rejected.', receipt => ({
      ...receipt,
      shortcut: { ...receipt.shortcut, shortcutName: 'Other Shortcut' as never },
    }), 'rejected'),
    receiptCase('negative_18_not_manual', 'executedManually false rejected.', receipt => ({
      ...receipt,
      shortcut: { ...receipt.shortcut, executedManually: false as true },
    }), 'rejected'),
    receiptCase('negative_19_background_automation', 'backgroundAutomationUsed true rejected.', receipt => ({
      ...receipt,
      shortcut: { ...receipt.shortcut, backgroundAutomationUsed: true as false },
    }), 'rejected'),
    receiptCase('negative_20_packet_mismatch', 'Receipt packetId mismatch rejected.', receipt => ({
      ...receipt,
      packetId: 'wrong_packet',
    }), 'rejected'),
    receiptCase('negative_21_nonce_mismatch', 'Receipt nonce mismatch rejected.', receipt => ({
      ...receipt,
      nonce: 'wrong_nonce',
    }), 'rejected'),
    receiptCase('negative_22_completed_claim_after_false', 'Completed claim with after false is mismatch.', receipt => ({
      ...receipt,
      observedAfter: { ...receipt.observedAfter, completed: false, status: 'incomplete', completionDate: null },
    }), 'claim_reality_mismatch'),
    receiptCase('negative_23_before_read_failed', 'Mutation succeeded but before read failed is rejected.', receipt => ({
      ...receipt,
      observedBefore: { ...receipt.observedBefore, readSucceeded: false },
    }), 'rejected'),
    receiptCase('negative_24_after_read_failed', 'Mutation succeeded but after read failed is rejected.', receipt => ({
      ...receipt,
      observedAfter: { ...receipt.observedAfter, readSucceeded: false },
    }), 'rejected'),
    receiptCase('negative_25_already_completed_before', 'Already completed before action is rejected.', receipt => ({
      ...receipt,
      observedBefore: { ...receipt.observedBefore, completed: true, status: 'completed' },
    }), 'rejected'),
    receiptCase('negative_26_unexpected_changed_path', 'Unexpected changed path is mismatch.', receipt => ({
      ...receipt,
      mutation: { ...receipt.mutation, changedPathsClaimed: ['appleReminders.reminder.completed', 'appleReminders.reminder.status', 'appleReminders.reminder.completionDate', 'appleReminders.reminder.unknown' as never] },
    }), 'claim_reality_mismatch'),
    rollbackCase('negative_27_rollback_self_report_false', 'Rollback success claim with completed true fails.', receipt => ({
      ...receipt,
      observedAfterRollback: { ...receipt.observedAfterRollback, completed: true, status: 'completed' },
    }), 'rollback_failed'),
    rollbackCase('negative_28_rollback_missing_read', 'Rollback missing read-after-rollback is unverified.', receipt => ({
      ...receipt,
      observedAfterRollback: { ...receipt.observedAfterRollback, readSucceeded: false },
    }), 'rollback_unverified'),
    callbackInjectionCase(),
    packetCase('negative_30_google_tasks_calendar', 'Google Tasks/Calendar target blocked.', {
      actionType: 'google_tasks_action',
      blockedSignals: ['google_tasks_action'],
    }, 'blocked'),
    replayAfterStatelessVerifierResetCase(),
  ]
}

function packetCase(
  caseId: string,
  description: string,
  overrides: Parameters<typeof createValidPacketInput>[0],
  expected: string
): AppleReminderBridgeValidationResult {
  const result = new AppleReminderActionPacketFactory().create(createValidPacketInput(overrides))

  return validation(caseId, description, expected, result.status, [
    result.blockedReason ?? 'packet available',
  ])
}

function receiptCase(
  caseId: string,
  description: string,
  mutate: (receipt: ReturnType<typeof createValidReceipt>) => ReturnType<typeof createValidReceipt>,
  expected: string
): AppleReminderBridgeValidationResult {
  const packet = new AppleReminderActionPacketFactory().create(createValidPacketInput()).packet
  if (!packet) return validation(caseId, description, expected, 'no_packet', ['fixture packet missing'])
  const receipt = mutate(createValidReceipt(packet))
  const verifier = new AppleReminderReceiptVerifier()
  const observed = verifier.verify(packet, receipt).status

  return validation(caseId, description, expected, observed, verifier.verify(packet, receipt).issues)
}

function rollbackCase(
  caseId: string,
  description: string,
  mutate: (receipt: ReturnType<typeof createValidRollbackReceipt>) => ReturnType<typeof createValidRollbackReceipt>,
  expected: string
): AppleReminderBridgeValidationResult {
  const packet = new AppleReminderActionPacketFactory().create(createValidPacketInput()).packet
  if (!packet) return validation(caseId, description, expected, 'no_packet', ['fixture packet missing'])
  const receipt = createValidReceipt(packet)
  const rollbackPacket = new AppleReminderRollbackPlanner().createRollbackPacket({
    originalReceipt: receipt,
    exactApprovedText: packet.exactApprovedText,
    nonce: 'rollback_nonce',
  })
  const observed = new AppleReminderRollbackVerifier().verify(
    rollbackPacket,
    mutate(createValidRollbackReceipt(rollbackPacket))
  ).status

  return validation(caseId, description, expected, observed, [])
}

function callbackInjectionCase(): AppleReminderBridgeValidationResult {
  const packet = new AppleReminderActionPacketFactory().create(createValidPacketInput()).packet
  if (!packet) return validation('negative_29_callback_injection', 'Callback injection fixture failed.', 'safe', 'no_packet', [])
  const url = new AppleShortcutBridgeUrlBuilder().buildManualUrl({
    ...packet,
    commanderInput: 'Mark this reminder read &x-success=https://evil.example',
  })
  const parsed = new AppleShortcutBridgeUrlBuilder().decodePacketText(url.encodedPacketText)
  const observed = parsed.packet.commanderInput.includes('&x-success=') && !url.url.includes('evil.example')
    ? 'safe'
    : 'unsafe'

  return validation('negative_29_callback_injection', 'Callback injection remains packet text only.', 'safe', observed, [
    url.url,
  ])
}

function replayAfterStatelessVerifierResetCase(): AppleReminderBridgeValidationResult {
  const packet = new AppleReminderActionPacketFactory().create(createValidPacketInput()).packet
  if (!packet) {
    return validation(
      'negative_replay_after_stateless_verifier_reset',
      'A fresh stateless verifier accepts the same otherwise valid receipt again.',
      'accepted_limitation',
      'no_packet',
      ['Fixture packet missing.']
    )
  }
  const receipt = createValidReceipt(packet)
  const firstVerifier = new AppleReminderReceiptVerifier()
  const freshVerifierAfterReset = new AppleReminderReceiptVerifier()
  const firstResult = firstVerifier.verify(packet, receipt)
  const replayResult = freshVerifierAfterReset.verify(packet, receipt)
  const observed = firstResult.status === 'verified_clean' && replayResult.status === 'verified_clean'
    ? 'accepted_limitation'
    : replayResult.status

  return {
    caseId: 'negative_replay_after_stateless_verifier_reset',
    description: 'Same valid receipt verifies clean when verifier state is fresh; this demonstrates the documented process-local replay limitation in 46K.',
    expected: 'accepted_limitation',
    observed,
    result: observed === 'accepted_limitation' ? 'LIMITATION_ACCEPTED' : 'FAIL',
    notes: [
      `firstVerification=${firstResult.status}`,
      `freshVerifierReplay=${replayResult.status}`,
      'This is the expected 46K limitation, not replay protection.',
      'Durable replay protection requires a future persistence-backed single-use ledger.',
    ],
  }
}

function validation(
  caseId: string,
  description: string,
  expected: string,
  observed: string,
  notes: string[]
): AppleReminderBridgeValidationResult {
  return {
    caseId,
    description,
    expected,
    observed,
    result: expected === observed ? 'PASS' : 'FAIL',
    notes,
  }
}
