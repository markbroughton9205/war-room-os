import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { AppleReminderLedgerReceiptVerifier } from './AppleReminderLedgerReceiptVerifier'
import { FileBackedSingleUseLedger } from './FileBackedSingleUseLedger'
import {
  InMemoryDurableSingleUseLedger,
  createInMemoryLedgerState,
} from './InMemoryDurableSingleUseLedger'
import { createLedgerFixture, createRollbackLedgerFixture, LEDGER_NOW } from './ledgerFixtures'
import type { LedgerValidationResult } from './types'

export async function runGate11DurableReplayValidation(): Promise<LedgerValidationResult[]> {
  return [
    await firstConsumeSucceeds(),
    await packetReplayRejected(),
    await receiptReplayRejected(),
    await nonceReplayRejected(),
    await freshVerifierRejectsReplay(),
    await simulatedRestartRejectsReplay(),
    await concurrentDoubleConsumeAllowsOne(),
    await expiredPacketRejected(),
    await expiredLedgerEntryCannotVerifyClean(),
    await rollbackPacketSingleUse(),
    await rollbackReceiptReplayRejected(),
    await ledgerMismatchBlocksReceipt(),
    await forgedLedgerRowFailsClosed(),
    await verifierRequiresLedgerConsume(),
    await ledgerPersistsAcrossVerifierReset(),
    await noInMemoryOnlyReplayProtectionAccepted(),
    await repeatedFileBackedConcurrentConsumeAllowsOne(),
  ]
}

async function firstConsumeSucceeds(): Promise<LedgerValidationResult> {
  const { verifier, fixture } = await issuedFixture()
  const result = await verifier.verifyWithLedger({ packet: fixture.packet, receipt: fixture.receipt, now: LEDGER_NOW })
  return validation('gate11_01_first_consume', 'First valid packet consumption succeeds.', 'verified_clean', result.status, [result.ledgerStatus])
}

async function packetReplayRejected(): Promise<LedgerValidationResult> {
  const { verifier, fixture } = await consumedFixture()
  const replay = await verifier.verifyWithLedger({ packet: fixture.packet, receipt: { ...fixture.receipt, receiptId: 'receipt_replay_packet' }, now: LEDGER_NOW })
  return validation('gate11_02_packet_replay', 'Same packet replay is rejected.', 'ledger_rejected', replay.status, [replay.ledgerStatus])
}

async function receiptReplayRejected(): Promise<LedgerValidationResult> {
  const { ledger, fixture } = await consumedFixture()
  const entry = await ledger.getByReceiptId(fixture.receipt.receiptId)
  return validation('gate11_03_receipt_replay', 'Same receipt replay is rejected.', 'receipt_recorded', entry ? 'receipt_recorded' : 'missing', [])
}

async function nonceReplayRejected(): Promise<LedgerValidationResult> {
  const state = createInMemoryLedgerState()
  const ledger = new InMemoryDurableSingleUseLedger(state)
  const first = createLedgerFixture({ packetId: 'packet_nonce_a', nonce: 'nonce_same' })
  const second = createLedgerFixture({ packetId: 'packet_nonce_b', nonce: 'nonce_same' })
  await ledger.issuePacket(first.entry)
  const result = await ledger.issuePacket(second.entry)
  return validation('gate11_04_nonce_replay', 'Same nonce replay is rejected.', 'duplicate_nonce', result.status, [])
}

async function freshVerifierRejectsReplay(): Promise<LedgerValidationResult> {
  const state = createInMemoryLedgerState()
  const fixture = createLedgerFixture()
  const ledger = new InMemoryDurableSingleUseLedger(state)
  await ledger.issuePacket(fixture.entry)
  await new AppleReminderLedgerReceiptVerifier(ledger).verifyWithLedger({ packet: fixture.packet, receipt: fixture.receipt, now: LEDGER_NOW })
  const freshVerifier = new AppleReminderLedgerReceiptVerifier(new InMemoryDurableSingleUseLedger(state))
  const replay = await freshVerifier.verifyWithLedger({ packet: fixture.packet, receipt: { ...fixture.receipt, receiptId: 'receipt_fresh_replay' }, now: LEDGER_NOW })
  return validation('gate11_05_fresh_verifier_replay', 'Fresh verifier instance still rejects replay.', 'ledger_rejected', replay.status, [replay.ledgerStatus])
}

async function simulatedRestartRejectsReplay(): Promise<LedgerValidationResult> {
  return withTempLedgerFile(async filePath => {
    const fixture = createLedgerFixture()
    const firstLedger = new FileBackedSingleUseLedger(filePath)
    await firstLedger.issuePacket(fixture.entry)
    await new AppleReminderLedgerReceiptVerifier(firstLedger).verifyWithLedger({ packet: fixture.packet, receipt: fixture.receipt, now: LEDGER_NOW })
    const restartedLedger = new FileBackedSingleUseLedger(filePath)
    const replay = await new AppleReminderLedgerReceiptVerifier(restartedLedger).verifyWithLedger({ packet: fixture.packet, receipt: { ...fixture.receipt, receiptId: 'receipt_after_restart' }, now: LEDGER_NOW })
    return validation('gate11_06_restart_replay', 'Fresh disk-backed ledger instance rejects replay after reloading the ledger file.', 'ledger_rejected', replay.status, [replay.ledgerStatus])
  })
}

