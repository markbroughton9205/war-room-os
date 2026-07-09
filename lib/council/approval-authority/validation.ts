import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { SupabaseApprovalAuthority } from './SupabaseApprovalAuthority'
import {
  EXPLICIT_EXECUTION_APPROVALS_TABLE,
  type ApprovalAuthorityValidationResult,
  type IssueApprovalInput,
} from './types'

type Gate14Client = Pick<SupabaseClient, 'from'>

const TEST_PREFIX = 'gate14-test-'

export async function runGate14ApprovalAuthorityValidation(): Promise<ApprovalAuthorityValidationResult[]> {
  const client = createSupabaseAdminClient()
  const authority = new SupabaseApprovalAuthority(client, () => `${TEST_PREFIX}nonce-${crypto.randomUUID()}`)

  await cleanupGate14Approvals(client)

  try {
    return [
      await issueSucceeds(authority),
      await consumeValidSucceedsExactlyOnce(authority),
      await consumeTwiceFailsSecondAttempt(authority),
      await expiredApprovalRejected(authority),
      await actionTypeMismatchRejected(authority),
      await targetSystemMismatchRejected(authority),
      await targetIdMismatchRejected(authority),
      await exactTextMismatchRejected(authority),
      await revokedApprovalCannotBeConsumed(authority),
    ]
  } finally {
    await cleanupGate14Approvals(client)
  }
}

async function issueSucceeds(authority: SupabaseApprovalAuthority): Promise<ApprovalAuthorityValidationResult> {
  const issued = await authority.issue(input('issue-succeeds'))
  const observed = issued.ok && issued.status === 'issued' && issued.approval?.status === 'active'
    ? 'issued_active'
    : `unexpected:${issued.status}:${issued.errorMessage ?? 'no_error_message'}`

  return validation('gate14_issue_succeeds', 'issue() creates an active Supabase approval row.', 'issued_active', observed, [])
}

async function consumeValidSucceedsExactlyOnce(
  authority: SupabaseApprovalAuthority
): Promise<ApprovalAuthorityValidationResult> {
  const issued = await authority.issue(input('consume-valid'))
  if (!issued.approval) {
    return validation('gate14_consume_valid_once', 'consumeIfValid() succeeds for a matching active approval.', 'consumed', `issue_failed:${issued.status}`, [])
  }

  const consumed = await authority.consumeIfValid(
    issued.approval.approval_id,
    issued.approval.action_type,
    issued.approval.target_system,
    issued.approval.target_id,
    issued.approval.exact_approved_text
  )

  return validation('gate14_consume_valid_once', 'consumeIfValid() succeeds for a matching active approval.', 'consumed', consumed.status, [])
}

async function consumeTwiceFailsSecondAttempt(
  authority: SupabaseApprovalAuthority
): Promise<ApprovalAuthorityValidationResult> {
  const issued = await authority.issue(input('consume-twice'))
  if (!issued.approval) {
    return validation('gate14_consume_twice_second_fails', 'Second consumeIfValid() call is rejected.', 'already_consumed', `issue_failed:${issued.status}`, [])
  }

  await authority.consumeIfValid(
    issued.approval.approval_id,
    issued.approval.action_type,
    issued.approval.target_system,
    issued.approval.target_id,
    issued.approval.exact_approved_text
  )
  const replay = await authority.consumeIfValid(
    issued.approval.approval_id,
    issued.approval.action_type,
    issued.approval.target_system,
    issued.approval.target_id,
    issued.approval.exact_approved_text
  )

  return validation('gate14_consume_twice_second_fails', 'Second consumeIfValid() call is rejected.', 'already_consumed', replay.status, [])
}

async function expiredApprovalRejected(authority: SupabaseApprovalAuthority): Promise<ApprovalAuthorityValidationResult> {
  const issued = await authority.issue(input('expired', { ttlMs: -60_000 }))
  if (!issued.approval) {
    return validation('gate14_expired_rejected', 'Expired approval cannot be consumed.', 'expired', `issue_failed:${issued.status}`, [])
  }

  const consumed = await authority.consumeIfValid(
    issued.approval.approval_id,
    issued.approval.action_type,
    issued.approval.target_system,
    issued.approval.target_id,
    issued.approval.exact_approved_text
  )

  return validation('gate14_expired_rejected', 'Expired approval cannot be consumed.', 'expired', consumed.status, [])
}

async function actionTypeMismatchRejected(authority: SupabaseApprovalAuthority): Promise<ApprovalAuthorityValidationResult> {
  const issued = await authority.issue(input('action-mismatch'))
  if (!issued.approval) {
    return validation('gate14_action_type_mismatch', 'Mismatched action_type is rejected.', 'action_type_mismatch', `issue_failed:${issued.status}`, [])
  }

  const consumed = await authority.consumeIfValid(
    issued.approval.approval_id,
    `${TEST_PREFIX}different-action`,
    issued.approval.target_system,
    issued.approval.target_id,
    issued.approval.exact_approved_text
  )

  return validation('gate14_action_type_mismatch', 'Mismatched action_type is rejected.', 'action_type_mismatch', consumed.status, [])
}

