import 'server-only'

import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import {
  buildInviteUrl,
  generateRawInvitationToken,
  hashInvitationToken,
  isPlausibleEmail,
  normalizeEmail,
  readInvitationSecret,
} from './token'
import {
  SIGNUP_INVITATIONS_TABLE,
  type AccountCreatedResult,
  type ClaimSignupInvitationResult,
  type ConfirmSignupInvitationResult,
  type CreateSignupInvitationInput,
  type CreateSignupInvitationResult,
  type ReleaseClaimResult,
  type SignupInvitation,
  type SignupInvitationError,
} from './types'

type SignupInvitationClient = Pick<SupabaseClient, 'from'>
type ClaimFailureReason = Extract<ClaimSignupInvitationResult, { ok: false }>['reason']

const DEFAULT_INVITATION_TTL_HOURS = 48

const INVITATION_SELECT = [
  'invitation_id',
  'normalized_email',
  'token_hash',
  'status',
  'created_by_user_id',
  'created_at',
  'expires_at',
  'claimed_at',
  'claim_nonce',
  'account_created_at',
  'confirmed_at',
  'claimed_by_auth_user_id',
  'revoked_at',
  'revoked_reason',
].join(',')

export class SupabaseSignupInvitationAuthority {
  constructor(
    private readonly client: SignupInvitationClient,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly createClaimNonce: () => string = () => randomUUID(),
  ) {}

  async createInvitation(input: CreateSignupInvitationInput): Promise<CreateSignupInvitationResult> {
    const normalizedEmail = normalizeEmail(input.email)
    if (!isPlausibleEmail(normalizedEmail)) {
      return { ok: false, reason: 'invalid_email', message: 'Invitation email is invalid.' }
    }

    const secret = readInvitationSecret()
    if (!secret.ok) {
      return { ok: false, reason: 'missing_secret', message: 'Invitation token secret is not configured.' }
    }

    const now = input.now ?? this.now()
    const ttlHours = input.ttlHours ?? DEFAULT_INVITATION_TTL_HOURS
    const expiresAt = new Date(Date.parse(now) + ttlHours * 60 * 60 * 1000).toISOString()
    const rawToken = generateRawInvitationToken()
    const tokenHash = hashInvitationToken(rawToken, secret.secret)

    const { data, error } = await this.client
      .from(SIGNUP_INVITATIONS_TABLE)
      .insert({
        normalized_email: normalizedEmail,
        token_hash: tokenHash,
        status: 'pending',
        created_by_user_id: input.createdByUserId,
        created_at: now,
        expires_at: expiresAt,
      })
      .select(INVITATION_SELECT)
      .single()

    if (error) return writeFailed(error)
    return {
      ok: true,
      invitation: toInvitation(data),
      rawToken,
      inviteUrl: buildInviteUrl(rawToken),
    }
  }

  async claimPendingInvitation(rawToken: string, submittedEmail: string): Promise<ClaimSignupInvitationResult> {
    const secret = readInvitationSecret()
    if (!secret.ok) {
      return { ok: false, reason: 'missing_secret', message: 'Invitation token secret is not configured.' }
    }

    const normalizedEmail = normalizeEmail(submittedEmail)
    if (!rawToken.trim() || !isPlausibleEmail(normalizedEmail)) {
      return invalidOrExpired()
    }

    const now = this.now()
    const claimNonce = this.createClaimNonce()
    const tokenHash = hashInvitationToken(rawToken, secret.secret)
    const { data, error } = await this.client
      .from(SIGNUP_INVITATIONS_TABLE)
      .update({
        status: 'claimed',
        claimed_at: now,
        claim_nonce: claimNonce,
      })
      .eq('token_hash', tokenHash)
      .eq('normalized_email', normalizedEmail)
      .eq('status', 'pending')
      .is('claimed_at', null)
      .gt('expires_at', now)
      .select(INVITATION_SELECT)
      .maybeSingle()

    if (error) return { ok: false, reason: 'write_failed', message: safeError(error) }
    if (!data) return this.classifyFailedClaim(tokenHash, normalizedEmail, now)
    const invitation = toInvitation(data)
    if (invitation.claim_nonce !== claimNonce) {
      return { ok: false, reason: 'write_failed', message: 'Invitation claim nonce was not recorded.' }
    }
    return { ok: true, status: 'claimed', invitation, tokenHash, claimNonce }
  }

