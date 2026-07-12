export const APPROVAL_ISSUANCE_ACTION_TYPE = 'mark_apple_reminder_read'
export const APPROVAL_ISSUANCE_TARGET_SYSTEM = 'apple_reminders'

export type ApprovalIssuanceTemplateVersion = 'apple_reminder_mark_read_v1' | 'apple_reminder_mark_read_v2'

export type ApprovalIssuanceTemplateInput = {
  targetId: string
}

export type ApprovalIssuanceTemplateResult =
  | {
      ok: true
      templateVersion: ApprovalIssuanceTemplateVersion
      exactApprovedText: string
    }
  | {
      ok: false
      status: 'unknown_template' | 'invalid_target_id'
      message: string
    }

export function buildApprovalIssuanceTemplate(
  templateVersion: string,
  input: ApprovalIssuanceTemplateInput
): ApprovalIssuanceTemplateResult {
  const targetId = input.targetId.trim()
  if (!targetId) {
    return { ok: false, status: 'invalid_target_id', message: 'targetId is required.' }
  }

  if (templateVersion === 'apple_reminder_mark_read_v1') {
    return {
      ok: true,
      templateVersion,
      exactApprovedText: `I approve War Room to prepare one single-use Apple Reminder packet for reminder "${targetId}" so I can manually mark it read on my iPhone.`,
    }
  }

  if (templateVersion === 'apple_reminder_mark_read_v2') {
    return {
      ok: true,
      templateVersion,
      exactApprovedText: `I approve one single-use War Room authorization for Apple Reminder "${targetId}". It may only prepare a manual Shortcut packet for mark_apple_reminder_read.`,
    }
  }

  return {
    ok: false,
    status: 'unknown_template',
    message: 'Unknown approval template version.',
  }
}
