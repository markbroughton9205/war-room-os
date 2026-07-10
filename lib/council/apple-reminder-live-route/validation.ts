import type {
  AppleReminderConsumedApprovalSnapshot,
  AppleReminderExplicitBridgeApproval,
} from '../apple-reminders-bridge'
import { createValidReceipt } from '../apple-reminders-bridge/appleReminderFixtures'
import { AppleReminderLedgerReceiptVerifier } from '../auto-mode-ledger/AppleReminderLedgerReceiptVerifier'
import { InMemoryDurableSingleUseLedger } from '../auto-mode-ledger/InMemoryDurableSingleUseLedger'
import { handleAppleReminderLiveCommand } from './handler'
import { APPLE_REMINDER_LIVE_EXACT_APPROVED_TEXT } from './types'
import type {
  AppleApprovalConsumeInput,
  AppleApprovalConsumeResult,
  AppleApprovalConsumeStatus,
  AppleApprovalConsumer,
  AppleReminderLiveRouteEnv,
  AppleReminderLiveRouteValidationResult,
} from './types'

const NOW = '2026-07-09T12:00:00.000Z'

const FLAGS_ON: AppleReminderLiveRouteEnv = {
  WAR_ROOM_ENABLE_46N_APPLE_REMINDER_LIVE_ROUTE: 'true',
  WAR_ROOM_ENABLE_LIVE_APPLE_REMINDER_EXECUTION: 'true',
}
const FLAGS_OFF: AppleReminderLiveRouteEnv = {}
const FLAG_ROUTE_ONLY: AppleReminderLiveRouteEnv = {
  WAR_ROOM_ENABLE_46N_APPLE_REMINDER_LIVE_ROUTE: 'true',
}
const FLAG_EXECUTION_ONLY: AppleReminderLiveRouteEnv = {
  WAR_ROOM_ENABLE_LIVE_APPLE_REMINDER_EXECUTION: 'true',
}

type FakeApprovalState = {
  approvals: Map<string, AppleReminderExplicitBridgeApproval>
  snapshotOverrides: Map<string, (snapshot: AppleReminderConsumedApprovalSnapshot) => AppleReminderConsumedApprovalSnapshot>
  forcedStatuses: Map<string, AppleApprovalConsumeStatus>
}

function freshDeps() {
  const ledger = new InMemoryDurableSingleUseLedger()
  const receiptVerifier = new AppleReminderLedgerReceiptVerifier(ledger)
  const approvalConsumer = new FakeAppleApprovalConsumer()
  return { ledger, receiptVerifier, approvalConsumer }
}

function validApproval(overrides: Partial<AppleReminderExplicitBridgeApproval> = {}): AppleReminderExplicitBridgeApproval {
  return {
    approvalPattern: 'ExplicitExecutionApproval',
    approvalId: 'approval_gate15_valid',
    exactApprovedText: APPLE_REMINDER_LIVE_EXACT_APPROVED_TEXT,
    commanderInput: 'Mark this Apple reminder read.',
    actionType: 'mark_apple_reminder_read',
    targetSystem: 'apple_reminders',
    reminderId: 'reminder_gate15',
    singleUse: true,
    nonce: 'nonce_gate15_valid',
    createdAt: NOW,
    expiresAt: '2026-07-09T12:30:00.000Z',
    consumedAt: null,
    status: 'active',
    ...overrides,
  }
}