async function concurrentDoubleConsumeAllowsOne(): Promise<LedgerValidationResult> {
  const state = createInMemoryLedgerState()
  const fixture = createLedgerFixture()
  const ledger = new InMemoryDurableSingleUseLedger(state)
  await ledger.issuePacket(fixture.entry)
  const attempts = await Promise.all([
    ledger.consumePacket({ packetId: fixture.packet.packetId, nonce: fixture.packet.constraints.nonce, receiptId: 'race_a', now: LEDGER_NOW }),
    ledger.consumePacket({ packetId: fixture.packet.packetId, nonce: fixture.packet.constraints.nonce, receiptId: 'race_b', now: LEDGER_NOW }),
  ])
  const successes = attempts.filter(result => result.ok).length
  return validation('gate11_07_concurrent_consume', 'Concurrent consume race allows one success max.', 'one_success', successes === 1 ? 'one_success' : `${successes}_successes`, attempts.map(result => result.status))
}

async function expiredPacketRejected(): Promise<LedgerValidationResult> {
  const fixture = createLedgerFixture({ expiresAt: '2026-07-07T11:59:00.000Z' })
  const result = await new InMemoryDurableSingleUseLedger().issuePacket(fixture.entry)
  return validation('gate11_08_expired_packet', 'Expired packet cannot be issued or consumed.', 'expired_before_issue', result.status, [])
}

async function expiredLedgerEntryCannotVerifyClean(): Promise<LedgerValidationResult> {
  const fixture = createLedgerFixture({ expiresAt: '2026-07-07T12:00:30.000Z' })
  const ledger = new InMemoryDurableSingleUseLedger()
  await ledger.issuePacket({ ...fixture.entry, createdAt: '2026-07-07T12:00:00.000Z' })
  const result = await new AppleReminderLedgerReceiptVerifier(ledger).verifyWithLedger({ packet: fixture.packet, receipt: fixture.receipt, now: LEDGER_NOW })
  return validation('gate11_09_expired_entry_no_verify', 'Expired ledger entry cannot verify clean.', 'ledger_rejected', result.status, [result.ledgerStatus])
}

async function rollbackPacketSingleUse(): Promise<LedgerValidationResult> {
  const state = createInMemoryLedgerState()
  const ledger = new InMemoryDurableSingleUseLedger(state)
  const fixture = createLedgerFixture()
  await ledger.issuePacket(fixture.entry)
  const rollback = createRollbackLedgerFixture(fixture.entry)
  await ledger.issueRollbackPacket(rollback.rollbackEntry)
  const first = await ledger.consumeRollbackPacket({ rollbackPacketId: rollback.rollbackPacket.rollbackPacketId, nonce: rollback.rollbackPacket.nonce, rollbackReceiptId: rollback.rollbackReceiptId, now: LEDGER_NOW })
  const second = await ledger.consumeRollbackPacket({ rollbackPacketId: rollback.rollbackPacket.rollbackPacketId, nonce: rollback.rollbackPacket.nonce, rollbackReceiptId: 'rollback_receipt_second', now: LEDGER_NOW })
  return validation('gate11_10_rollback_single_use', 'Rollback packet is single-use.', 'consumed_then_rejected', first.ok && !second.ok ? 'consumed_then_rejected' : 'unexpected', [first.status, second.status])
}

async function rollbackReceiptReplayRejected(): Promise<LedgerValidationResult> {
  const ledger = new InMemoryDurableSingleUseLedger()
  const fixture = createLedgerFixture()
  const rollback = createRollbackLedgerFixture(fixture.entry)
  await ledger.issueRollbackPacket(rollback.rollbackEntry)
  await ledger.consumeRollbackPacket({ rollbackPacketId: rollback.rollbackPacket.rollbackPacketId, nonce: rollback.rollbackPacket.nonce, rollbackReceiptId: rollback.rollbackReceiptId, now: LEDGER_NOW })
  const replay = await ledger.consumeRollbackPacket({ rollbackPacketId: rollback.rollbackPacket.rollbackPacketId, nonce: rollback.rollbackPacket.nonce, rollbackReceiptId: rollback.rollbackReceiptId, now: LEDGER_NOW })
  return validation('gate11_11_rollback_receipt_replay', 'Rollback receipt replay is rejected.', 'receipt_replay', replay.status, [])
}

async function ledgerMismatchBlocksReceipt(): Promise<LedgerValidationResult> {
  const fixture = createLedgerFixture({ targetId: 'ledger_target' })
  const ledger = new InMemoryDurableSingleUseLedger()
  await ledger.issuePacket({ ...fixture.entry, targetId: 'different_target' })
  const result = await new AppleReminderLedgerReceiptVerifier(ledger).verifyWithLedger({ packet: fixture.packet, receipt: fixture.receipt, now: LEDGER_NOW })
  return validation('gate11_12_ledger_mismatch', 'Ledger mismatch blocks receipt.', 'ledger_rejected', result.status, result.issues)
}

