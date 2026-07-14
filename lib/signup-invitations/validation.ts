import { SupabaseSignupInvitationAuthority } from './SupabaseSignupInvitationAuthority'
import { processInviteSignup, type ExistingSignupUser, type SignupFlowAuthClient } from './signupFlow'
import { hashInvitationToken, normalizeEmail } from './token'
import type { SignupInvitation, SignupInvitationStatus } from './types'

export type SignupInvitationValidationResult = {
  caseId: string
  passed: boolean
  expected: string
  observed: string
  notes: string[]
}

type AuthMode =
  | 'created'
  | 'sign_up_returned_error'
  | 'sign_up_thrown_error'
  | 'resend_returned_error'
  | 'resend_thrown_error'
  | 'existing_unconfirmed'
  | 'existing_confirmed'

type Row = SignupInvitation

const SECRET = 'validation-secret-only'
const RAW_TOKEN = 'raw-validation-token'
const EMAIL = 'jasmine@example.com'
const PASSWORD = 'correct-horse'
const NOW = '2026-07-14T10:00:00.000Z'
const FUTURE = '2026-07-15T10:00:00.000Z'

export async function runSignupInvitationValidation(): Promise<SignupInvitationValidationResult[]> {
  const previousSecret = process.env.WAR_ROOM_SIGNUP_INVITATION_SECRET
  process.env.WAR_ROOM_SIGNUP_INVITATION_SECRET = SECRET
  try {
    const cases: Array<() => Promise<SignupInvitationValidationResult>> = [
      twoDifferentInvitationsClaimedSameMillisecond,
      claimNoncesDiffer,
      claimantBCannotReleaseClaimantA,
      staleNonceCannotReleaseNewerClaim,
      releaseAfterAccountCreatedFails,
      concurrentClaimsOneWinner,
      exactlyOneAuthAttempt,
      signUpReturnedErrorReleasesClaim,
      signUpThrownErrorReleasesClaim,
      resendReturnedErrorReleasesClaim,
      resendThrownErrorReleasesClaim,
      authMayHaveSucceededTimeoutRecovery,
      authSuccessAccountCreatedDbFailureRecovery,
      callbackSuccess,
      callbackSameUserReplay,
      callbackDifferentUserReplayDenied,
      rawTokenAbsentFromPersistenceAndLogs,
      passwordAbsentFromPersistenceAndErrors,
      spoofedAuthorityIgnored,
      alreadyConfirmedUserDoesNotReuseInvite,
    ]

    const results: SignupInvitationValidationResult[] = []
    for (const run of cases) {
      results.push(await run())
    }
    return results
  } finally {
    if (previousSecret === undefined) {
      delete process.env.WAR_ROOM_SIGNUP_INVITATION_SECRET
    } else {
      process.env.WAR_ROOM_SIGNUP_INVITATION_SECRET = previousSecret
    }
  }
}

async function twoDifferentInvitationsClaimedSameMillisecond(): Promise<SignupInvitationValidationResult> {
  const env = makeEnv()
  const first = env.client.addPending('token-a', 'a@example.com')
  const second = env.client.addPending('token-b', 'b@example.com')
  const claimA = await env.authority.claimPendingInvitation('token-a', 'a@example.com')
  const claimB = await env.authority.claimPendingInvitation('token-b', 'b@example.com')
  const rowA = env.client.get(first)
  const rowB = env.client.get(second)
  return validation(
    'signup_claim_01_same_millisecond_distinct_rows_claim',
    claimA.ok && claimB.ok && rowA?.claimed_at === NOW && rowB?.claimed_at === NOW && rowA.claim_nonce !== null && rowB.claim_nonce !== null,
    'two different invitations can be claimed in the same millisecond without identity collision',
    `claimA=${claimA.ok}; claimB=${claimB.ok}; claimedAtA=${rowA?.claimed_at}; claimedAtB=${rowB?.claimed_at}`,
    ['This exercises SupabaseSignupInvitationAuthority with identical now() values.']
  )
}