export async function runAppleReminderLiveRouteValidation(): Promise<AppleReminderLiveRouteValidationResult[]> {
  return [
    await bothFlagsOffBlocked(),
    await routeFlagOnlyBlocked(),
    await executionFlagOnlyBlocked(),
    await notConfirmedBlocked(),
    await missingReminderIdBlocked(),
    await missingApprovalIdBlocked(),
    await missingExactApprovedTextBlocked(),
    await invalidRequestBlocked(),
    await validIssueSucceeds(),
    await approvalNotFoundBlocked(),
    await malformedApprovalIdBlocked(),
    await approvalReminderMismatchBlocked(),
    await approvalTextMismatchBlocked(),
    await approvalExpiredBlocked(),
    await approvalAlreadyConsumedBlocked(),
    await approvalRevokedBlocked(),
    await approvalWrongActionTypeBlocked(),
    await approvalWrongTargetSystemBlocked(),
    await approvalNotSingleUseBlocked(),
    await approvalNotActiveStatusBlocked(),
    await packetCreationFailureDoesNotRefundApproval(),
    await submitWithoutPacketBlocked(),
    await submitInvalidReceiptBlocked(),
    await validReceiptVerifiedClean(),
    await replayedReceiptRejected(),
  ]
}

async function bothFlagsOffBlocked(): Promise<AppleReminderLiveRouteValidationResult> {
  const { ledger, receiptVerifier, approvalConsumer } = freshDeps()
  const result = await handleAppleReminderLiveCommand(
    issueCommand('approval_x', 'r1'),
    { env: FLAGS_OFF, approvalConsumer, ledger, receiptVerifier, now: NOW }
  )
  return validation('gate15_01_both_flags_off', 'Both flags off blocks before any approval lookup or ledger write.', 'blocked', result.status, [result.auditRecord.blockedReason ?? 'none'])
}

async function routeFlagOnlyBlocked(): Promise<AppleReminderLiveRouteValidationResult> {
  const { ledger, receiptVerifier, approvalConsumer } = freshDeps()
  const result = await handleAppleReminderLiveCommand(
    issueCommand('approval_x', 'r1'),
    { env: FLAG_ROUTE_ONLY, approvalConsumer, ledger, receiptVerifier, now: NOW }
  )
  return validation('gate15_02_route_flag_only', 'Route flag alone is insufficient.', 'blocked', result.status, [])
}

async function executionFlagOnlyBlocked(): Promise<AppleReminderLiveRouteValidationResult> {
  const { ledger, receiptVerifier, approvalConsumer } = freshDeps()
  const result = await handleAppleReminderLiveCommand(
    issueCommand('approval_x', 'r1'),
    { env: FLAG_EXECUTION_ONLY, approvalConsumer, ledger, receiptVerifier, now: NOW }
  )
  return validation('gate15_03_execution_flag_only', 'Execution flag alone is insufficient.', 'blocked', result.status, [])
}

async function notConfirmedBlocked(): Promise<AppleReminderLiveRouteValidationResult> {
  const { ledger, receiptVerifier, approvalConsumer } = freshDeps()
  const result = await handleAppleReminderLiveCommand(
    { ...issueCommand('approval_x', 'r1'), confirmed: false as unknown as true },
    { env: FLAGS_ON, approvalConsumer, ledger, receiptVerifier, now: NOW }
  )
  return validation('gate15_04_not_confirmed', 'Unconfirmed issue request is blocked.', 'blocked', result.status, [result.auditRecord.blockedReason ?? 'none'])
}

async function missingReminderIdBlocked(): Promise<AppleReminderLiveRouteValidationResult> {
  const { ledger, receiptVerifier, approvalConsumer } = freshDeps()
  const result = await handleAppleReminderLiveCommand(
    issueCommand('approval_x', ''),
    { env: FLAGS_ON, approvalConsumer, ledger, receiptVerifier, now: NOW }
  )
  return validation('gate15_05_missing_reminder_id', 'Missing reminderId is blocked.', 'blocked', result.status, [result.auditRecord.blockedReason ?? 'none'])
}

async function missingApprovalIdBlocked(): Promise<AppleReminderLiveRouteValidationResult> {
  const { ledger, receiptVerifier, approvalConsumer } = freshDeps()
  const result = await handleAppleReminderLiveCommand(
    issueCommand('', 'r1'),
    { env: FLAGS_ON, approvalConsumer, ledger, receiptVerifier, now: NOW }
  )
  return validation('gate15_06_missing_approval_id', 'Missing approvalId is blocked -- this route never synthesizes its own approval.', 'blocked', result.status, [result.auditRecord.blockedReason ?? 'none'])
}

