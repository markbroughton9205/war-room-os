import { normalizeEmail, readBaseUrl } from './token'
import type {
  AccountCreatedResult,
  ClaimSignupInvitationResult,
  ReleaseClaimResult,
} from './types'

export type SignupFlowState = {
  status: 'idle' | 'error' | 'success'
  message: string | null
}

export type ExistingSignupUser =
  | { status: 'none' }
  | { status: 'unconfirmed'; userId: string }
  | { status: 'confirmed'; userId: string }
  | { status: 'lookup_unavailable' }

export type SignupFlowAuthority = {
  claimPendingInvitation(rawToken: string, submittedEmail: string): Promise<ClaimSignupInvitationResult>
  markAccountCreated(invitationId: string, claimNonce: string): Promise<AccountCreatedResult>
  releaseClaimAfterSignupFailure(invitationId: string, claimNonce: string): Promise<ReleaseClaimResult>
}

export type SignupFlowAuthClient = {
  findExistingAuthUserByEmail(email: string): Promise<ExistingSignupUser>
  signUp(input: { email: string; password: string; emailRedirectTo: string }): Promise<{ ok: true } | { ok: false }>
  resend(input: { email: string; emailRedirectTo: string }): Promise<{ ok: true } | { ok: false }>
}

export type SignupFlowInput = {
  rawToken: string
  email: string
  password: string
  confirmPassword: string
}

export type SignupFlowDeps = {
  authority: SignupFlowAuthority
  auth: SignupFlowAuthClient
  baseUrl?: string
}

export const GENERIC_INVITATION_REJECTION = 'This invitation is invalid or has expired.'
export const RETRYABLE_SIGNUP_FAILURE = 'Signup could not be completed. Please try again in a few minutes with the same invitation link.'
export const TRACKING_FAILURE = 'Signup started, but invitation tracking could not be completed. Please retry with the same invitation link.'

export async function processInviteSignup(input: SignupFlowInput, deps: SignupFlowDeps): Promise<SignupFlowState> {
  const rawToken = input.rawToken.trim()
  const email = normalizeEmail(input.email)
  const password = input.password
  const confirmPassword = input.confirmPassword

  if (!rawToken || !email || !password || !confirmPassword) {
    return { status: 'error', message: 'Invitation token, email, and password are required.' }
  }

  if (password !== confirmPassword) {
    return { status: 'error', message: 'Passwords do not match.' }
  }

  if (password.length < 8) {
    return { status: 'error', message: 'Password must be at least 8 characters.' }
  }

  const claim = await deps.authority.claimPendingInvitation(rawToken, email)
  if (!claim.ok) {
    return {
      status: 'error',
      message: claim.reason === 'missing_secret' || claim.reason === 'write_failed' ? 'Signup is temporarily unavailable.' : GENERIC_INVITATION_REJECTION,
    }
  }

  const signupEmail = claim.invitation.normalized_email
  const existingUser = await deps.auth.findExistingAuthUserByEmail(signupEmail)
  if (existingUser.status === 'confirmed') {
    await releaseClaimSafely(deps.authority, claim)
    return { status: 'error', message: GENERIC_INVITATION_REJECTION }
  }

  const emailRedirectTo = `${(deps.baseUrl ?? readBaseUrl()).replace(/\/+$/, '')}/auth/callback`

  if (existingUser.status === 'unconfirmed') {
    const resend = await callAuthOperation(() => deps.auth.resend({ email: signupEmail, emailRedirectTo }))
    if (!resend.ok) {
      await releaseClaimSafely(deps.authority, claim)
      return { status: 'error', message: RETRYABLE_SIGNUP_FAILURE }
    }
    return markCreatedOrRelease(deps.authority, claim)
  }

  const signup = await callAuthOperation(() => deps.auth.signUp({ email: signupEmail, password, emailRedirectTo }))
  if (!signup.ok) {
    await releaseClaimSafely(deps.authority, claim)
    return { status: 'error', message: RETRYABLE_SIGNUP_FAILURE }
  }

  return markCreatedOrRelease(deps.authority, claim)
}

async function markCreatedOrRelease(authority: SignupFlowAuthority, claim: Extract<ClaimSignupInvitationResult, { ok: true }>): Promise<SignupFlowState> {
  const accountCreated = await authority.markAccountCreated(claim.invitation.invitation_id, claim.claimNonce)
  if (!accountCreated.ok) {
    await releaseClaimSafely(authority, claim)
    return { status: 'error', message: TRACKING_FAILURE }
  }
  return { status: 'success', message: 'Check your email to confirm your account before logging in.' }
}

async function callAuthOperation(operation: () => Promise<{ ok: true } | { ok: false }>): Promise<{ ok: true } | { ok: false }> {
  try {
    return await operation()
  } catch {
    return { ok: false }
  }
}

async function releaseClaimSafely(authority: SignupFlowAuthority, claim: Extract<ClaimSignupInvitationResult, { ok: true }>): Promise<void> {
  try {
    await authority.releaseClaimAfterSignupFailure(claim.invitation.invitation_id, claim.claimNonce)
  } catch {
    // Release is best-effort after an Auth failure; the public response stays generic.
  }
}