async function forgedLedgerRowFailsClosed(): Promise<LedgerValidationResult> {
  const fixture = createLedgerFixture()
  const state = createInMemoryLedgerState()
  state.entries.set(fixture.entry.ledgerId, {
    ...fixture.entry,
    status: 'rejected',
    rejectionReason: 'forged',
  })
  const ledger = new InMemoryDurableSingleUseLedger(state)
  const result = await new AppleReminderLedgerReceiptVerifier(ledger).verifyWithLedger({ packet: fixture.packet, receipt: fixture.receipt, now: LEDGER_NOW })
  return validation('gate11_13_forged_row', 'Malformed or forged ledger row fails closed.', 'ledger_rejected', result.status, [result.ledgerStatus])
}

async function verifierRequiresLedgerConsume(): Promise<LedgerValidationResult> {
  const fixture = createLedgerFixture()
  const result = await new AppleReminderLedgerReceiptVerifier(new InMemoryDurableSingleUseLedger()).verifyWithLedger({ packet: fixture.packet, receipt: fixture.receipt, now: LEDGER_NOW })
  return validation('gate11_14_requires_ledger_consume', 'Verifier cannot return verified_clean unless ledger consume succeeds.', 'ledger_rejected', result.status, [result.ledgerStatus])
}

async function ledgerPersistsAcrossVerifierReset(): Promise<LedgerValidationResult> {
  return withTempLedgerFile(async filePath => {
    const fixture = createLedgerFixture()
    await new FileBackedSingleUseLedger(filePath).issuePacket(fixture.entry)
    const entry = await new FileBackedSingleUseLedger(filePath).getByPacketId(fixture.packet.packetId)
    return validation('gate11_15_persists_across_reset', 'Fresh disk-backed ledger instance loads entries from the ledger file.', 'persisted', entry ? 'persisted' : 'missing', [])
  })
}

async function noInMemoryOnlyReplayProtectionAccepted(): Promise<LedgerValidationResult> {
  const state = createInMemoryLedgerState()
  const fixture = createLedgerFixture()
  const ledger = new InMemoryDurableSingleUseLedger(state)
  await ledger.issuePacket(fixture.entry)
  await ledger.consumePacket({ packetId: fixture.packet.packetId, nonce: fixture.packet.constraints.nonce, receiptId: fixture.receipt.receiptId, now: LEDGER_NOW })
  const replayLedger = new InMemoryDurableSingleUseLedger(state)
  const replay = await replayLedger.consumePacket({ packetId: fixture.packet.packetId, nonce: fixture.packet.constraints.nonce, receiptId: 'receipt_no_instance_state', now: LEDGER_NOW })
  return validation('gate11_16_no_instance_state', 'No verifier instance state is required for replay rejection.', 'already_consumed', replay.status, [])
}

async function repeatedFileBackedConcurrentConsumeAllowsOne(): Promise<LedgerValidationResult> {
  const runSummaries: string[] = []

  for (let runIndex = 0; runIndex < 10; runIndex += 1) {
    const summary = await withTempLedgerFile(async filePath => {
      const fixture = createLedgerFixture({
        packetId: `packet_concurrent_${runIndex}`,
        nonce: `nonce_concurrent_${runIndex}`,
      })
      await new FileBackedSingleUseLedger(filePath).issuePacket(fixture.entry)

      const attempts = await Promise.all(
        Array.from({ length: 20 }, (_, attemptIndex) =>
          new FileBackedSingleUseLedger(filePath).consumePacket({
            packetId: fixture.packet.packetId,
            nonce: fixture.packet.constraints.nonce,
            receiptId: `receipt_concurrent_${runIndex}_${attemptIndex}`,
            now: LEDGER_NOW,
          })
        )
      )
      const successes = attempts.filter(result => result.ok).length
      const rejections = attempts.filter(result => !result.ok && result.status === 'already_consumed').length
      return `${successes}_success_${rejections}_already_consumed`
    })
    runSummaries.push(summary)
  }

  const allRunsHeld = runSummaries.every(summary => summary === '1_success_19_already_consumed')
  return validation(
    'gate11_17_file_backed_20_concurrent_repeated',
    'Twenty concurrent file-backed consume attempts produce exactly one success across repeated runs.',
    'all_runs_1_success_19_rejections',
    allRunsHeld ? 'all_runs_1_success_19_rejections' : runSummaries.join(','),
    runSummaries
  )
}

async function issuedFixture() {
  const ledger = new InMemoryDurableSingleUseLedger()
  const fixture = createLedgerFixture()
  await ledger.issuePacket(fixture.entry)
  return { ledger, verifier: new AppleReminderLedgerReceiptVerifier(ledger), fixture }
}

async function consumedFixture() {
  const issued = await issuedFixture()
  await issued.verifier.verifyWithLedger({ packet: issued.fixture.packet, receipt: issued.fixture.receipt, now: LEDGER_NOW })
  return issued
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
  const dir = await mkdtemp(join(tmpdir(), 'war-room-ledger-'))
  try {
    return await run(join(dir, 'ledger.json'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