async function missingExactApprovedTextBlocked(): Promise<AppleReminderLiveRouteValidationResult> {
  const { ledger, receiptVerifier, approvalConsumer } = freshDeps()
  const result = await handleAppleReminderLiveCommand(
    { command: 'issue_apple_reminder_packet', approvalId: 'approval_x', reminderId: 'r1', confirmed: true },
    { env: FLAGS_ON, approvalConsumer, ledger, receiptVerifier, now: NOW }
  )
  return validation('gate15_07_missing_exact_approved_text', 'Missing exactApprovedText is rejected as invalid request.', 'blocked', result.status, [result.auditRecord.blockedReason ?? 'none'])
}

async function invalidRequestBlocked(): Promise<AppleReminderLiveRouteValidationResult> {
  const { ledger, receiptVerifier, approvalConsumer } = freshDeps()
  const result = await handleAppleReminderLiveCommand(
    { not_a_command: true },
    { env: FLAGS_ON, approvalConsumer, ledger, receiptVerifier, now: NOW }
  )
  return validation('gate15_08_invalid_request', 'Unrecognized request shape is blocked.', 'blocked', result.status, [result.auditRecord.blockedReason ?? 'none'])
}

async function validIssueSucceeds(): Promise<AppleReminderLiveRouteValidationResult> {
  const { ledger, receiptVerifier, approvalConsumer } = freshDeps()
  approvalConsumer.seed(validApproval({ approvalId: 'approval_valid_issue', reminderId: 'reminder_valid_issue' }))
  const result = await handleAppleReminderLiveCommand(
    issueCommand('approval_valid_issue', 'reminder_valid_issue'),
    { env: FLAGS_ON, approvalConsumer, ledger, receiptVerifier, now: NOW }
  )
  const ledgerEntry = result.packet ? await ledger.getByPacketId(result.packet.packetId) : null
  const observed = result.status === 'issued' && result.shortcutUrl?.startsWith('shortcuts://run-shortcut') && ledgerEntry?.status === 'issued'
    ? 'issued_with_url_and_ledger_row'
    : `unexpected:${result.status}:${result.auditRecord.blockedReason}`
  return validation('gate15_09_valid_issue', 'Valid issue against a consumed authorization snapshot produces packet, Shortcut URL, and issued ledger row.', 'issued_with_url_and_ledger_row', observed, [result.shortcutUrl ?? 'no url'])
}

async function approvalNotFoundBlocked(): Promise<AppleReminderLiveRouteValidationResult> {
  const { ledger, receiptVerifier, approvalConsumer } = freshDeps()
  const result = await handleAppleReminderLiveCommand(
    issueCommand('approval_does_not_exist', 'reminder_gate15'),
    { env: FLAGS_ON, approvalConsumer, ledger, receiptVerifier, now: NOW }
  )
  return validation('gate15_10_approval_not_found', 'Referencing a non-existent approvalId is blocked.', 'blocked', result.status, [result.auditRecord.blockedReason ?? 'none'])
}

async function malformedApprovalIdBlocked(): Promise<AppleReminderLiveRouteValidationResult> {
  const { ledger, receiptVerifier, approvalConsumer } = freshDeps()
  approvalConsumer.forceStatus('not-a-valid-uuid', 'invalid_approval_id')
  const result = await handleAppleReminderLiveCommand(
    issueCommand('not-a-valid-uuid', 'reminder_gate15'),
    { env: FLAGS_ON, approvalConsumer, ledger, receiptVerifier, now: NOW }
  )
  const observed = result.status === 'blocked' &&
    result.auditRecord.blockedReason === 'approval_invalid_id' &&
    !result.packet &&
    !result.auditRecord.ledgerStatus
    ? 'blocked_approval_invalid_id_no_packet_no_ledger'
    : `${result.status}:${result.auditRecord.blockedReason ?? 'none'}:${result.auditRecord.ledgerStatus ?? 'no_ledger_status'}`
  return validation('gate15_10b_malformed_approval_id', 'Malformed approvalId maps to approval_invalid_id without issuing a packet or ledger write.', 'blocked_approval_invalid_id_no_packet_no_ledger', observed, [])
}

