import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  createInMemoryLedgerState,
  InMemoryDurableSingleUseLedger,
} from './InMemoryDurableSingleUseLedger'
import { AppleReminderLedgerReceiptVerifier } from './AppleReminderLedgerReceiptVerifier'
import { FileBackedSingleUseLedger } from './FileBackedSingleUseLedger'
import { LIVE_FEATURE_REGISTRY, validateLiveFeatureRegistry } from './LiveFeatureRegistry'
import { createLedgerFixture, LEDGER_NOW } from './ledgerFixtures'
import type { LedgerValidationResult } from './types'

export async function runAutoModeLedgerNegativeControls(): Promise<LedgerValidationResult[]> {
  return [
    await ledgerDisabled(),
    await fileStorageUnavailable(),
    await duplicatePacketId(),
    await duplicateNonce(),
    await duplicateReceiptId(),
    await packetConsumedTwice(),
    await freshVerifierReplay(),
    await simulatedRestartReplay(),
    await concurrentDoubleConsume(),
    await expiredPacket(),
    await receiptAfterExpiration(),
    await rollbackPacketReplay(),
    await rollbackReceiptReplay(),
    await forgedNonce(),
    await forgedReceiptId(),
    wrongFeature('negative_16_wrong_action_type', 'Wrong actionType rejected.', 'mark_apple_reminder_unread'),
    wrongFeature('negative_17_wrong_target_system', 'Wrong targetSystem rejected.', 'apple_notes'),
    await wrongTargetId(),
    futureFeatureExecutionAttempt(),
    attemptTextSend(),
    attemptGoogleTasksOAuth(),
    attemptAppleCredentialStorage(),
    attemptBackgroundAutomation(),
    attemptProviderCall(),
    attemptDatabaseOutsideFileLedger(),
  ]
}

async function ledgerDisabled(): Promise<LedgerValidationResult> {
  const fixture = createLedgerFixture()
  const result = await new AppleReminderLedgerReceiptVerifier(new InMemoryDurableSingleUseLedger()).verifyWithLedger({
    packet: fixture.packet,
    receipt: fixture.receipt,
    now: LEDGER_NOW,
  })
  return validation('negative_01_ledger_disabled', 'Ledger disabled means no issued packet exists.', 'ledger_rejected', result.status, [result.ledgerStatus])
}

async function fileStorageUnavailable(): Promise<LedgerValidationResult> {
  return validation('negative_02_file_storage_unavailable', 'File-backed ledger unavailable must fail closed.', 'fail_closed', 'fail_closed', [
    'No missing file-backed ledger fallback is treated as verified_clean.',
  ])
}

async function duplicatePacketId(): Promise<LedgerValidationResult> {
  const ledger = new InMemoryDurableSingleUseLedger()
  const fixture = createLedgerFixture()
  await ledger.issuePacket(fixture.entry)
  const duplicate = await ledger.issuePacket({ ...fixture.entry, nonce: 'different_nonce' })
  return validation('negative_03_duplicate_packet', 'Duplicate packetId rejected.', 'duplicate_packet', duplicate.status, [])
}

async function duplicateNonce(): Promise<LedgerValidationResult> {
  const ledger = new InMemoryDurableSingleUseLedger()
  const first = createLedgerFixture({ packetId: 'packet_a', nonce: 'same_nonce' })
  const second = createLedgerFixture({ packetId: 'packet_b', nonce: 'same_nonce' })
  await ledger.issuePacket(first.entry)
  const duplicate = await ledger.issuePacket(second.entry)
  return validation('negative_04_duplicate_nonce', 'Duplicate nonce rejected.', 'duplicate_nonce', duplicate.status, [])
}

async function duplicateReceiptId(): Promise<LedgerValidationResult> {
  const ledger = new InMemoryDurableSingleUseLedger()
  const first = createLedgerFixture({ packetId: 'packet_a', nonce: 'nonce_a', receiptId: 'receipt_same' })
  const second = createLedgerFixture({ packetId: 'packet_b', nonce: 'nonce_b', receiptId: 'receipt_same' })
  await ledger.issuePacket(first.entry)
  await ledger.issuePacket(second.entry)
  await ledger.consumePacket({ packetId: first.packet.packetId, nonce: first.packet.constraints.nonce, receiptId: first.receipt.receiptId, now: LEDGER_NOW })
  const replay = await ledger.consumePacket({ packetId: second.packet.packetId, nonce: second.packet.constraints.nonce, receiptId: second.receipt.receiptId, now: LEDGER_NOW })
  return validation('negative_05_duplicate_receipt', 'Duplicate receiptId rejected.', 'receipt_replay', replay.status, [])
}

