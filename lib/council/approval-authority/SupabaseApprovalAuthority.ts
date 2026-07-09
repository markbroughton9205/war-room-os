import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import {
  EXPLICIT_EXECUTION_APPROVALS_TABLE,
  type ConsumeApprovalResult,
  type ExplicitExecutionApproval,
  type IssueApprovalInput,
  type IssueApprovalResult,
  type RevokeApprovalResult,
} from './types'

type SupabaseApprovalClient = Pick<SupabaseClient, 'from'>

type SupabaseApprovalError = {
  code?: string
  message?: string
  details?: string
}

const DEFAULT_APPROVAL_TTL_MS = 5 * 60 * 1000

export class SupabaseApprovalAuthority {
  constructor(
    private readonly client: SupabaseApprovalClient,
    private readonly nonceGenerator: () => string = () => `nonce_${randomUUID()}`
  ) {}

  async issue(input: IssueApprovalInput): Promise<IssueApprovalResult> {
    const now = input.now ?? new Date().toISOString()
    const ttlMs = input.ttlMs ?? DEFAULT_APPROVAL_TTL_MS
    const expiresAt = new Date(Date.parse(now) + ttlMs).toISOString()

    const { data, error } = await this.client
      .from(EXPLICIT_EXECUTION_APPROVALS_TABLE)
      .insert({
        exact_approved_text: input.exact_approved_text,
        commander_input: input.commander_input,
        approved_by: input.approved_by,
        action_type: input.action_type,
        target_system: input.target_system,
        target_id: input.target_id,
        single_use: true,
        nonce: this.nonceGenerator(),
        created_at: now,
        updated_at: now,
        expires_at: expiresAt,
        status: 'active',
      })
      .select(selectColumns())
      .single()

    if (error) return issueError(error)
    return { ok: true, status: 'issued', approval: rowToApproval(data as unknown as ApprovalRow), errorMessage: null }
  }

  async consumeIfValid(
    approvalId: string,
    expectedActionType: string,
    expectedTargetSystem: string,
    expectedTargetId: string,
    expectedExactText: string
  ): Promise<ConsumeApprovalResult> {
    const now = new Date().toISOString()
    const { data, error } = await this.client
      .from(EXPLICIT_EXECUTION_APPROVALS_TABLE)
      .update({
        status: 'consumed',
        consumed_at: now,
        updated_at: now,
      })
      .eq('approval_id', approvalId)
      .eq('status', 'active')
      .gt('expires_at', now)
      .eq('action_type', expectedActionType)
      .eq('target_system', expectedTargetSystem)
      .eq('target_id', expectedTargetId)
      .eq('exact_approved_text', expectedExactText)
      .select(selectColumns())
      .maybeSingle()

    if (error) return consume(false, 'consume_failed', null, error.message ?? 'Approval consume failed.')
    if (data) return consume(true, 'consumed', rowToApproval(data as unknown as ApprovalRow), null)

    return this.classifyRejectedConsume(
      approvalId,
      expectedActionType,
      expectedTargetSystem,
      expectedTargetId,
      expectedExactText,
      now
    )
  }

  async revoke(approvalId: string, reason: string): Promise<RevokeApprovalResult> {
    const now = new Date().toISOString()
    const { data, error } = await this.client
      .from(EXPLICIT_EXECUTION_APPROVALS_TABLE)
      .update({
        status: 'revoked',
        revoked_at: now,
        revoked_reason: reason,
        updated_at: now,
      })
      .eq('approval_id', approvalId)
      .eq('status', 'active')
      .select(selectColumns())
      .maybeSingle()

    if (error) return { ok: false, status: 'revoke_failed', approval: null, errorMessage: error.message ?? 'Approval revoke failed.' }
    if (data) return { ok: true, status: 'revoked', approval: rowToApproval(data as unknown as ApprovalRow), errorMessage: null }

    const existing = await this.getById(approvalId)
    if (!existing) return { ok: false, status: 'not_found', approval: null, errorMessage: 'No approval found for this approvalId.' }
    if (existing.status === 'consumed' || existing.consumed_at) {
      return { ok: false, status: 'already_consumed', approval: existing, errorMessage: 'Approval has already been consumed.' }
    }
    if (existing.status === 'revoked') {
      return { ok: false, status: 'already_revoked', approval: existing, errorMessage: 'Approval has already been revoked.' }
    }
    return { ok: false, status: 'not_active', approval: existing, errorMessage: `Approval status is ${existing.status}.` }
  }