async function approvalReminderMismatchBlocked(): Promise<AppleReminderLiveRouteValidationResult> {
  const { ledger, receiptVerifier, approvalConsumer } = freshDeps()
  approvalConsumer.seed(validApproval({ approvalId: 'approval_reminder_mismatch', reminderId: 'reminder_A' }))
  const result = await handleAppleReminderLiveCommand(
    issueCommand('approval_reminder_mismatch', 'reminder_B'),
    { env: FLAGS_ON, approvalConsumer, ledger, receiptVerifier, now: NOW }
  )
  return validation('gate15_11_approval_reminder_mismatch', 'Approval issued for a different reminderId is blocked.', 'blocked', result.status, [result.auditRecord.blockedReason ?? 'none'])
}

async function approvalTextMismatchBlocked(): Promise<AppleReminderLiveRouteValidationResult> {
  const { ledger, receiptVerifier, approvalConsumer } = freshDeps()
  approvalConsumer.seed(validApproval({ approvalId: 'approval_text_mismatch', reminderId: 'reminder_text_mismatch' }))
  const result = await handleAppleReminderLiveCommand(
    issueCommand('approval_text_mismatch', 'reminder_text_mismatch', 'SOMETHING ELSE ENTIRELY'),
    { env: FLAGS_ON, approvalConsumer, ledger, receiptVerifier, now: NOW }
  )
  return validation('gate15_12_approval_text_mismatch', 'Caller-supplied exactApprovedText not matching the stored approval is blocked.', 'blocked', result.status, [result.auditRecord.blockedReason ?? 'none'])
}

async function approvalExpiredBlocked(): Promise<AppleReminderLiveRouteValidationResult> {
  const { ledger, receiptVerifier, approvalConsumer } = freshDeps()
  approvalConsumer.seed(validApproval({ approvalId: 'approval_expired', reminderId: 'reminder_expired', expiresAt: '2026-07-09T11:59:00.000Z' }))
  const result = await handleAppleReminderLiveCommand(
    issueCommand('approval_expired', 'reminder_expired'),
    { env: FLAGS_ON, approvalConsumer, ledger, receiptVerifier, now: NOW }
  )
  return validation('gate15_13_approval_expired', 'Approval that already expired is blocked.', 'blocked', result.status, [result.auditRecord.blockedReason ?? 'none'])
}

async function approvalAlreadyConsumedBlocked(): Promise<AppleReminderLiveRouteValidationResult> {
  const { ledger, receiptVerifier, approvalConsumer } = freshDeps()
  approvalConsumer.seed(validApproval({ approvalId: 'approval_reuse', reminderId: 'reminder_reuse' }))
  const first = await handleAppleReminderLiveCommand(
    issueCommand('approval_reuse', 'reminder_reuse'),
    { env: FLAGS_ON, approvalConsumer, ledger, receiptVerifier, now: NOW }
  )
  const second = await handleAppleReminderLiveCommand(
    issueCommand('approval_reuse', 'reminder_reuse'),
    { env: FLAGS_ON, approvalConsumer, ledger, receiptVerifier, now: NOW }
  )
  const observed = first.status === 'issued' && second.status === 'blocked' && second.auditRecord.blockedReason === 'approval_already_consumed'
    ? 'issued_then_blocked_already_consumed'
    : `unexpected:${first.status}:${second.status}:${second.auditRecord.blockedReason}`
  return validation('gate15_14_approval_already_consumed', 'Reusing the same approvalId for a second issue is blocked.', 'issued_then_blocked_already_consumed', observed, [])
}