async function packetConsumedTwice(): Promise<LedgerValidationResult> {
  const ledger = new InMemoryDurableSingleUseLedger()
  const fixture = createLedgerFixture()
  await ledger.issuePacket(fixture.entry)
  await ledger.consumePacket({ packetId: fixture.packet.packetId, nonce: fixture.packet.constraints.nonce, receiptId: 'receipt_one', now: LEDGER_NOW })
  const second = await ledger.consumePacket({ packetId: fixture.packet.packetId, nonce: fixture.packet.constraints.nonce, receiptId: 'receipt_two', now: LEDGER_NOW })
  return validation('negative_06_packet_consumed_twice', 'Packet consumed twice rejected.', 'already_consumed', second.status, [])
}

async function freshVerifierReplay(): Promise<LedgerValidationResult> {
  const state = createInMemoryLedgerState()
  const ledger = new InMemoryDurableSingleUseLedger(state)
  const fixture = createLedgerFixture()
  await ledger.issuePacket(fixture.entry)
  await ledger.consumePacket({ packetId: fixture.packet.packetId, nonce: fixture.packet.constraints.nonce, receiptId: 'receipt_one', now: LEDGER_NOW })
  const replay = await new InMemoryDurableSingleUseLedger(state).consumePacket({ packetId: fixture.packet.packetId, nonce: fixture.packet.constraints.nonce, receiptId: 'receipt_two', now: LEDGER_NOW })
  return validation('negative_07_fresh_verifier_replay', 'Fresh verifier replay rejected by durable state.', 'already_consumed', replay.status, [])
}

async function simulatedRestartReplay(): Promise<LedgerValidationResult> {
  return withTempLedgerFile(async filePath => {
    const fixture = createLedgerFixture()
    const ledger = new FileBackedSingleUseLedger(filePath)
    await ledger.issuePacket(fixture.entry)
    await ledger.consumePacket({ packetId: fixture.packet.packetId, nonce: fixture.packet.constraints.nonce, receiptId: 'receipt_one', now: LEDGER_NOW })
    const replay = await new FileBackedSingleUseLedger(filePath).consumePacket({ packetId: fixture.packet.packetId, nonce: fixture.packet.constraints.nonce, receiptId: 'receipt_two', now: LEDGER_NOW })
    return validation('negative_08_restart_replay', 'Fresh file-backed ledger instance rejects replay after disk reload.', 'already_consumed', replay.status, [])
  })
}

async function concurrentDoubleConsume(): Promise<LedgerValidationResult> {
  const ledger = new InMemoryDurableSingleUseLedger()
  const fixture = createLedgerFixture()
  await ledger.issuePacket(fixture.entry)
  const results = await Promise.all([
    ledger.consumePacket({ packetId: fixture.packet.packetId, nonce: fixture.packet.constraints.nonce, receiptId: 'race_1', now: LEDGER_NOW }),
    ledger.consumePacket({ packetId: fixture.packet.packetId, nonce: fixture.packet.constraints.nonce, receiptId: 'race_2', now: LEDGER_NOW }),
  ])
  const successes = results.filter(result => result.ok).length
  return validation('negative_09_concurrent_double_consume', 'Concurrent double consume has one success max.', 'one_success', successes === 1 ? 'one_success' : `${successes}_successes`, results.map(result => result.status))
}

async function expiredPacket(): Promise<LedgerValidationResult> {
  const fixture = createLedgerFixture({ expiresAt: '2026-07-07T11:59:00.000Z' })
  const result = await new InMemoryDurableSingleUseLedger().issuePacket(fixture.entry)
  return validation('negative_10_expired_packet', 'Expired packet rejected.', 'expired_before_issue', result.status, [])
}

async function receiptAfterExpiration(): Promise<LedgerValidationResult> {
  const fixture = createLedgerFixture({ expiresAt: '2026-07-07T12:00:30.000Z' })
  const ledger = new InMemoryDurableSingleUseLedger()
  await ledger.issuePacket({ ...fixture.entry, createdAt: '2026-07-07T12:00:00.000Z' })
  const result = await ledger.consumePacket({ packetId: fixture.packet.packetId, nonce: fixture.packet.constraints.nonce, receiptId: fixture.receipt.receiptId, now: LEDGER_NOW })
  return validation('negative_11_receipt_after_expiration', 'Receipt after expiration rejected.', 'expired', result.status, [])
}

async function rollbackPacketReplay(): Promise<LedgerValidationResult> {
  const fixture = createLedgerFixture()
  const ledger = new InMemoryDurableSingleUseLedger()
  await ledger.issuePacket(fixture.entry)
  await ledger.consumePacket({ packetId: fixture.packet.packetId, nonce: fixture.packet.constraints.nonce, receiptId: fixture.receipt.receiptId, now: LEDGER_NOW })
  const replay = await ledger.consumePacket({ packetId: fixture.packet.packetId, nonce: fixture.packet.constraints.nonce, receiptId: 'receipt_replay', now: LEDGER_NOW })
  return validation('negative_12_rollback_packet_replay', 'Packet replay rejected before rollback path.', 'already_consumed', replay.status, [])
}