async function targetSystemMismatchRejected(authority: SupabaseApprovalAuthority): Promise<ApprovalAuthorityValidationResult> {
  const issued = await authority.issue(input('system-mismatch'))
  if (!issued.approval) {
    return validation('gate14_target_system_mismatch', 'Mismatched target_system is rejected.', 'target_system_mismatch', `issue_failed:${issued.status}`, [])
  }

  const consumed = await authority.consumeIfValid(
    issued.approval.approval_id,
    issued.approval.action_type,
    `${TEST_PREFIX}different-system`,
    issued.approval.target_id,
    issued.approval.exact_approved_text
  )

  return validation('gate14_target_system_mismatch', 'Mismatched target_system is rejected.', 'target_system_mismatch', consumed.status, [])
}

async function targetIdMismatchRejected(authority: SupabaseApprovalAuthority): Promise<ApprovalAuthorityValidationResult> {
  const issued = await authority.issue(input('target-mismatch'))
  if (!issued.approval) {
    return validation('gate14_target_id_mismatch', 'Mismatched target_id is rejected.', 'target_id_mismatch', `issue_failed:${issued.status}`, [])
  }

  const consumed = await authority.consumeIfValid(
    issued.approval.approval_id,
    issued.approval.action_type,
    issued.approval.target_system,
    `${TEST_PREFIX}different-target`,
    issued.approval.exact_approved_text
  )

  return validation('gate14_target_id_mismatch', 'Mismatched target_id is rejected.', 'target_id_mismatch', consumed.status, [])
}

async function exactTextMismatchRejected(authority: SupabaseApprovalAuthority): Promise<ApprovalAuthorityValidationResult> {
  const issued = await authority.issue(input('text-mismatch'))
  if (!issued.approval) {
    return validation('gate14_exact_text_mismatch', 'Mismatched exact_approved_text is rejected.', 'exact_text_mismatch', `issue_failed:${issued.status}`, [])
  }

  const consumed = await authority.consumeIfValid(
    issued.approval.approval_id,
    issued.approval.action_type,
    issued.approval.target_system,
    issued.approval.target_id,
    `${TEST_PREFIX}different exact approval`
  )

  return validation('gate14_exact_text_mismatch', 'Mismatched exact_approved_text is rejected.', 'exact_text_mismatch', consumed.status, [])
}

async function revokedApprovalCannotBeConsumed(
  authority: SupabaseApprovalAuthority
): Promise<ApprovalAuthorityValidationResult> {
  const issued = await authority.issue(input('revoked'))
  if (!issued.approval) {
    return validation('gate14_revoked_cannot_consume', 'Revoked approval cannot be consumed.', 'revoked', `issue_failed:${issued.status}`, [])
  }

  await authority.revoke(issued.approval.approval_id, `${TEST_PREFIX}revoked during Gate 14 validation`)
  const consumed = await authority.consumeIfValid(
    issued.approval.approval_id,
    issued.approval.action_type,
    issued.approval.target_system,
    issued.approval.target_id,
    issued.approval.exact_approved_text
  )

  return validation('gate14_revoked_cannot_consume', 'Revoked approval cannot be consumed.', 'revoked', consumed.status, [])
}

function input(label: string, overrides: Partial<IssueApprovalInput> = {}): IssueApprovalInput {
  return {
    exact_approved_text: `${TEST_PREFIX}approve ${label}`,
    commander_input: `${TEST_PREFIX}commander requested ${label}`,
    approved_by: `${TEST_PREFIX}operator`,
    action_type: `${TEST_PREFIX}action-${label}`,
    target_system: `${TEST_PREFIX}system`,
    target_id: `${TEST_PREFIX}target-${label}`,
    ...overrides,
  }
}

async function cleanupGate14Approvals(client: Gate14Client): Promise<void> {
  const { error } = await client
    .from(EXPLICIT_EXECUTION_APPROVALS_TABLE)
    .delete()
    .or([
      `exact_approved_text.like.${TEST_PREFIX}%`,
      `commander_input.like.${TEST_PREFIX}%`,
      `approved_by.like.${TEST_PREFIX}%`,
      `action_type.like.${TEST_PREFIX}%`,
      `target_system.like.${TEST_PREFIX}%`,
      `target_id.like.${TEST_PREFIX}%`,
      `nonce.like.${TEST_PREFIX}%`,
    ].join(','))

  if (error) {
    throw new Error(`Gate 14 cleanup failed: ${error.message}`)
  }
}

function validation(
  caseId: string,
  description: string,
  expected: string,
  observed: string,
  notes: string[]
): ApprovalAuthorityValidationResult {
  return {
    caseId,
    description,
    expected,
    observed,
    result: expected === observed ? 'PASS' : 'FAIL',
    notes,
  }
}