async function approvalRevokedBlocked(): Promise<AppleReminderLiveRouteValidationResult> {
  const { ledger, receiptVerifier } = freshDeps()
  const approvalConsumer: AppleApprovalConsumer = {
    async consumeForAppleReminderRead(): Promise<AppleApprovalConsumeResult> {
      return {
        ok: false,
        status: 'revoked',
        authorizationSnapshot: null,
        errorMessage: 'Approval has been revoked.',
      }
    },
  }
  const result = await handleAppleReminderLiveCommand(
    issueCommand('approval_revoked', 'reminder_revoked'),
    { env: FLAGS_ON, approvalConsumer, ledger, receiptVerifier, now: NOW }
  )
  const observed = result.status === 'blocked' && result.auditRecord.blockedReason === 'approval_revoked'
    ? 'blocked_approval_revoked'
    : `unexpected:${result.status}:${result.auditRecord.blockedReason}`
  return validation('gate15_15_approval_revoked', 'Revoked approval maps to approval_revoked.', 'blocked_approval_revoked', observed, [])
}

async function approvalWrongActionTypeBlocked(): Promise<AppleReminderLiveRouteValidationResult> {
  const { ledger, receiptVerifier, approvalConsumer } = freshDeps()
  approvalConsumer.seed(validApproval({
    approvalId: 'approval_wrong_action_type',
    reminderId: 'reminder_wrong_action_type',
    actionType: 'some_other_action' as unknown as AppleReminderExplicitBridgeApproval['actionType'],
  }))
  const result = await handleAppleReminderLiveCommand(
    issueCommand('approval_wrong_action_type', 'reminder_wrong_action_type'),
    { env: FLAGS_ON, approvalConsumer, ledger, receiptVerifier, now: NOW }
  )
  return validation('gate15_16_approval_wrong_action_type', 'Approval with a non-mark_apple_reminder_read actionType is blocked.', 'blocked', result.status, [result.auditRecord.blockedReason ?? 'none'])
}

async function approvalWrongTargetSystemBlocked(): Promise<AppleReminderLiveRouteValidationResult> {
  const { ledger, receiptVerifier, approvalConsumer } = freshDeps()
  approvalConsumer.seed(validApproval({
    approvalId: 'approval_wrong_target_system',
    reminderId: 'reminder_wrong_target_system',
    targetSystem: 'google_tasks' as unknown as AppleReminderExplicitBridgeApproval['targetSystem'],
  }))
  const result = await handleAppleReminderLiveCommand(
    issueCommand('approval_wrong_target_system', 'reminder_wrong_target_system'),
    { env: FLAGS_ON, approvalConsumer, ledger, receiptVerifier, now: NOW }
  )
  return validation('gate15_17_approval_wrong_target_system', 'Approval with a non-apple_reminders targetSystem is blocked.', 'blocked', result.status, [result.auditRecord.blockedReason ?? 'none'])
}

async function approvalNotSingleUseBlocked(): Promise<AppleReminderLiveRouteValidationResult> {
  const { ledger, receiptVerifier, approvalConsumer } = freshDeps()
  approvalConsumer.seed(validApproval({
    approvalId: 'approval_not_single_use',
    reminderId: 'reminder_not_single_use',
    singleUse: false as unknown as true,
  }))
  const result = await handleAppleReminderLiveCommand(
    issueCommand('approval_not_single_use', 'reminder_not_single_use'),
    { env: FLAGS_ON, approvalConsumer, ledger, receiptVerifier, now: NOW }
  )
  return validation('gate15_18_approval_not_single_use', 'Approval not marked single-use is blocked.', 'blocked', result.status, [result.auditRecord.blockedReason ?? 'none'])
}