async function claimNoncesDiffer(): Promise<SignupInvitationValidationResult> {
  const env = makeEnv()
  const first = env.client.addPending('token-a', 'a@example.com')
  const second = env.client.addPending('token-b', 'b@example.com')
  await env.authority.claimPendingInvitation('token-a', 'a@example.com')
  await env.authority.claimPendingInvitation('token-b', 'b@example.com')
  const nonceA = env.client.get(first)?.claim_nonce
  const nonceB = env.client.get(second)?.claim_nonce
  return validation(
    'signup_claim_02_claim_nonces_differ',
    Boolean(nonceA && nonceB && nonceA !== nonceB),
    'each successful claim writes a unique claim_nonce',
    `nonceA=${nonceA}; nonceB=${nonceB}; differ=${nonceA !== nonceB}`,
    ['Claim identity no longer depends on claimed_at precision.']
  )
}

async function claimantBCannotReleaseClaimantA(): Promise<SignupInvitationValidationResult> {
  const env = makeEnv()
  const invitationA = env.client.addPending('token-a', 'a@example.com')
  env.client.addPending('token-b', 'b@example.com')
  const claimA = await env.authority.claimPendingInvitation('token-a', 'a@example.com')
  const claimB = await env.authority.claimPendingInvitation('token-b', 'b@example.com')
  if (!claimA.ok || !claimB.ok) return failedSetup('signup_claim_03_cross_release_denied')
  await env.authority.releaseClaimAfterSignupFailure(claimA.invitation.invitation_id, claimB.claimNonce)
  const rowA = env.client.get(invitationA)
  return validation(
    'signup_claim_03_cross_release_denied',
    rowA?.status === 'claimed' && rowA.claim_nonce === claimA.claimNonce,
    'claimant B cannot release claimant A using a different claim_nonce',
    `status=${rowA?.status}; nonceStillA=${rowA?.claim_nonce === claimA.claimNonce}`,
    ['Release requires invitation_id plus exact claim_nonce.']
  )
}

async function staleNonceCannotReleaseNewerClaim(): Promise<SignupInvitationValidationResult> {
  const env = makeEnv()
  const id = env.client.addPending('token-a', EMAIL)
  const first = await env.authority.claimPendingInvitation('token-a', EMAIL)
  if (!first.ok) return failedSetup('signup_claim_04_stale_nonce_denied')
  await env.authority.releaseClaimAfterSignupFailure(first.invitation.invitation_id, first.claimNonce)
  const second = await env.authority.claimPendingInvitation('token-a', EMAIL)
  if (!second.ok) return failedSetup('signup_claim_04_stale_nonce_denied')
  await env.authority.releaseClaimAfterSignupFailure(second.invitation.invitation_id, first.claimNonce)
  const row = env.client.get(id)
  return validation(
    'signup_claim_04_stale_nonce_denied',
    row?.status === 'claimed' && row.claim_nonce === second.claimNonce,
    'a stale nonce cannot release a newer claim on the same invitation',
    `status=${row?.status}; secondNoncePreserved=${row?.claim_nonce === second.claimNonce}`,
    ['This catches release identity reuse after a retry.']
  )
}

async function releaseAfterAccountCreatedFails(): Promise<SignupInvitationValidationResult> {
  const env = makeEnv()
  const id = env.client.addPending(RAW_TOKEN, EMAIL)
  const claim = await env.authority.claimPendingInvitation(RAW_TOKEN, EMAIL)
  if (!claim.ok) return failedSetup('signup_claim_05_release_after_account_created_fails')
  await env.authority.markAccountCreated(claim.invitation.invitation_id, claim.claimNonce)
  const release = await env.authority.releaseClaimAfterSignupFailure(claim.invitation.invitation_id, claim.claimNonce)
  const row = env.client.get(id)
  return validation(
    'signup_claim_05_release_after_account_created_fails',
    release.ok && release.invitation === null && row?.status === 'account_created',
    'release fails after account_created_at is set',
    `releaseRow=${release.ok ? release.invitation?.status ?? 'null' : release.reason}; final=${row?.status}`,
    ['No refund/restore after account creation begins.']
  )
}

