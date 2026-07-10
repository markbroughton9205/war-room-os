import {
  SupabaseApprovalAuthority,
  createSupabaseApprovalAuthority,
  type ConsumeApprovalStatus,
  type ExplicitExecutionApproval,
} from '../approval-authority'
import type { AppleReminderConsumedApprovalSnapshot } from '../apple-reminders-bridge'
import type {
  AppleApprovalConsumeInput,
  AppleApprovalConsumeResult,
  AppleApprovalConsumeStatus,
  AppleApprovalConsumer,
} from './types'

const APPLE_REMINDER_ACTION_TYPE = 'mark_apple_reminder_read'
const APPLE_REMINDER_TARGET_SYSTEM = 'apple_reminders'

export class SupabaseAppleApprovalConsumer implements AppleApprovalConsumer {
  constructor(private readonly approvalAuthority: SupabaseApprovalAuthority = createSupabaseApprovalAuthority()) {}

  async consumeForAppleReminderRead(input: AppleApprovalConsumeInput): Promise<AppleApprovalConsumeResult> {
    const result = await this.approvalAuthority.consumeIfValid(
      input.approvalId,
      APPLE_REMINDER_ACTION_TYPE,
      APPLE_REMINDER_TARGET_SYSTEM,
      input.reminderId,
      input.exactApprovedText
    )

    if (!result.ok || !result.approval) {
      return {
        ok: false,
        status: mapConsumeStatus(result.status),
        authorizationSnapshot: null,
        errorMessage: result.errorMessage,
      }
    }

    if (!result.approval.consumed_at) {
      return {
        ok: false,
        status: 'consume_failed',
        authorizationSnapshot: null,
        errorMessage: 'Approval Authority returned success without consumed_at.',
      }
    }

    if (result.approval.single_use !== true) {
      return {
        ok: false,
        status: 'consume_failed',
        authorizationSnapshot: null,
        errorMessage: 'Approval Authority consumed a non-single-use approval; packet creation is blocked.',
      }
    }

    try {
      return {
        ok: true,
        status: 'consumed',
        authorizationSnapshot: snapshotFromConsumedApproval(
          result.approval,
          input.now,
          input.exactApprovedText,
          input.reminderId
        ),
        errorMessage: null,
      }
    } catch (error) {
      return {
        ok: false,
        status: 'consume_failed',
        authorizationSnapshot: null,
        errorMessage: error instanceof Error ? error.message : 'Authorization snapshot construction failed.',
      }
    }
  }
}

export function createLiveAppleApprovalConsumer(): AppleApprovalConsumer {
  return new SupabaseAppleApprovalConsumer()
}

export function snapshotFromConsumedApproval(
  approval: ExplicitExecutionApproval,
  validAt: string,
  expectedExactApprovedText: string,
  reminderId: string
): AppleReminderConsumedApprovalSnapshot {
  if (approval.action_type !== 'mark_apple_reminder_read') {
    throw new Error('Cannot create Apple reminder authorization snapshot from non-Apple-reminder action_type.')
  }
  if (approval.target_system !== 'apple_reminders') {
    throw new Error('Cannot create Apple reminder authorization snapshot from non-Apple-reminders target_system.')
  }
  if (approval.single_use !== true) {
    throw new Error('Cannot create Apple reminder authorization snapshot from non-single-use approval.')
  }
  if (approval.status !== 'consumed') {
    throw new Error('Cannot create Apple reminder authorization snapshot from an unconsumed approval.')
  }
  if (!approval.consumed_at) {
    throw new Error('Cannot create Apple reminder authorization snapshot without consumed_at.')
  }
  if (approval.exact_approved_text !== expectedExactApprovedText) {
    throw new Error('Cannot create Apple reminder authorization snapshot: exact_approved_text mismatch.')
  }
  if (approval.target_id !== reminderId) {
    throw new Error('Cannot create Apple reminder authorization snapshot: target_id/reminderId mismatch.')
  }

  return {
    snapshotKind: 'ConsumedApprovalSnapshot',
    approvalPattern: 'ExplicitExecutionApproval',
    approvalId: approval.approval_id,
    exactApprovedText: approval.exact_approved_text,
    commanderInput: approval.commander_input,
    actionType: 'mark_apple_reminder_read',
    targetSystem: 'apple_reminders',
    reminderId: approval.target_id,
    singleUse: true,
    nonce: approval.nonce,
    createdAt: approval.created_at,
    expiresAt: approval.expires_at,
    consumedAt: approval.consumed_at,
    consumedStatus: 'consumed',
    validAt,
    reusableAuthority: false,
    source: 'supabase_approval_authority',
  }
}

function mapConsumeStatus(status: ConsumeApprovalStatus): AppleApprovalConsumeStatus {
  switch (status) {
    case 'consumed': return 'consumed'
    case 'invalid_approval_id': return 'invalid_approval_id'
    case 'not_found': return 'not_found'
    case 'already_consumed': return 'already_consumed'
    case 'expired': return 'expired'
    case 'revoked': return 'revoked'
    case 'not_active': return 'not_active'
    case 'action_type_mismatch': return 'action_type_mismatch'
    case 'target_system_mismatch': return 'target_system_mismatch'
    case 'target_id_mismatch': return 'reminder_mismatch'
    case 'exact_text_mismatch': return 'text_mismatch'
    case 'consume_failed': return 'consume_failed'
  }
}