async function approvalNotActiveStatusBlocked(): Promise<AppleReminderLiveRouteValidationResult> {
  const { ledger, receiptVerifier, approvalConsumer } = freshDeps()
  approvalConsumer.seed(validApproval({
    approvalId: 'approval_rejected_status',
    reminderId: 'reminder_rejected_status',
    status: 'rejected',
  }))
  const result = await handleAppleReminderLiveCommand(
    issueCommand('approval_rejected_status', 'reminder_rejected_status'),
    { env: FLAGS_ON, approvalConsumer, ledger, receiptVerifier, now: NOW }
  )
  return validation('gate15_19_approval_not_active_status', 'Approval with a non-active status is blocked.', 'blocked', result.status, [result.auditRecord.blockedReason ?? 'none'])
}

async function packetCreationFailureDoesNotRefundApproval(): Promise<AppleReminderLiveRouteValidationResult> {
  const { ledger, receiptVerifier, approvalConsumer } = freshDeps()
  const approval = validApproval({ approvalId: 'approval_packet_failure', reminderId: 'reminder_packet_failure' })
  approvalConsumer.seed(approval)
  approvalConsumer.overrideSnapshot(approval.approvalId, snapshot => ({
    ...snapshot,
    reusableAuthority: true as false,
  }))

  const first = await handleAppleReminderLiveCommand(
    issueCommand('approval_packet_failure', 'reminder_packet_failure'),
    { env: FLAGS_ON, approvalConsumer, ledger, receiptVerifier, now: NOW }
  )
  const secondConsume = await approvalConsumer.consumeForAppleReminderRead({
    approvalId: approval.approvalId,
    reminderId: approval.reminderId,
    exactApprovedText: approval.exactApprovedText,
    now: NOW,
  })
  const observed = first.status === 'blocked' &&
    first.auditRecord.blockedReason === 'packet_creation_blocked' &&
    secondConsume.status === 'already_consumed'
    ? 'packet_failed_approval_remained_consumed_no_refund'
    : `unexpected:${first.status}:${first.auditRecord.blockedReason}:${secondConsume.status}`

  return validation(
    'gate15_20_packet_failure_no_refund',
    'Approval consumed successfully, packet creation fails, approval remains consumed, second consume is rejected.',
    'packet_failed_approval_remained_consumed_no_refund',
    observed,
    ['No refund/restore attempt is made after packet creation failure.']
  )
}

async function submitWithoutPacketBlocked(): Promise<AppleReminderLiveRouteValidationResult> {
  const { ledger, receiptVerifier, approvalConsumer } = freshDeps()
  const result = await handleAppleReminderLiveCommand(
    { command: 'submit_apple_reminder_receipt', receiptText: '{}' },
    { env: FLAGS_ON, approvalConsumer, ledger, receiptVerifier, now: NOW }
  )
  return validation('gate15_21_submit_without_packet', 'Receipt submission without the original packet is blocked.', 'blocked', result.status, [result.auditRecord.blockedReason ?? 'none'])
}

async function submitInvalidReceiptBlocked(): Promise<AppleReminderLiveRouteValidationResult> {
  const { ledger, receiptVerifier, approvalConsumer } = freshDeps()
  approvalConsumer.seed(validApproval({ approvalId: 'approval_gate15b', reminderId: 'reminder_gate15b' }))
  const issue = await handleAppleReminderLiveCommand(
    issueCommand('approval_gate15b', 'reminder_gate15b'),
    { env: FLAGS_ON, approvalConsumer, ledger, receiptVerifier, now: NOW }
  )
  const result = await handleAppleReminderLiveCommand(
    { command: 'submit_apple_reminder_receipt', packet: issue.packet, receiptText: 'not json' },
    { env: FLAGS_ON, approvalConsumer, ledger, receiptVerifier, now: NOW }
  )
  return validation('gate15_22_submit_invalid_receipt', 'Malformed receipt text is blocked.', 'blocked', result.status, [result.auditRecord.blockedReason ?? 'none'])
}