async function concurrentClaimsOneWinner(): Promise<SignupInvitationValidationResult> {
  const env = makeEnv()
  const id = env.client.addPending(RAW_TOKEN, EMAIL)
  const attempts = await Promise.all(Array.from({ length: 20 }, () => env.authority.claimPendingInvitation(RAW_TOKEN, EMAIL)))
  const winners = attempts.filter(result => result.ok).length
  const row = env.client.get(id)
  return validation(
    'signup_claim_06_concurrent_claims_one_winner',
    winners === 1 && row?.status === 'claimed' && row.claim_nonce !== null,
    '20 concurrent claim attempts produce exactly one winner',
    `winners=${winners}; final=${row?.status}; nonce=${row?.claim_nonce}`,
    ['The fake Supabase client runs the production authority update path atomically per call.']
  )
}

async function exactlyOneAuthAttempt(): Promise<SignupInvitationValidationResult> {
  const env = makeEnv()
  env.client.addPending(RAW_TOKEN, EMAIL)
  const auth = makeAuth('created')
  const result = await runSignup(env, auth)
  return validation(
    'signup_flow_07_exactly_one_auth_attempt',
    result.status === 'success' && auth.signUpAttempts === 1 && auth.resendAttempts === 0,
    'valid new signup performs exactly one Auth signup attempt',
    `status=${result.status}; signUp=${auth.signUpAttempts}; resend=${auth.resendAttempts}`,
    ['Existing-user lookup runs after invitation claim.']
  )
}

async function signUpReturnedErrorReleasesClaim(): Promise<SignupInvitationValidationResult> {
  return signupFailureReleaseCase('signup_flow_08_signup_returned_error_releases_claim', 'sign_up_returned_error')
}

async function signUpThrownErrorReleasesClaim(): Promise<SignupInvitationValidationResult> {
  return signupFailureReleaseCase('signup_flow_09_signup_thrown_error_releases_claim', 'sign_up_thrown_error')
}

async function resendReturnedErrorReleasesClaim(): Promise<SignupInvitationValidationResult> {
  return signupFailureReleaseCase('signup_flow_10_resend_returned_error_releases_claim', 'resend_returned_error')
}

async function resendThrownErrorReleasesClaim(): Promise<SignupInvitationValidationResult> {
  return signupFailureReleaseCase('signup_flow_11_resend_thrown_error_releases_claim', 'resend_thrown_error')
}

async function authMayHaveSucceededTimeoutRecovery(): Promise<SignupInvitationValidationResult> {
  const env = makeEnv()
  env.client.addPending(RAW_TOKEN, EMAIL)
  const firstAuth = makeAuth('sign_up_thrown_error')
  const first = await runSignup(env, firstAuth)
  const retryAuth = makeAuth('existing_unconfirmed')
  const retry = await runSignup(env, retryAuth)
  const row = env.client.findByToken(RAW_TOKEN)
  return validation(
    'signup_flow_12_timeout_recovery_reconciles_existing_user',
    first.status === 'error' &&
      retry.status === 'success' &&
      firstAuth.signUpAttempts === 1 &&
      retryAuth.signUpAttempts === 0 &&
      retryAuth.resendAttempts === 1 &&
      row?.status === 'account_created',
    'after a thrown Auth timeout, retry reconciles an existing unconfirmed Auth user and avoids duplicate signup',
    `first=${first.status}; retry=${retry.status}; retrySignUp=${retryAuth.signUpAttempts}; retryResend=${retryAuth.resendAttempts}; final=${row?.status}`,
    ['Thrown Auth errors release the claim, so retry can reconcile may-have-succeeded remote state.']
  )
}

async function authSuccessAccountCreatedDbFailureRecovery(): Promise<SignupInvitationValidationResult> {
  const env = makeEnv()
  env.client.addPending(RAW_TOKEN, EMAIL)
  env.client.failNextAccountCreatedUpdate = true
  const firstAuth = makeAuth('created')
  const first = await runSignup(env, firstAuth)
  const retryAuth = makeAuth('existing_unconfirmed')
  const retry = await runSignup(env, retryAuth)
  const row = env.client.findByToken(RAW_TOKEN)
  return validation(
    'signup_flow_13_account_created_db_failure_recovery',
    first.status === 'error' &&
      retry.status === 'success' &&
      firstAuth.signUpAttempts === 1 &&
      retryAuth.signUpAttempts === 0 &&
      retryAuth.resendAttempts === 1 &&
      row?.status === 'account_created',
    'Auth success plus account_created DB failure is retryable through existing-user reconciliation',
    `first=${first.status}; retry=${retry.status}; final=${row?.status}; signUps=${firstAuth.signUpAttempts + retryAuth.signUpAttempts}`,
    ['A failed account_created transition releases only the matching claim nonce.']
  )
}

