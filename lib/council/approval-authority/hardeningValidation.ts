import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { SupabaseApprovalAuthority } from './SupabaseApprovalAuthority'
import { EXPLICIT_EXECUTION_APPROVALS_TABLE } from './types'
import type {
  ApprovalAuthoritySecurityTelemetryEvent,
  ApprovalAuthoritySecurityTelemetrySink,
  ApprovalAuthorityValidationResult,
  IssueApprovalInput,
} from './types'

type Gate46OHClient = Pick<SupabaseClient, 'from'>

const PREFIX = 'gate46oh-test-'
const ACTION_TYPE = 'mark_apple_reminder_read'
const TARGET_SYSTEM = 'apple_reminders'
const EXACT_TEXT = `${PREFIX}I APPROVE MARKING THIS APPLE REMINDER READ`

export async function runApprovalAuthorityHardeningValidation(): Promise<ApprovalAuthorityValidationResult[]> {
  const results = [
    await malformedApprovalIdRejectedBeforeDb(),
    await validUuidMissingRecordRemainsNotFound(),
    await expiredApprovalCannotBeConsumedOrBecomeActive(),
    await consumedApprovalCannotBecomeExpired(),
    await revokedApprovalCannotBecomeActive(),
    await repeatedConsumeAttemptsOnTerminalApprovalRemainTerminal(),
  ]

  return results
}

async function malformedApprovalIdRejectedBeforeDb(): Promise<ApprovalAuthorityValidationResult> {
  const fakeClient = new CountingNoQueryClient()
  const telemetry = new RecordingTelemetrySink()
  const authority = new SupabaseApprovalAuthority(fakeClient, () => `${PREFIX}nonce`, telemetry)
  const result = await authority.consumeIfValid(
    'not-a-uuid',
    ACTION_TYPE,
    TARGET_SYSTEM,
    `${PREFIX}target`,
    EXACT_TEXT
  )
  const observed = result.status === 'invalid_approval_id' &&
    fakeClient.fromCalls === 0 &&
    telemetry.events.length === 1 &&
    telemetry.events[0]?.category === 'malformed_approval_id_probe'
    ? 'invalid_approval_id_zero_db_query_telemetry_recorded'
    : `status=${result.status};fromCalls=${fakeClient.fromCalls};telemetry=${telemetry.events.length}`

  return validation(
    'gate46oh_invalid_approval_id_zero_db_query',
    'Malformed approvalId is rejected before any Supabase query/mutation and logged as malformed probe telemetry.',
    'invalid_approval_id_zero_db_query_telemetry_recorded',
    observed,
    ['Telemetry category: malformed_approval_id_probe']
  )
}

async function validUuidMissingRecordRemainsNotFound(): Promise<ApprovalAuthorityValidationResult> {
  const authority = new SupabaseApprovalAuthority(createSupabaseAdminClient())
  const result = await authority.consumeIfValid(
    randomUUID(),
    ACTION_TYPE,
    TARGET_SYSTEM,
    `${PREFIX}missing-target`,
    EXACT_TEXT
  )
  return validation(
    'gate46oh_valid_uuid_missing_record_not_found',
    'Valid UUID with no matching approval remains not_found, distinct from invalid_approval_id.',
    'not_found',
    result.status,
    []
  )
}

async function expiredApprovalCannotBeConsumedOrBecomeActive(): Promise<ApprovalAuthorityValidationResult> {
  return withCleanup(async authority => {
    const issued = await authority.issue(input('expired', { ttlMs: -60_000 }))
    if (!issued.approval) {
      return validation('gate46oh_expired_terminal', 'Expired approval cannot be consumed.', 'expired_stayed_terminal', `issue_failed:${issued.status}`, [])
    }
    const consume = await authority.consumeIfValid(
      issued.approval.approval_id,
      issued.approval.action_type,
      issued.approval.target_system,
      issued.approval.target_id,
      issued.approval.exact_approved_text
    )
    const row = await authority.getById(issued.approval.approval_id)
    const observed = consume.status === 'expired' && row?.status === 'expired'
      ? 'expired_stayed_terminal'
      : `consume=${consume.status};row=${row?.status ?? 'missing'}`
    return validation('gate46oh_expired_terminal', 'Expired approval cannot be consumed and cannot become active.', 'expired_stayed_terminal', observed, ['Expiry is lazy: persisted when consume checks expiration.'])
  })
}

async function consumedApprovalCannotBecomeExpired(): Promise<ApprovalAuthorityValidationResult> {
  return withCleanup(async authority => {
    const issued = await authority.issue(input('consumed', { ttlMs: 60_000 }))
    if (!issued.approval) {
      return validation('gate46oh_consumed_not_expired', 'Consumed approval cannot become expired.', 'consumed_stayed_terminal', `issue_failed:${issued.status}`, [])
    }
    await authority.consumeIfValid(
      issued.approval.approval_id,
      issued.approval.action_type,
      issued.approval.target_system,
      issued.approval.target_id,
      issued.approval.exact_approved_text
    )
    const second = await authority.consumeIfValid(
      issued.approval.approval_id,
      issued.approval.action_type,
      issued.approval.target_system,
      issued.approval.target_id,
      issued.approval.exact_approved_text
    )
    const row = await authority.getById(issued.approval.approval_id)
    const observed = second.status === 'already_consumed' && row?.status === 'consumed'
      ? 'consumed_stayed_terminal'
      : `second=${second.status};row=${row?.status ?? 'missing'}`
    return validation('gate46oh_consumed_not_expired', 'Consumed approval cannot become expired.', 'consumed_stayed_terminal', observed, [])
  })
}