async function validReceiptVerifiedClean(): Promise<AppleReminderLiveRouteValidationResult> {
  const { ledger, receiptVerifier, approvalConsumer } = freshDeps()
  approvalConsumer.seed(validApproval({ approvalId: 'approval_gate15c', reminderId: 'reminder_gate15c' }))
  const issue = await handleAppleReminderLiveCommand(
    issueCommand('approval_gate15c', 'reminder_gate15c'),
    { env: FLAGS_ON, approvalConsumer, ledger, receiptVerifier, now: NOW }
  )
  if (!issue.packet) return validation('gate15_23_valid_receipt', 'Issue produced a packet.', 'verified', 'no_packet', [issue.auditRecord.blockedReason ?? 'none'])

  const receipt = createValidReceipt(issue.packet, { createdAt: NOW })
  const result = await handleAppleReminderLiveCommand(
    { command: 'submit_apple_reminder_receipt', packet: issue.packet, receiptText: JSON.stringify(receipt) },
    { env: FLAGS_ON, approvalConsumer, ledger, receiptVerifier, now: NOW }
  )
  return validation('gate15_23_valid_receipt', 'Valid receipt against the issued packet verifies clean.', 'verified', result.status, result.verification?.issues ?? [])
}

async function replayedReceiptRejected(): Promise<AppleReminderLiveRouteValidationResult> {
  const { ledger, receiptVerifier, approvalConsumer } = freshDeps()
  approvalConsumer.seed(validApproval({ approvalId: 'approval_gate15d', reminderId: 'reminder_gate15d' }))
  const issue = await handleAppleReminderLiveCommand(
    issueCommand('approval_gate15d', 'reminder_gate15d'),
    { env: FLAGS_ON, approvalConsumer, ledger, receiptVerifier, now: NOW }
  )
  if (!issue.packet) return validation('gate15_24_replay_rejected', 'Issue produced a packet.', 'rejected', 'no_packet', [issue.auditRecord.blockedReason ?? 'none'])

  const receipt = createValidReceipt(issue.packet, { createdAt: NOW })
  await handleAppleReminderLiveCommand(
    { command: 'submit_apple_reminder_receipt', packet: issue.packet, receiptText: JSON.stringify(receipt) },
    { env: FLAGS_ON, approvalConsumer, ledger, receiptVerifier, now: NOW }
  )
  const replay = await handleAppleReminderLiveCommand(
    { command: 'submit_apple_reminder_receipt', packet: issue.packet, receiptText: JSON.stringify(receipt) },
    { env: FLAGS_ON, approvalConsumer, ledger, receiptVerifier, now: NOW }
  )
  return validation('gate15_24_replay_rejected', 'Replaying the same receipt is rejected.', 'rejected', replay.status, replay.verification?.issues ?? [])
}

class FakeAppleApprovalConsumer implements AppleApprovalConsumer {
  private readonly state: FakeApprovalState = {
    approvals: new Map(),
    snapshotOverrides: new Map(),
    forcedStatuses: new Map(),
  }

  seed(approval: AppleReminderExplicitBridgeApproval): void {
    this.state.approvals.set(approval.approvalId, approval)
  }

  overrideSnapshot(
    approvalId: string,
    override: (snapshot: AppleReminderConsumedApprovalSnapshot) => AppleReminderConsumedApprovalSnapshot
  ): void {
    this.state.snapshotOverrides.set(approvalId, override)
  }

  forceStatus(approvalId: string, status: AppleApprovalConsumeStatus): void {
    this.state.forcedStatuses.set(approvalId, status)
  }

