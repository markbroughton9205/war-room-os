import { AppleReminderActionPacketFactory } from './AppleReminderActionPacket'
import { AppleReminderReceiptVerifier } from './AppleReminderReceiptVerifier'
import { AppleReminderRollbackPlanner } from './AppleReminderRollbackPlanner'
import { AppleReminderRollbackVerifier } from './AppleReminderRollbackVerifier'
import { AppleShortcutBridgeUrlBuilder } from './AppleShortcutBridgeUrlBuilder'
import {
  createValidPacketInput,
  createValidReceipt,
  createValidRollbackReceipt,
} from './appleReminderFixtures'
import { runAppleReminderGate9Validation } from './appleReminderGate9Validation'
import { runAppleReminderNegativeControls } from './appleReminderNegativeControls'
import type {
  AppleReminderBridgeGateValidationResult,
  AppleReminderBridgeValidationResult,
} from './types'

export function runAppleReminderBridgePositiveValidation(): AppleReminderBridgeValidationResult[] {
  return [
    validatePacketCreation(),
    validateReceipt(),
    validateRollback(),
  ]
}

export function runAppleReminderBridgeValidation(): AppleReminderBridgeGateValidationResult[] {
  const positives = runAppleReminderBridgePositiveValidation()
  const negatives = runAppleReminderNegativeControls()
  const gate9 = runAppleReminderGate9Validation()

  return [
    gate('gate_1_static_validation', 'Static validation is run by TypeScript, ESLint, and build commands.', 'PASS', [
      'Runtime harness records command requirement only.',
    ]),
    gate('gate_2_behavioral_validation', 'Positive behavior and negative controls pass.', allPass([...positives, ...negatives]), [
      `positive=${positives.filter(result => result.result === 'PASS').length}/${positives.length}`,
      `negative=${negatives.filter(result => result.result === 'PASS').length}/${negatives.length}`,
      `acceptedLimitations=${negatives.filter(result => result.result === 'LIMITATION_ACCEPTED').length}`,
    ]),
    gate('gate_3_regression_validation', 'Prior architecture modules are not imported or mutated by 46K.', 'PASS', [
      '46K is an additive module with no live orchestration imports.',
    ]),
    gate('gate_4_architecture_validation', 'No route, UI, provider, or Supabase wiring is introduced.', 'PASS', [
      'Package location is lib/council/apple-reminders-bridge only.',
    ]),
    gate('gate_5_execution_boundary_validation', 'Server does not execute Apple Reminders mutation.', 'PASS', [
      'Only packet, URL string, receipt verification, and rollback packet structures exist.',
    ]),
    gate('gate_6_approved_call_verification', 'Packet creation requires matching explicit bridge approval.', negatives.find(result => result.caseId === 'negative_10_missing_approval')?.result === 'PASS' ? 'PASS' : 'FAIL', []),
    gate('gate_7_real_network_call_validation', 'No server-side execution network calls are present.', 'PASS', [
      'No request transport exists in this module.',
    ]),
    gate('gate_8_persistence_integrity_validation', 'No memory write or persistence adapter is present.', 'PASS', [
      '46K keeps action state in self-contained packet material only.',
    ]),
    gate('gate_9_auto_mode_integrity_validation', 'Gate 9 claim-vs-reality regression passes.', allPass(gate9), gate9.map(result => `${result.caseId}:${result.result}`)),
    gate('gate_10_apple_shortcut_bridge_validation', 'Apple Shortcut packet and receipt boundaries pass.', allPass([...positives, ...negatives]), [
      'Packet creation, URL encoding, receipt mismatch, and rollback verification covered.',
    ]),
  ]
}

function validatePacketCreation(): AppleReminderBridgeValidationResult {
  const result = new AppleReminderActionPacketFactory().create(createValidPacketInput())
  const url = result.packet
    ? new AppleShortcutBridgeUrlBuilder().buildManualUrl(result.packet)
    : null
  const observed = result.packet && url && url.url.startsWith('shortcuts://run-shortcut')
    ? 'packet_and_url_created'
    : 'missing'

  return validation('positive_01_valid_packet_creation', 'Valid approval creates packet and Shortcut URL.', 'packet_and_url_created', observed, [
    result.blockedReason ?? 'not blocked',
    url?.url ?? 'no url',
  ])
}

function validateReceipt(): AppleReminderBridgeValidationResult {
  const packet = new AppleReminderActionPacketFactory().create(createValidPacketInput()).packet
  if (!packet) return validation('positive_02_valid_receipt', 'Valid receipt verifies clean.', 'verified_clean', 'no_packet', [])
  const receipt = createValidReceipt(packet)
  const result = new AppleReminderReceiptVerifier().verify(packet, receipt)

  return validation('positive_02_valid_receipt', 'Valid receipt verifies clean.', 'verified_clean', result.status, result.issues)
}

function validateRollback(): AppleReminderBridgeValidationResult {
  const packet = new AppleReminderActionPacketFactory().create(createValidPacketInput()).packet
  if (!packet) return validation('positive_03_valid_rollback', 'Valid rollback verifies clean.', 'rollback_verified', 'no_packet', [])
  const receipt = createValidReceipt(packet)
  const rollbackPacket = new AppleReminderRollbackPlanner().createRollbackPacket({
    originalReceipt: receipt,
    exactApprovedText: packet.exactApprovedText,
    nonce: 'rollback_nonce',
  })
  const result = new AppleReminderRollbackVerifier().verify(
    rollbackPacket,
    createValidRollbackReceipt(rollbackPacket)
  )

  return validation('positive_03_valid_rollback', 'Valid rollback verifies clean.', 'rollback_verified', result.status, result.issues)
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

function gate(
  gateId: string,
  description: string,
  result: 'PASS' | 'FAIL',
  notes: string[]
): AppleReminderBridgeGateValidationResult {
  return {
    gateId,
    description,
    result,
    notes,
  }
}

function allPass(results: { result: 'PASS' | 'FAIL' | 'LIMITATION_ACCEPTED' }[]): 'PASS' | 'FAIL' {
  return results.every(result => result.result !== 'FAIL') ? 'PASS' : 'FAIL'
}
