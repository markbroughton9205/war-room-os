export const SIGNUP_INVITATIONS_TABLE = 'signup_invitations'

export type SignupInvitationStatus =
  | 'pending'
  | 'claimed'
  | 'account_created'
  | 'confirmed'
  | 'expired'
  | 'revoked'

export type SignupInvitation = {
  invitation_id: string
  normalized_email: string
  token_hash: string
  status: SignupInvitationStatus
  created_by_user_id: string
  created_at: string
  expires_at: string
  claimed_at: string | null
  claim_nonce: string | null
  account_created_at: string | null
  confirmed_at: string | null
  claimed_by_auth_user_id: string | null
  revoked_at: string | null
  revoked_reason: string | null
}

export type CreateSignupInvitationInput = {
  email: string
  createdByUserId: string
  ttlHours?: number
  now?: string
}

export type CreateSignupInvitationResult =
  | {
      ok: true
      invitation: SignupInvitation
      rawToken: string
      inviteUrl: string
    }
  | {
      ok: false
      reason: 'invalid_email' | 'missing_secret' | 'write_failed'
      message: string
    }

export type ClaimSignupInvitationResult =
  | {
      ok: true
      status: 'claimed'
      invitation: SignupInvitation
      tokenHash: string
      claimNonce: string
    }
  | {
      ok: false
      reason:
        | 'invalid_or_expired'
        | 'not_found'
        | 'expired'
        | 'already_claimed'
        | 'revoked'
        | 'email_mismatch'
        | 'missing_secret'
        | 'write_failed'
      message: string
    }

export type AccountCreatedResult =
  | {
      ok: true
      invitation: SignupInvitation
    }
  | {
      ok: false
      reason: 'not_claimed' | 'write_failed'
      message: string
    }

export type ReleaseClaimResult =
  | {
      ok: true
      invitation: SignupInvitation | null
    }
  | {
      ok: false
      reason: 'write_failed'
      message: string
    }

export type ConfirmSignupInvitationResult =
  | {
      ok: true
      status: 'confirmed' | 'already_confirmed'
      invitation: SignupInvitation
    }
  | {
      ok: false
      status: 'no_matching_invitation' | 'write_failed'
      message: string
    }

export type SignupInvitationError = {
  code?: string
  message?: string
  details?: string
}

export type SignupInvitationAuthOutcome =
  | 'created'
  | 'temporary_failure'
  | 'rate_limited'
  | 'smtp_failure'
  | 'existing_unconfirmed_user'
  | 'existing_confirmed_user'