  async consumeForAppleReminderRead(input: AppleApprovalConsumeInput): Promise<AppleApprovalConsumeResult> {
    const forcedStatus = this.state.forcedStatuses.get(input.approvalId)
    if (forcedStatus) return consumeResult(false, forcedStatus, null, `Forced ${forcedStatus} for validation.`)

    const approval = this.state.approvals.get(input.approvalId) ?? null
    if (!approval) return consumeResult(false, 'not_found', null, 'No approval found for this approvalId.')
    if (approval.actionType !== 'mark_apple_reminder_read') return consumeResult(false, 'action_type_mismatch', null, 'Approval actionType is not mark_apple_reminder_read.')
    if (approval.targetSystem !== 'apple_reminders') return consumeResult(false, 'target_system_mismatch', null, 'Approval targetSystem is not apple_reminders.')
    if (approval.reminderId !== input.reminderId) return consumeResult(false, 'reminder_mismatch', null, 'Approval reminderId does not match the request.')
    if (approval.exactApprovedText !== input.exactApprovedText) return consumeResult(false, 'text_mismatch', null, 'Approval exactApprovedText does not match the request.')
    if (approval.singleUse !== true) return consumeResult(false, 'consume_failed', null, 'Approval is not marked single-use.')
    if (approval.consumedAt !== null || approval.status === 'consumed') return consumeResult(false, 'already_consumed', null, 'Approval has already been consumed.')
    if (approval.status !== 'active') return consumeResult(false, 'not_active', null, `Approval status is ${approval.status}, not active.`)
    if (new Date(approval.expiresAt).getTime() <= new Date(input.now).getTime()) {
      this.state.approvals.set(approval.approvalId, { ...approval, status: 'expired' })
      return consumeResult(false, 'expired', null, 'Approval has expired.')
    }

    const consumed = { ...approval, status: 'consumed' as const, consumedAt: input.now }
    this.state.approvals.set(approval.approvalId, consumed)
    const snapshot = snapshotFromApproval(consumed, input.now)
    const override = this.state.snapshotOverrides.get(approval.approvalId)
    return consumeResult(true, 'consumed', override ? override(snapshot) : snapshot, null)
  }
}

function issueCommand(
  approvalId: string,
  reminderId: string,
  exactApprovedText: string = APPLE_REMINDER_LIVE_EXACT_APPROVED_TEXT
) {
  return {
    command: 'issue_apple_reminder_packet' as const,
    approvalId,
    reminderId,
    exactApprovedText,
    confirmed: true as const,
  }
}

function snapshotFromApproval(
  approval: AppleReminderExplicitBridgeApproval & { status: 'consumed'; consumedAt: string },
  validAt: string
): AppleReminderConsumedApprovalSnapshot {
  return {
    snapshotKind: 'ConsumedApprovalSnapshot',
    approvalPattern: 'ExplicitExecutionApproval',
    approvalId: approval.approvalId,
    exactApprovedText: approval.exactApprovedText,
    commanderInput: approval.commanderInput,
    actionType: approval.actionType,
    targetSystem: approval.targetSystem,
    reminderId: approval.reminderId,
    singleUse: true,
    nonce: approval.nonce,
    createdAt: approval.createdAt,
    expiresAt: approval.expiresAt,
    consumedAt: approval.consumedAt,
    consumedStatus: 'consumed',
    validAt,
    reusableAuthority: false,
    source: 'supabase_approval_authority',
  }
}

function consumeResult(
  ok: boolean,
  status: AppleApprovalConsumeStatus,
  authorizationSnapshot: AppleReminderConsumedApprovalSnapshot | null,
  errorMessage: string | null
): AppleApprovalConsumeResult {
  return { ok, status, authorizationSnapshot, errorMessage }
}

function validation(
  caseId: string,
  description: string,
  expected: string,
  observed: string,
  notes: string[]
): AppleReminderLiveRouteValidationResult {
  return {
    caseId,
    description,
    expected,
    observed,
    result: expected === observed ? 'PASS' : 'FAIL',
    notes,
  }
}