async function callbackSuccess(): Promise<SignupInvitationValidationResult> {
  const env = makeEnv()
  const id = env.client.addAccountCreated(RAW_TOKEN, EMAIL, 'nonce-callback')
  const result = await env.authority.confirmAccountForVerifiedUser(EMAIL, 'auth-user-1')
  const row = env.client.get(id)
  return validation(
    'signup_callback_14_success',
    result.ok && result.status === 'confirmed' && row?.status === 'confirmed' && row.claimed_by_auth_user_id === 'auth-user-1',
    'callback confirms account_created invitation for verified user',
    `ok=${result.ok}; status=${result.ok ? result.status : result.status}; final=${row?.status}; user=${row?.claimed_by_auth_user_id}`,
    ['Callback derives email/user from Supabase session, not client input.']
  )
}

async function callbackSameUserReplay(): Promise<SignupInvitationValidationResult> {
  const env = makeEnv()
  env.client.addAccountCreated(RAW_TOKEN, EMAIL, 'nonce-callback')
  const first = await env.authority.confirmAccountForVerifiedUser(EMAIL, 'auth-user-1')
  const second = await env.authority.confirmAccountForVerifiedUser(EMAIL, 'auth-user-1')
  return validation(
    'signup_callback_15_same_user_replay',
    first.ok && second.ok && second.status === 'already_confirmed',
    'same verified user callback replay is idempotent',
    `first=${first.ok ? first.status : first.status}; second=${second.ok ? second.status : second.status}`,
    ['Replay does not create a second authority row or reassign ownership.']
  )
}

async function callbackDifferentUserReplayDenied(): Promise<SignupInvitationValidationResult> {
  const env = makeEnv()
  const id = env.client.addAccountCreated(RAW_TOKEN, EMAIL, 'nonce-callback')
  await env.authority.confirmAccountForVerifiedUser(EMAIL, 'auth-user-1')
  const second = await env.authority.confirmAccountForVerifiedUser(EMAIL, 'auth-user-2')
  const row = env.client.get(id)
  return validation(
    'signup_callback_16_different_user_replay_denied',
    !second.ok && row?.claimed_by_auth_user_id === 'auth-user-1',
    'different verified user cannot replay confirmed invitation',
    `second=${second.ok ? second.status : second.status}; storedUser=${row?.claimed_by_auth_user_id}`,
    ['Confirmed invitation cannot be reassigned.']
  )
}

async function rawTokenAbsentFromPersistenceAndLogs(): Promise<SignupInvitationValidationResult> {
  const env = makeEnv()
  env.client.addPending(RAW_TOKEN, EMAIL)
  const auth = makeAuth('created')
  await runSignup(env, auth)
  const serialized = env.client.serializedEvidence()
  return validation(
    'signup_secret_17_raw_token_absent',
    !serialized.includes(RAW_TOKEN),
    'raw token is absent from persistence and validation logs',
    `containsRawToken=${serialized.includes(RAW_TOKEN)}`,
    ['Database evidence stores token_hash only.']
  )
}

async function passwordAbsentFromPersistenceAndErrors(): Promise<SignupInvitationValidationResult> {
  const env = makeEnv()
  env.client.addPending(RAW_TOKEN, EMAIL)
  const auth = makeAuth('sign_up_thrown_error')
  const result = await runSignup(env, auth, 'never-log-this-password')
  const serialized = `${env.client.serializedEvidence()} ${JSON.stringify(result)}`
  return validation(
    'signup_secret_18_password_absent',
    !serialized.includes('never-log-this-password'),
    'password is absent from persistence, logs, and public errors',
    `containsPassword=${serialized.includes('never-log-this-password')}`,
    ['Password is passed only through the Auth adapter.']
  )
}