  async getById(approvalId: string): Promise<ExplicitExecutionApproval | null> {
    const { data, error } = await this.client
      .from(EXPLICIT_EXECUTION_APPROVALS_TABLE)
      .select(selectColumns())
      .eq('approval_id', approvalId)
      .maybeSingle()

    if (error) throw new Error(error.message)
    return data ? rowToApproval(data as unknown as ApprovalRow) : null
  }

  private async classifyRejectedConsume(
    approvalId: string,
    expectedActionType: string,
    expectedTargetSystem: string,
    expectedTargetId: string,
    expectedExactText: string,
    now: string
  ): Promise<ConsumeApprovalResult> {
    const existing = await this.getById(approvalId)
    if (!existing) return consume(false, 'not_found', null, 'No approval found for this approvalId.')
    if (existing.status === 'consumed' || existing.consumed_at) {
      return consume(false, 'already_consumed', existing, 'Approval has already been consumed.')
    }
    if (existing.status === 'revoked' || existing.revoked_at) {
      return consume(false, 'revoked', existing, 'Approval has been revoked.')
    }
    if (new Date(existing.expires_at).getTime() <= new Date(now).getTime()) {
      await this.markExpired(existing.approval_id, now)
      return consume(false, 'expired', existing, 'Approval has expired.')
    }
    if (existing.status !== 'active') {
      return consume(false, 'not_active', existing, `Approval status is ${existing.status}.`)
    }
    if (existing.action_type !== expectedActionType) {
      return consume(false, 'action_type_mismatch', existing, 'Approval action_type does not match.')
    }
    if (existing.target_system !== expectedTargetSystem) {
      return consume(false, 'target_system_mismatch', existing, 'Approval target_system does not match.')
    }
    if (existing.target_id !== expectedTargetId) {
      return consume(false, 'target_id_mismatch', existing, 'Approval target_id does not match.')
    }
    if (existing.exact_approved_text !== expectedExactText) {
      return consume(false, 'exact_text_mismatch', existing, 'Approval exact_approved_text does not match.')
    }
    return consume(false, 'not_active', existing, 'Approval did not satisfy the atomic consume predicate.')
  }

  private async markExpired(approvalId: string, now: string): Promise<void> {
    await this.client
      .from(EXPLICIT_EXECUTION_APPROVALS_TABLE)
      .update({ status: 'expired', updated_at: now })
      .eq('approval_id', approvalId)
      .eq('status', 'active')
  }
}

export function createSupabaseApprovalAuthority(): SupabaseApprovalAuthority {
  return new SupabaseApprovalAuthority(createSupabaseAdminClient())
}

type ApprovalRow = ExplicitExecutionApproval

function selectColumns(): string {
  return [
    'approval_id',
    'exact_approved_text',
    'commander_input',
    'approved_by',
    'action_type',
    'target_system',
    'target_id',
    'single_use',
    'nonce',
    'created_at',
    'updated_at',
    'expires_at',
    'consumed_at',
    'revoked_at',
    'revoked_reason',
    'status',
  ].join(',')
}

function rowToApproval(row: ApprovalRow): ExplicitExecutionApproval {
  return {
    approval_id: row.approval_id,
    exact_approved_text: row.exact_approved_text,
    commander_input: row.commander_input,
    approved_by: row.approved_by,
    action_type: row.action_type,
    target_system: row.target_system,
    target_id: row.target_id,
    single_use: row.single_use,
    nonce: row.nonce,
    created_at: row.created_at,
    updated_at: row.updated_at,
    expires_at: row.expires_at,
    consumed_at: row.consumed_at,
    revoked_at: row.revoked_at,
    revoked_reason: row.revoked_reason,
    status: row.status,
  }
}

function issueError(error: SupabaseApprovalError): IssueApprovalResult {
  if (error.code === '23505') {
    return { ok: false, status: 'duplicate_nonce', approval: null, errorMessage: error.message ?? 'Duplicate nonce.' }
  }
  return { ok: false, status: 'write_failed', approval: null, errorMessage: error.message ?? 'Approval write failed.' }
}

function consume(
  ok: boolean,
  status: ConsumeApprovalResult['status'],
  approval: ExplicitExecutionApproval | null,
  errorMessage: string | null
): ConsumeApprovalResult {
  return { ok, status, approval, errorMessage }
}
