import { AppleReminderActionPacketFactory } from './AppleReminderActionPacket'
import { AppleReminderReceiptVerifier } from './AppleReminderReceiptVerifier'
import {
  createValidPacketInput,
  createValidReceipt,
} from './appleReminderFixtures'
import type { AppleReminderBridgeValidationResult } from './types'

export function runAppleReminderGate9Validation(): AppleReminderBridgeValidationResult[] {
  return [
    validateBlockedPacketForBundledUnsafeRequest(),
    validateClaimRealityMismatch(),
    validateRollbackRequiredOnIntegrityMismatchAfterMutation(),
  ]
}

function validateBlockedPacketForBundledUnsafeRequest(): AppleReminderBridgeValidationResult {
  const result = new AppleReminderActionPacketFactory().create(createValidPacketInput({
    blockedSignals: ['message_send'],
  }))

  return validation(
    'gate9_01_blocked_bundle_no_packet',
    'Bundled unsafe signal creates no packet.',
    'blocked_without_packet',
    result.status === 'blocked' && !result.packetCreated ? 'blocked_without_packet' : 'unexpected',
    [result.blockedReason ?? 'no blocked reason']
  )
}

function validateClaimRealityMismatch(): AppleReminderBridgeValidationResult {
  const packet = new AppleReminderActionPacketFactory().create(createValidPacketInput()).packet
  if (!packet) return validation('gate9_02_claim_reality_mismatch', 'Fixture packet exists.', 'claim_reality_mismatch', 'no_packet', [])
  const receipt = createValidReceipt(packet, {
    observedAfter: {
      readSucceeded: true,
      exists: true,
      status: 'incomplete',
      completed: false,
      completionDate: null,
      observedAt: '2026-07-07T12:00:25.000Z',
    },
  })
  const result = new AppleReminderReceiptVerifier().verify(packet, receipt)

  return validation('gate9_02_claim_reality_mismatch', 'Receipt self-report cannot override observed after state.', 'claim_reality_mismatch', result.status, result.issues)
}

function validateRollbackRequiredOnIntegrityMismatchAfterMutation(): AppleReminderBridgeValidationResult {
  const packet = new AppleReminderActionPacketFactory().create(createValidPacketInput()).packet
  if (!packet) return validation('gate9_03_rollback_required', 'Fixture packet exists.', 'rollback_required', 'no_packet', [])
  const receipt = createValidReceipt(packet, {
    nonce: 'wrong_nonce',
  })
  const result = new AppleReminderReceiptVerifier().verify(packet, receipt)
  const observed = result.status === 'rejected' && result.rollbackRequired
    ? 'rejected_with_rollback_required'
    : result.status

  return validation('gate9_03_rollback_required', 'If mutation appears real but integrity mismatches, rollback is required.', 'rejected_with_rollback_required', observed, result.issues)
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