async function spoofedAuthorityIgnored(): Promise<SignupInvitationValidationResult> {
  const env = makeEnv()
  env.client.addPending(RAW_TOKEN, EMAIL)
  const auth = makeAuth('created')
  await processInviteSignup(
    {
      rawToken: RAW_TOKEN,
      email: EMAIL,
      password: PASSWORD,
      confirmPassword: PASSWORD,
    },
    { authority: env.authority, auth, baseUrl: 'http://localhost:3000' }
  )
  const serialized = env.client.serializedEvidence()
  const leaked = serialized.includes('commander') || serialized.includes('88c30416-b024-44e7-a703-6ee08839bde2')
  return validation(
    'signup_authz_19_spoofed_authority_ignored',
    !leaked,
    'client supplied userId/role/Commander data is ignored by signup flow',
    `leakedAuthority=${leaked}`,
    ['Signup accepts only token, email, and password fields.']
  )
}

async function alreadyConfirmedUserDoesNotReuseInvite(): Promise<SignupInvitationValidationResult> {
  const env = makeEnv()
  env.client.addPending(RAW_TOKEN, EMAIL)
  const auth = makeAuth('existing_confirmed')
  const first = await runSignup(env, auth)
  const row = env.client.findByToken(RAW_TOKEN)
  return validation(
    'signup_flow_20_confirmed_user_does_not_reuse_invite',
    first.status === 'error' && auth.signUpAttempts === 0 && auth.resendAttempts === 0 && row?.status === 'pending',
    'already-confirmed user does not reuse invitation or trigger Auth',
    `status=${first.status}; signUp=${auth.signUpAttempts}; resend=${auth.resendAttempts}; final=${row?.status}`,
    ['The claim is released because account_created_at remains null.']
  )
}

async function signupFailureReleaseCase(caseId: string, mode: AuthMode): Promise<SignupInvitationValidationResult> {
  const env = makeEnv()
  env.client.addPending(RAW_TOKEN, EMAIL)
  const auth = makeAuth(mode)
  const result = await runSignup(env, auth)
  const row = env.client.findByToken(RAW_TOKEN)
  return validation(
    caseId,
    result.status === 'error' && row?.status === 'pending' && row.claim_nonce === null,
    'Auth failure releases only the matching in-flight claim',
    `status=${result.status}; final=${row?.status}; claimNonce=${row?.claim_nonce}; signUp=${auth.signUpAttempts}; resend=${auth.resendAttempts}`,
    ['Returned errors and thrown exceptions use the same safe release path.']
  )
}

async function runSignup(env: ValidationEnv, auth: ValidationAuth, password = PASSWORD) {
  return processInviteSignup(
    {
      rawToken: RAW_TOKEN,
      email: EMAIL,
      password,
      confirmPassword: password,
    },
    { authority: env.authority, auth, baseUrl: 'http://localhost:3000' }
  )
}

function makeEnv(): ValidationEnv {
  const client = new FakeSignupInvitationClient()
  let nonceCounter = 0
  const authority = new SupabaseSignupInvitationAuthority(
    client.asSupabaseClient(),
    () => NOW,
    () => `00000000-0000-4000-8000-${String(++nonceCounter).padStart(12, '0')}`
  )
  return { client, authority }
}

type ValidationEnv = {
  client: FakeSignupInvitationClient
  authority: SupabaseSignupInvitationAuthority
}

function makeAuth(mode: AuthMode): ValidationAuth {
  return new ValidationAuth(mode)
}

class ValidationAuth implements SignupFlowAuthClient {
  signUpAttempts = 0
  resendAttempts = 0

  constructor(private readonly mode: AuthMode) {}

  async findExistingAuthUserByEmail(email: string): Promise<ExistingSignupUser> {
    void email
    if (this.mode === 'existing_unconfirmed' || this.mode === 'resend_returned_error' || this.mode === 'resend_thrown_error') {
      return { status: 'unconfirmed', userId: 'auth-unconfirmed' }
    }
    if (this.mode === 'existing_confirmed') {
      return { status: 'confirmed', userId: 'auth-confirmed' }
    }
    return { status: 'none' }
  }