  async markAccountCreated(invitationId: string, claimNonce: string): Promise<AccountCreatedResult> {
    const now = this.now()
    const { data, error } = await this.client
      .from(SIGNUP_INVITATIONS_TABLE)
      .update({
        status: 'account_created',
        account_created_at: now,
      })
      .eq('invitation_id', invitationId)
      .eq('status', 'claimed')
      .eq('claim_nonce', claimNonce)
      .select(INVITATION_SELECT)
      .maybeSingle()

    if (error) return { ok: false, reason: 'write_failed', message: safeError(error) }
    if (!data) return { ok: false, reason: 'not_claimed', message: 'Invitation is not in claimed state.' }
    return { ok: true, invitation: toInvitation(data) }
  }

  async releaseClaimAfterSignupFailure(invitationId: string, claimNonce: string): Promise<ReleaseClaimResult> {
    const { data, error } = await this.client
      .from(SIGNUP_INVITATIONS_TABLE)
      .update({
        status: 'pending',
        claimed_at: null,
        claim_nonce: null,
      })
      .eq('invitation_id', invitationId)
      .eq('status', 'claimed')
      .is('account_created_at', null)
      .eq('claim_nonce', claimNonce)
      .select(INVITATION_SELECT)
      .maybeSingle()

    if (error) return { ok: false, reason: 'write_failed', message: safeError(error) }
    return { ok: true, invitation: data ? toInvitation(data) : null }
  }

  async confirmAccountForVerifiedUser(email: string, authUserId: string): Promise<ConfirmSignupInvitationResult> {
    const normalizedEmail = normalizeEmail(email)
    const now = this.now()
    const { data, error } = await this.client
      .from(SIGNUP_INVITATIONS_TABLE)
      .update({
        status: 'confirmed',
        confirmed_at: now,
        claimed_by_auth_user_id: authUserId,
      })
      .eq('normalized_email', normalizedEmail)
      .eq('status', 'account_created')
      .is('confirmed_at', null)
      .is('claimed_by_auth_user_id', null)
      .select(INVITATION_SELECT)
      .maybeSingle()

    if (error) return { ok: false, status: 'write_failed', message: safeError(error) }
    if (data) return { ok: true, status: 'confirmed', invitation: toInvitation(data) }

    const existing = await this.findLatestByEmail(normalizedEmail)
    if (existing?.status === 'confirmed' && existing.claimed_by_auth_user_id === authUserId) {
      return { ok: true, status: 'already_confirmed', invitation: existing }
    }

    return {
      ok: false,
      status: 'no_matching_invitation',
      message: 'No account-created invitation matched this verified user.',
    }
  }

  async findLatestByEmail(normalizedEmail: string): Promise<SignupInvitation | null> {
    const { data, error } = await this.client
      .from(SIGNUP_INVITATIONS_TABLE)
      .select(INVITATION_SELECT)
      .eq('normalized_email', normalizeEmail(normalizedEmail))
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw new Error(safeError(error))
    return data ? toInvitation(data) : null
  }

  private async classifyFailedClaim(tokenHash: string, normalizedEmail: string, now: string): Promise<ClaimSignupInvitationResult> {
    const existing = await this.findLatestByTokenHash(tokenHash)
    if (!existing) return invalidOrExpired('not_found')
    if (existing.normalized_email !== normalizedEmail) return invalidOrExpired('email_mismatch')
    if (existing.status === 'revoked') return invalidOrExpired('revoked')
    if (new Date(existing.expires_at).getTime() <= new Date(now).getTime()) return invalidOrExpired('expired')
    if (existing.status === 'claimed' || existing.status === 'account_created' || existing.status === 'confirmed') {
      return invalidOrExpired('already_claimed')
    }
    return invalidOrExpired()
  }

  private async findLatestByTokenHash(tokenHash: string): Promise<SignupInvitation | null> {
    const { data, error } = await this.client
      .from(SIGNUP_INVITATIONS_TABLE)
      .select(INVITATION_SELECT)
      .eq('token_hash', tokenHash)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw new Error(safeError(error))
    return data ? toInvitation(data) : null
  }
}

export function createSupabaseSignupInvitationAuthority(): SupabaseSignupInvitationAuthority {
  return new SupabaseSignupInvitationAuthority(createSupabaseAdminClient())
}

function invalidOrExpired(reason: ClaimFailureReason = 'invalid_or_expired'): ClaimSignupInvitationResult {
  return {
    ok: false,
    reason,
    message: 'This invitation is invalid or has expired.',
  }
}

function writeFailed(error: SignupInvitationError): CreateSignupInvitationResult {
  return { ok: false, reason: 'write_failed', message: safeError(error) }
}

function safeError(error: SignupInvitationError): string {
  return error.message ?? 'Invitation write failed.'
}

function toInvitation(row: unknown): SignupInvitation {
  return row as SignupInvitation
}