async function revokedApprovalCannotBecomeActive(): Promise<ApprovalAuthorityValidationResult> {
  return withCleanup(async authority => {
    const issued = await authority.issue(input('revoked'))
    if (!issued.approval) {
      return validation('gate46oh_revoked_not_active', 'Revoked approval cannot become active.', 'revoked_stayed_terminal', `issue_failed:${issued.status}`, [])
    }
    await authority.revoke(issued.approval.approval_id, `${PREFIX}revoked by hardening validation`)
    const consume = await authority.consumeIfValid(
      issued.approval.approval_id,
      issued.approval.action_type,
      issued.approval.target_system,
      issued.approval.target_id,
      issued.approval.exact_approved_text
    )
    const row = await authority.getById(issued.approval.approval_id)
    const observed = consume.status === 'revoked' && row?.status === 'revoked'
      ? 'revoked_stayed_terminal'
      : `consume=${consume.status};row=${row?.status ?? 'missing'}`
    return validation('gate46oh_revoked_not_active', 'Revoked approval cannot become active.', 'revoked_stayed_terminal', observed, [])
  })
}

async function repeatedConsumeAttemptsOnTerminalApprovalRemainTerminal(): Promise<ApprovalAuthorityValidationResult> {
  return withCleanup(async authority => {
    const issued = await authority.issue(input('terminal-repeat'))
    if (!issued.approval) {
      return validation('gate46oh_terminal_repeat', 'Repeated consume attempts on terminal approval remain terminal.', 'already_consumed_consumed', `issue_failed:${issued.status}`, [])
    }
    await authority.consumeIfValid(
      issued.approval.approval_id,
      issued.approval.action_type,
      issued.approval.target_system,
      issued.approval.target_id,
      issued.approval.exact_approved_text
    )
    const repeat = await authority.consumeIfValid(
      issued.approval.approval_id,
      issued.approval.action_type,
      issued.approval.target_system,
      issued.approval.target_id,
      issued.approval.exact_approved_text
    )
    const row = await authority.getById(issued.approval.approval_id)
    const observed = repeat.status === 'already_consumed' && row?.status === 'consumed'
      ? 'already_consumed_consumed'
      : `repeat=${repeat.status};row=${row?.status ?? 'missing'}`
    return validation('gate46oh_terminal_repeat', 'Repeated consume attempts on terminal approval remain terminal.', 'already_consumed_consumed', observed, [])
  })
}

async function withCleanup(
  fn: (authority: SupabaseApprovalAuthority) => Promise<ApprovalAuthorityValidationResult>
): Promise<ApprovalAuthorityValidationResult> {
  const client = createSupabaseAdminClient()
  await cleanup(client)
  try {
    return await fn(new SupabaseApprovalAuthority(client, () => `${PREFIX}nonce-${randomUUID()}`))
  } finally {
    await cleanup(client)
  }
}

async function cleanup(client: Gate46OHClient): Promise<void> {
  const { error } = await client
    .from(EXPLICIT_EXECUTION_APPROVALS_TABLE)
    .delete()
    .or([
      `exact_approved_text.like.${PREFIX}%`,
      `commander_input.like.${PREFIX}%`,
      `approved_by.like.${PREFIX}%`,
      `action_type.like.${PREFIX}%`,
      `target_system.like.${PREFIX}%`,
      `target_id.like.${PREFIX}%`,
      `nonce.like.${PREFIX}%`,
    ].join(','))

  if (error) throw new Error(`Approval hardening cleanup failed: ${error.message}`)
}

function input(label: string, overrides: Partial<IssueApprovalInput> = {}): IssueApprovalInput {
  return {
    exact_approved_text: EXACT_TEXT,
    commander_input: `${PREFIX}commander requested ${label}`,
    approved_by: `${PREFIX}operator`,
    action_type: ACTION_TYPE,
    target_system: TARGET_SYSTEM,
    target_id: `${PREFIX}target-${label}`,
    ...overrides,
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

class RecordingTelemetrySink implements ApprovalAuthoritySecurityTelemetrySink {
  readonly events: ApprovalAuthoritySecurityTelemetryEvent[] = []

  record(event: ApprovalAuthoritySecurityTelemetryEvent): void {
    this.events.push(event)
  }
}

class CountingNoQueryClient {
  fromCalls = 0

  from(): never {
    this.fromCalls += 1
    throw new Error('Database access was not expected for malformed approvalId.')
  }
}