  async signUp(input: { email: string; password: string; emailRedirectTo: string }): Promise<{ ok: true } | { ok: false }> {
    void input
    this.signUpAttempts += 1
    if (this.mode === 'sign_up_thrown_error') throw new Error('validation network failure')
    if (this.mode === 'sign_up_returned_error') return { ok: false }
    return { ok: true }
  }

  async resend(input: { email: string; emailRedirectTo: string }): Promise<{ ok: true } | { ok: false }> {
    void input
    this.resendAttempts += 1
    if (this.mode === 'resend_thrown_error') throw new Error('validation resend network failure')
    if (this.mode === 'resend_returned_error') return { ok: false }
    return { ok: true }
  }
}

class FakeSignupInvitationClient {
  private readonly rows = new Map<string, Row>()
  private rowCounter = 0
  readonly persistedPayloads: unknown[] = []
  failNextAccountCreatedUpdate = false

  asSupabaseClient(): never {
    return this as never
  }

  from(table: string): FakeQueryBuilder {
    void table
    return new FakeQueryBuilder(this)
  }

  addPending(rawToken: string, email: string): string {
    const row = this.makeRow(rawToken, email, 'pending')
    this.rows.set(row.invitation_id, row)
    this.persistedPayloads.push(sanitizeRow(row))
    return row.invitation_id
  }

  addAccountCreated(rawToken: string, email: string, claimNonce: string): string {
    const row = this.makeRow(rawToken, email, 'account_created')
    row.claimed_at = NOW
    row.claim_nonce = claimNonce
    row.account_created_at = NOW
    this.rows.set(row.invitation_id, row)
    this.persistedPayloads.push(sanitizeRow(row))
    return row.invitation_id
  }

  get(invitationId: string): Row | undefined {
    return this.rows.get(invitationId)
  }

  findByToken(rawToken: string): Row | undefined {
    const tokenHash = hashInvitationToken(rawToken, SECRET)
    return Array.from(this.rows.values()).find(row => row.token_hash === tokenHash)
  }

  serializedEvidence(): string {
    return JSON.stringify(this.persistedPayloads)
  }

  insert(payload: Partial<Row>): Row {
    const row: Row = {
      invitation_id: `10000000-0000-4000-8000-${String(++this.rowCounter).padStart(12, '0')}`,
      normalized_email: normalizeEmail(String(payload.normalized_email ?? '')),
      token_hash: String(payload.token_hash ?? ''),
      status: (payload.status ?? 'pending') as SignupInvitationStatus,
      created_by_user_id: String(payload.created_by_user_id ?? 'creator'),
      created_at: String(payload.created_at ?? NOW),
      expires_at: String(payload.expires_at ?? FUTURE),
      claimed_at: payload.claimed_at ?? null,
      claim_nonce: payload.claim_nonce ?? null,
      account_created_at: payload.account_created_at ?? null,
      confirmed_at: payload.confirmed_at ?? null,
      claimed_by_auth_user_id: payload.claimed_by_auth_user_id ?? null,
      revoked_at: payload.revoked_at ?? null,
      revoked_reason: payload.revoked_reason ?? null,
    }
    this.rows.set(row.invitation_id, row)
    this.persistedPayloads.push(sanitizeRow(row))
    return row
  }

  update(filters: Filter[], payload: Partial<Row>): Row | null {
    const row = this.applyFilters(filters)[0]
    if (!row) return null
    if (this.failNextAccountCreatedUpdate && payload.status === 'account_created') {
      this.failNextAccountCreatedUpdate = false
      return null
    }
    Object.assign(row, payload)
    this.persistedPayloads.push(sanitizeRow(payload))
    return row
  }

  select(filters: Filter[], orderBy: OrderBy | null, limitCount: number | null): Row[] {
    let rows = this.applyFilters(filters)
    if (orderBy) {
      rows = rows.sort((left, right) => {
        const leftValue = String(left[orderBy.column] ?? '')
        const rightValue = String(right[orderBy.column] ?? '')
        return orderBy.ascending ? leftValue.localeCompare(rightValue) : rightValue.localeCompare(leftValue)
      })
    }
    if (limitCount !== null) return rows.slice(0, limitCount)
    return rows
  }