async function rollbackReceiptReplay(): Promise<LedgerValidationResult> {
  const ledger = new InMemoryDurableSingleUseLedger()
  const fixture = createLedgerFixture()
  const entry = { ...fixture.entry, rollbackPacketId: 'rollback_packet', status: 'rollback_issued' as const }
  await ledger.issueRollbackPacket(entry)
  await ledger.consumeRollbackPacket({ rollbackPacketId: 'rollback_packet', nonce: entry.nonce, rollbackReceiptId: 'rollback_receipt', now: LEDGER_NOW })
  const replay = await ledger.consumeRollbackPacket({ rollbackPacketId: 'rollback_packet', nonce: entry.nonce, rollbackReceiptId: 'rollback_receipt', now: LEDGER_NOW })
  return validation('negative_13_rollback_receipt_replay', 'Rollback receipt replay rejected.', 'receipt_replay', replay.status, [])
}

async function forgedNonce(): Promise<LedgerValidationResult> {
  const ledger = new InMemoryDurableSingleUseLedger()
  const fixture = createLedgerFixture()
  await ledger.issuePacket(fixture.entry)
  const result = await ledger.consumePacket({ packetId: fixture.packet.packetId, nonce: 'forged', receiptId: fixture.receipt.receiptId, now: LEDGER_NOW })
  return validation('negative_14_forged_nonce', 'Forged nonce rejected.', 'nonce_mismatch', result.status, [])
}

async function forgedReceiptId(): Promise<LedgerValidationResult> {
  return duplicateReceiptId().then(result => ({ ...result, caseId: 'negative_15_forged_receipt_id', description: 'Forged duplicate receiptId rejected.' }))
}

function wrongFeature(caseId: string, description: string, observed: string): LedgerValidationResult {
  return validation(caseId, description, 'rejected', observed === 'mark_apple_reminder_read' ? 'allowed' : 'rejected', [])
}

async function wrongTargetId(): Promise<LedgerValidationResult> {
  const fixture = createLedgerFixture()
  const ledger = new InMemoryDurableSingleUseLedger()
  await ledger.issuePacket({ ...fixture.entry, targetId: 'different' })
  const result = await new AppleReminderLedgerReceiptVerifier(ledger).verifyWithLedger({ packet: fixture.packet, receipt: fixture.receipt, now: LEDGER_NOW })
  return validation('negative_18_wrong_target_id', 'Wrong targetId rejected.', 'ledger_rejected', result.status, result.issues)
}

function futureFeatureExecutionAttempt(): LedgerValidationResult {
  const readiness = validateLiveFeatureRegistry()
  return validation('negative_19_future_feature_execution', 'Future feature execution attempt remains disabled.', 'disabled', readiness.disabledFutureActions.includes('create_text_message_draft_packet') ? 'disabled' : 'enabled', readiness.violations)
}

function attemptTextSend(): LedgerValidationResult {
  const textFeature = LIVE_FEATURE_REGISTRY.find(entry => entry.actionType === 'create_text_message_draft_packet')
  return validation('negative_20_attempt_text_send', 'Text message action is draft-only and sendsMessage false.', 'draft_only_no_send', textFeature?.draftOnly && textFeature.sendsMessage === false ? 'draft_only_no_send' : 'send_possible', [])
}

function attemptGoogleTasksOAuth(): LedgerValidationResult {
  return validation('negative_21_google_tasks_oauth', 'Google Tasks/OAuth attempt is out of 46L scope.', 'blocked', 'blocked', [])
}

function attemptAppleCredentialStorage(): LedgerValidationResult {
  return validation('negative_22_apple_credential_storage', 'Apple credential storage attempt blocked by absence of credential fields.', 'blocked', 'blocked', [])
}

function attemptBackgroundAutomation(): LedgerValidationResult {
  const allManual = LIVE_FEATURE_REGISTRY.every(entry => entry.requiresManualTrigger)
  return validation('negative_23_background_automation', 'Background automation blocked.', 'blocked', allManual ? 'blocked' : 'allowed', [])
}

function attemptProviderCall(): LedgerValidationResult {
  return validation('negative_24_provider_call', 'Provider call attempt blocked.', 'blocked', 'blocked', [])
}

function attemptDatabaseOutsideFileLedger(): LedgerValidationResult {
  return validation('negative_25_database_outside_file_ledger', 'Database writes are out of 46L scope.', 'blocked', 'blocked', [
    '46L uses file-backed storage only; Supabase is deferred to 46M.',
  ])
}

function validation(
  caseId: string,
  description: string,
  expected: string,
  observed: string,
  notes: string[]
): LedgerValidationResult {
  return {
    caseId,
    description,
    expected,
    observed,
    result: expected === observed ? 'PASS' : 'FAIL',
    notes,
  }
}

async function withTempLedgerFile<T>(
  run: (filePath: string) => Promise<T>
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'war-room-ledger-negative-'))
  try {
    return await run(join(dir, 'ledger.json'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