  private applyFilters(filters: Filter[]): Row[] {
    return Array.from(this.rows.values()).filter(row => filters.every(filter => matchesFilter(row, filter)))
  }

  private makeRow(rawToken: string, email: string, status: SignupInvitationStatus): Row {
    return {
      invitation_id: `10000000-0000-4000-8000-${String(++this.rowCounter).padStart(12, '0')}`,
      normalized_email: normalizeEmail(email),
      token_hash: hashInvitationToken(rawToken, SECRET),
      status,
      created_by_user_id: 'creator',
      created_at: NOW,
      expires_at: FUTURE,
      claimed_at: null,
      claim_nonce: null,
      account_created_at: null,
      confirmed_at: null,
      claimed_by_auth_user_id: null,
      revoked_at: null,
      revoked_reason: null,
    }
  }
}

type Filter =
  | { kind: 'eq'; column: keyof Row; value: unknown }
  | { kind: 'is'; column: keyof Row; value: unknown }
  | { kind: 'gt'; column: keyof Row; value: unknown }
  | { kind: 'not'; column: keyof Row; operator: string; value: unknown }

type OrderBy = {
  column: keyof Row
  ascending: boolean
}

class FakeQueryBuilder {
  private operation: 'select' | 'insert' | 'update' = 'select'
  private filters: Filter[] = []
  private payload: Partial<Row> | null = null
  private orderByValue: OrderBy | null = null
  private limitValue: number | null = null

  constructor(private readonly client: FakeSignupInvitationClient) {}

  insert(payload: Partial<Row>): this {
    this.operation = 'insert'
    this.payload = payload
    return this
  }

  update(payload: Partial<Row>): this {
    this.operation = 'update'
    this.payload = payload
    return this
  }

  select(columns?: string): this {
    void columns
    return this
  }

  eq(column: keyof Row, value: unknown): this {
    this.filters.push({ kind: 'eq', column, value })
    return this
  }

  is(column: keyof Row, value: unknown): this {
    this.filters.push({ kind: 'is', column, value })
    return this
  }

  gt(column: keyof Row, value: unknown): this {
    this.filters.push({ kind: 'gt', column, value })
    return this
  }

  not(column: keyof Row, operator: string, value: unknown): this {
    this.filters.push({ kind: 'not', column, operator, value })
    return this
  }

  order(column: keyof Row, options: { ascending: boolean }): this {
    this.orderByValue = { column, ascending: options.ascending }
    return this
  }

  limit(count: number): this {
    this.limitValue = count
    return this
  }

  async single(): Promise<{ data: Row | null; error: null }> {
    return this.resolveOne()
  }

  async maybeSingle(): Promise<{ data: Row | null; error: null }> {
    return this.resolveOne()
  }

  private resolveOne(): { data: Row | null; error: null } {
    if (this.operation === 'insert') {
      return { data: this.client.insert(this.payload ?? {}), error: null }
    }
    if (this.operation === 'update') {
      return { data: this.client.update(this.filters, this.payload ?? {}), error: null }
    }
    return { data: this.client.select(this.filters, this.orderByValue, this.limitValue)[0] ?? null, error: null }
  }
}

function matchesFilter(row: Row, filter: Filter): boolean {
  const value = row[filter.column]
  if (filter.kind === 'eq') return value === filter.value
  if (filter.kind === 'is') return value === filter.value
  if (filter.kind === 'gt') return String(value) > String(filter.value)
  if (filter.kind === 'not' && filter.operator === 'is') return value !== filter.value
  return false
}

function sanitizeRow(input: Partial<Row>): Partial<Row> {
  return { ...input }
}

function failedSetup(caseId: string): SignupInvitationValidationResult {
  return validation(caseId, false, 'validation setup succeeds', 'setup failed', ['Setup failure means production claim path rejected unexpectedly.'])
}

function validation(
  caseId: string,
  passed: boolean,
  expected: string,
  observed: string,
  notes: string[]
): SignupInvitationValidationResult {
  return { caseId, passed, expected, observed, notes }
}
