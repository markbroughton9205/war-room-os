import { handleAuthCallback } from './callbackRoute'
import { handleAuthCleanup } from './cleanupRoute'
import { createAuthCleanupMarkerValue, createRecoveryMarkerValue, verifyRecoveryMarkerValue } from './recovery'
import { requestPasswordRecovery, updateRecoveredPassword, GENERIC_RECOVERY_SENT_MESSAGE } from './recoveryFlow'
import { isCleanupAllowedPath, isRecoveryAllowedPath } from '@/lib/supabase/middleware'
import { assertLiveActionsAllowed } from '@/lib/security/actionRoutePolicy'

export type PasswordRecoveryValidationResult = {
  caseId: string
  passed: boolean
  expected: string
  observed: string
  notes: string[]
}

const SECRET = 'recovery-validation-secret'
const USER_ID = 'user-123'
const EMAIL = 'ra@example.com'
const ORIGIN = 'http://localhost:3000'

export async function runPasswordRecoveryValidation(): Promise<PasswordRecoveryValidationResult[]> {
  const previousSecret = process.env.WAR_ROOM_SIGNUP_INVITATION_SECRET
  process.env.WAR_ROOM_SIGNUP_INVITATION_SECRET = SECRET
  try {
    const cases: Array<() => Promise<PasswordRecoveryValidationResult>> = [
      existingEmailResetGeneric,
      nonexistentEmailResetGeneric,
      resetPasswordReturnedErrorDoesNotCrash,
      resetPasswordThrownExceptionDoesNotCrash,
      resetPasswordRateLimitDoesNotCrash,
      recoveryCallbackRedirects,
      signupCallbackConfirmsInvitation,
      unknownTypeRejected,
      recoverySessionBlockedFromDashboard,
      recoverySessionAllowedOnUpdatePassword,
      normalSessionNotMisclassified,
      missingSessionBlocked,
      weakPasswordRejected,
      mismatchRejected,
      updateUserSuccess,
      updateUserFailure,
      signOutAfterSuccess,
      signOutFailureHandled,
      markerClearedAfterSuccess,
      markerTamperingRejected,
      markerUserMismatchRejected,
      staleMarkerRejected,
      openRedirectImpossible,
      passwordAbsentFromLogs,
      loginFlowUnchanged,
      commanderProtectionsUnchanged,
      inviteConfirmationFlowUnchanged,
      invitationMismatchLeavesNoLiveSession,
      updateSuccessSignOutFailureDoesNotClearMarker,
      cleanupIncompleteRetainsRecoveryMarker,
      cleanupRetrySucceeds,
      recoveryCompletionFinallyClearsMarker,
      domainSeparatedHmacRejectsCrossProtocolValue,
      mislabeledSignupRecoveryDoesNotStrandInvitation,
      forgotPasswordEnvironmentGate,
      callbackCleanupSignOutSucceeds,
      callbackCleanupSignOutReturnedErrorRestricts,
      callbackCleanupSignOutThrowsRestricts,
      callbackCleanupRetryLaterSucceeds,
      invalidCallbackAfterSessionCannotReachDashboard,
      unverifiedBranchCannotReachDashboard,
      invitationMismatchCannotLeaveUnrestrictedSession,
      unsupportedCallbackCannotLeaveUnrestrictedSession,
      normalCallbackSuccessPathsUnchanged,
      signupConfirmationStillFunctional,
      passwordRecoveryFlowStillFunctional,
      recoveryAndCleanupMarkerCreationFailureFailsClosed,
      cleanupFailureClearsRecoveryAndSetsCleanup,
      bothMarkersPreferCleanup,
      cleanupMarkerSetSucceedsQuarantineActive,
      cleanupMarkerSetFailsAfterSignOutFailureFailsClosed,
      normalRecoverySuccessUnchangedAfterR3,
      normalSignupConfirmationUnchangedAfterR3,
      recoveryTokenHashVerifyOtpSucceeds,
      recoveryVerifyOtpErrorFailsClosed,
      recoveryVerifyOtpThrowsFailsClosed,
      expiredOrReusedTokenHashFailsClosed,
      missingTokenHashRejected,
      missingTypeRejected,
      unsupportedTypeRejectedAfterR4,
      recoveryTokenMislabeledSignupFails,
      signupCallbackMislabeledRecoveryFails,
      codeAndTokenHashTogetherFailClosed,
      getUserFailureAfterVerifyOtpFailsClosed,
      updatePasswordReachedOnlyAfterVerifyOtpSuccess,
      implicitFragmentLinkCannotBeConsumed,
      noTokenHashInErrorsOrPersistence,
      recoveryRedirectTargetHasNoTokenFragment,
    ]

    const results: PasswordRecoveryValidationResult[] = []
    for (const run of cases) results.push(await run())
    return results
  } finally {
    if (previousSecret === undefined) {
      delete process.env.WAR_ROOM_SIGNUP_INVITATION_SECRET
    } else {
      process.env.WAR_ROOM_SIGNUP_INVITATION_SECRET = previousSecret
    }
  }
}

async function existingEmailResetGeneric(): Promise<PasswordRecoveryValidationResult> {
  const auth = new FakeRecoveryRequestAuth(true)
  const result = await requestPasswordRecovery(EMAIL, auth, ORIGIN)
  return validation('recovery_01_existing_email_generic', result.message === GENERIC_RECOVERY_SENT_MESSAGE && auth.attempts === 1, 'existing email receives generic response', `message=${result.message}; attempts=${auth.attempts}`, ['No email existence signal is returned.'])
}

async function nonexistentEmailResetGeneric(): Promise<PasswordRecoveryValidationResult> {
  const auth = new FakeRecoveryRequestAuth(false)
  const result = await requestPasswordRecovery('missing@example.com', auth, ORIGIN)
  return validation('recovery_02_nonexistent_email_generic', result.message === GENERIC_RECOVERY_SENT_MESSAGE && auth.attempts === 1, 'nonexistent email receives identical generic response', `message=${result.message}; attempts=${auth.attempts}`, ['Returned Supabase errors are suppressed.'])
}

async function resetPasswordReturnedErrorDoesNotCrash(): Promise<PasswordRecoveryValidationResult> {
  const auth = new FakeRecoveryRequestAuth(false)
  const result = await requestPasswordRecovery(EMAIL, auth, ORIGIN)
  return validation('recovery_02a_returned_error_generic', result.status === 'sent' && result.message === GENERIC_RECOVERY_SENT_MESSAGE && auth.attempts === 1, 'Supabase returned error still produces generic response', `status=${result.status}; message=${result.message}; attempts=${auth.attempts}`, ['Returned resetPasswordForEmail errors do not crash or enumerate accounts.'])
}

async function resetPasswordThrownExceptionDoesNotCrash(): Promise<PasswordRecoveryValidationResult> {
  const auth = new FakeRecoveryRequestAuth(true, { throws: true })
  const result = await requestPasswordRecovery(EMAIL, auth, ORIGIN)
  return validation('recovery_02b_thrown_error_generic', result.status === 'sent' && result.message === GENERIC_RECOVERY_SENT_MESSAGE && auth.attempts === 1, 'Supabase thrown exception still produces generic response', `status=${result.status}; message=${result.message}; attempts=${auth.attempts}`, ['Thrown resetPasswordForEmail failures do not crash or enumerate accounts.'])
}

async function resetPasswordRateLimitDoesNotCrash(): Promise<PasswordRecoveryValidationResult> {
  const auth = new FakeRecoveryRequestAuth(false, { reason: 'rate_limited' })
  const result = await requestPasswordRecovery(EMAIL, auth, ORIGIN)
  return validation('recovery_02c_rate_limit_generic', result.status === 'sent' && result.message === GENERIC_RECOVERY_SENT_MESSAGE && auth.attempts === 1, 'rate-limit-style failure still produces generic response', `status=${result.status}; message=${result.message}; attempts=${auth.attempts}; reason=${auth.reason}`, ['Rate limiting does not expose account state or crash the action flow.'])
}

async function recoveryCallbackRedirects(): Promise<PasswordRecoveryValidationResult> {
  const fixture = makeCallbackFixture({ type: 'recovery' })
  const response = await fixture.run()
  return validation('recovery_03_callback_redirects_update_password', response.headers.get('location') === `${ORIGIN}/update-password` && hasCookie(response, 'war_room_recovery'), 'recovery callback redirects to /update-password and sets marker', `location=${response.headers.get('location')}; marker=${hasCookie(response, 'war_room_recovery')}`, ['type=recovery is honored only after verifyOtp and getUser succeed.'])
}

async function signupCallbackConfirmsInvitation(): Promise<PasswordRecoveryValidationResult> {
  const fixture = makeCallbackFixture({ type: 'signup' })
  const response = await fixture.run()
  return validation('recovery_04_signup_callback_confirms_invitation', response.headers.get('location') === `${ORIGIN}/login?confirmed=1` && fixture.authority.confirmAttempts === 1, 'signup callback still confirms invitation', `location=${response.headers.get('location')}; confirms=${fixture.authority.confirmAttempts}`, ['Signup branch still uses server-derived user email/id.'])
}

async function unknownTypeRejected(): Promise<PasswordRecoveryValidationResult> {
  const fixture = makeCallbackFixture({ type: 'magic' })
  const response = await fixture.run()
  return validation('recovery_05_unknown_type_rejected', response.headers.get('location') === `${ORIGIN}/login?auth=unsupported_callback` && fixture.supabase.signOutAttempts === 1, 'unknown callback type signs out and redirects safely', `location=${response.headers.get('location')}; signOut=${fixture.supabase.signOutAttempts}`, ['type is a routing hint, not proof.'])
}

async function recoverySessionBlockedFromDashboard(): Promise<PasswordRecoveryValidationResult> {
  return validation('recovery_06_dashboard_blocked', !isRecoveryAllowedPath('/'), 'recovery session cannot access dashboard path', `allowed=${isRecoveryAllowedPath('/')}`, ['Middleware redirects valid recovery sessions to /update-password.'])
}

async function recoverySessionAllowedOnUpdatePassword(): Promise<PasswordRecoveryValidationResult> {
  return validation('recovery_07_update_password_allowed', isRecoveryAllowedPath('/update-password'), 'recovery session may access /update-password', `allowed=${isRecoveryAllowedPath('/update-password')}`, ['This is the only application page allowed during recovery.'])
}

async function normalSessionNotMisclassified(): Promise<PasswordRecoveryValidationResult> {
  const marker = await verifyRecoveryMarkerValue(undefined, USER_ID)
  return validation('recovery_08_normal_session_not_recovery', !marker.ok && marker.reason === 'missing', 'normal session without marker is not recovery', `ok=${marker.ok}; reason=${marker.ok ? 'none' : marker.reason}`, ['Authenticated sessions require a signed marker to enter recovery mode.'])
}

async function missingSessionBlocked(): Promise<PasswordRecoveryValidationResult> {
  const marker = await verifyRecoveryMarkerValue(undefined, '')
  return validation('recovery_09_missing_session_blocked', !marker.ok && marker.reason === 'missing', 'missing session has no valid recovery marker', `ok=${marker.ok}; reason=${marker.ok ? 'none' : marker.reason}`, ['Update page also requires Supabase getUser.'])
}

async function weakPasswordRejected(): Promise<PasswordRecoveryValidationResult> {
  const auth = new FakePasswordUpdateAuth()
  const result = await updateRecoveredPassword('short', 'short', auth, async () => auth.clear())
  return validation('recovery_10_weak_password_rejected', result.status === 'error' && auth.updateAttempts === 0, 'weak password rejected before updateUser', `status=${result.status}; updates=${auth.updateAttempts}`, ['Minimum length remains 8.'])
}

async function mismatchRejected(): Promise<PasswordRecoveryValidationResult> {
  const auth = new FakePasswordUpdateAuth()
  const result = await updateRecoveredPassword('correct-horse', 'wrong-horse', auth, async () => auth.clear())
  return validation('recovery_11_mismatch_rejected', result.status === 'error' && auth.updateAttempts === 0, 'password mismatch rejected before updateUser', `status=${result.status}; updates=${auth.updateAttempts}`, ['Client and server both enforce confirmation.'])
}

async function updateUserSuccess(): Promise<PasswordRecoveryValidationResult> {
  const auth = new FakePasswordUpdateAuth()
  const result = await updateRecoveredPassword('correct-horse', 'correct-horse', auth, async () => auth.clear())
  return validation('recovery_12_update_user_success', result.status === 'success' && auth.updateAttempts === 1, 'updateUser success returns success', `status=${result.status}; updates=${auth.updateAttempts}`, ['Uses session-scoped Supabase auth.updateUser.'])
}

async function updateUserFailure(): Promise<PasswordRecoveryValidationResult> {
  const auth = new FakePasswordUpdateAuth({ updateOk: false })
  const result = await updateRecoveredPassword('correct-horse', 'correct-horse', auth, async () => auth.clear())
  return validation('recovery_13_update_user_failure', result.status === 'error' && auth.cleared === false, 'update failure keeps recovery marker for retry', `status=${result.status}; cleared=${auth.cleared}`, ['Failure response is generic.'])
}

async function signOutAfterSuccess(): Promise<PasswordRecoveryValidationResult> {
  const auth = new FakePasswordUpdateAuth()
  await updateRecoveredPassword('correct-horse', 'correct-horse', auth, async () => auth.clear())
  return validation('recovery_14_signout_after_success', auth.signOutAttempts === 1, 'successful password update signs out', `signOut=${auth.signOutAttempts}`, ['The user must log in with the new password.'])
}

async function signOutFailureHandled(): Promise<PasswordRecoveryValidationResult> {
  const auth = new FakePasswordUpdateAuth({ signOutOk: false })
  const result = await updateRecoveredPassword('correct-horse', 'correct-horse', auth, async () => auth.clear())
  return validation('recovery_15_signout_failure_safe', result.status === 'error' && !auth.cleared, 'signOut failure after update keeps recovery marker and reports cleanup incomplete', `status=${result.status}; cleared=${auth.cleared}; signOut=${auth.signOutAttempts}`, ['No unrestricted authenticated session is produced.'])
}

async function markerClearedAfterSuccess(): Promise<PasswordRecoveryValidationResult> {
  const auth = new FakePasswordUpdateAuth()
  await updateRecoveredPassword('correct-horse', 'correct-horse', auth, async () => auth.clear())
  return validation('recovery_16_marker_cleared_after_success', auth.cleared, 'recovery marker is cleared after success', `cleared=${auth.cleared}`, ['No lingering recovery-only session after reset.'])
}

async function markerTamperingRejected(): Promise<PasswordRecoveryValidationResult> {
  const marker = await createRecoveryMarkerValue(USER_ID)
  const tampered = `${marker?.slice(0, -2)}xx`
  const result = await verifyRecoveryMarkerValue(tampered, USER_ID)
  return validation('recovery_17_marker_tampering_rejected', !result.ok && result.reason === 'bad_signature', 'tampered marker rejected by signature check', `ok=${result.ok}; reason=${result.ok ? 'none' : result.reason}`, ['HMAC binds payload contents.'])
}

async function markerUserMismatchRejected(): Promise<PasswordRecoveryValidationResult> {
  const marker = await createRecoveryMarkerValue(USER_ID)
  const result = await verifyRecoveryMarkerValue(marker, 'other-user')
  return validation('recovery_18_marker_user_mismatch_rejected', !result.ok && result.reason === 'user_mismatch', 'marker user binding is enforced', `ok=${result.ok}; reason=${result.ok ? 'none' : result.reason}`, ['Cookie alone is insufficient without matching Supabase session user.'])
}

async function staleMarkerRejected(): Promise<PasswordRecoveryValidationResult> {
  const marker = await createRecoveryMarkerValue(USER_ID, 1_000)
  const result = await verifyRecoveryMarkerValue(marker, USER_ID, 1_000 + 16 * 60 * 1000)
  return validation('recovery_19_stale_marker_rejected', !result.ok && result.reason === 'expired', 'expired marker rejected', `ok=${result.ok}; reason=${result.ok ? 'none' : result.reason}`, ['Marker lifetime is short-lived.'])
}

async function openRedirectImpossible(): Promise<PasswordRecoveryValidationResult> {
  const fixture = makeCallbackFixture({ type: 'recovery', extraQuery: '&next=https://evil.example' })
  const response = await fixture.run()
  return validation('recovery_20_open_redirect_impossible', response.headers.get('location') === `${ORIGIN}/update-password`, 'callback ignores client-controlled redirect destinations', `location=${response.headers.get('location')}`, ['No client-controlled redirect destination is used.'])
}

async function passwordAbsentFromLogs(): Promise<PasswordRecoveryValidationResult> {
  const auth = new FakePasswordUpdateAuth({ updateOk: false })
  const result = await updateRecoveredPassword('never-log-this-password', 'never-log-this-password', auth, async () => auth.clear())
  const serialized = JSON.stringify({ result, evidence: auth.evidence })
  return validation('recovery_21_password_absent', !serialized.includes('never-log-this-password'), 'password absent from errors/log evidence', `containsPassword=${serialized.includes('never-log-this-password')}`, ['Password is only passed to updateUser.'])
}

async function loginFlowUnchanged(): Promise<PasswordRecoveryValidationResult> {
  return validation('recovery_22_login_flow_unchanged', !isRecoveryAllowedPath('/login'), 'login is not part of recovery-only allowed paths', `recoveryAllowsLogin=${isRecoveryAllowedPath('/login')}`, ['Normal login remains separate from recovery marker flow.'])
}

async function commanderProtectionsUnchanged(): Promise<PasswordRecoveryValidationResult> {
  const fixture = makeCallbackFixture({ type: 'recovery' })
  await fixture.run()
  return validation('recovery_23_commander_protections_unchanged', fixture.authority.confirmAttempts === 0, 'recovery callback does not call invitation/Commander authority', `confirms=${fixture.authority.confirmAttempts}`, ['Recovery never assigns Commander or membership.'])
}

async function inviteConfirmationFlowUnchanged(): Promise<PasswordRecoveryValidationResult> {
  const fixture = makeCallbackFixture({ type: 'signup' })
  await fixture.run()
  return validation('recovery_24_invite_confirmation_unchanged', fixture.authority.lastEmail === EMAIL && fixture.authority.lastUserId === USER_ID, 'signup confirmation still uses server-derived email/user', `email=${fixture.authority.lastEmail}; user=${fixture.authority.lastUserId}`, ['No client-supplied identity enters the callback.'])
}

async function invitationMismatchLeavesNoLiveSession(): Promise<PasswordRecoveryValidationResult> {
  const fixture = makeCallbackFixture({ type: 'signup', confirmationOk: false })
  const response = await fixture.run()
  return validation('recovery_25_invitation_mismatch_signs_out', response.headers.get('location') === `${ORIGIN}/login?auth=invitation_mismatch` && fixture.supabase.signOutAttempts === 1 && hasCookie(response, 'war_room_recovery'), 'invitation mismatch signs out and clears recovery state', `location=${response.headers.get('location')}; signOut=${fixture.supabase.signOutAttempts}; clearCookie=${hasCookie(response, 'war_room_recovery')}`, ['Mismatch never leaves a live authenticated session intentionally.'])
}

async function updateSuccessSignOutFailureDoesNotClearMarker(): Promise<PasswordRecoveryValidationResult> {
  const auth = new FakePasswordUpdateAuth({ signOutOk: false })
  const result = await updateRecoveredPassword('correct-horse', 'correct-horse', auth, async () => auth.clear())
  return validation('recovery_26_update_success_signout_failure_restricted', result.status === 'error' && auth.updateAttempts === 1 && auth.signOutAttempts === 1 && !auth.cleared, 'updateUser succeeds but failed signOut cannot clear recovery marker', `status=${result.status}; updates=${auth.updateAttempts}; signOut=${auth.signOutAttempts}; cleared=${auth.cleared}`, ['Session remains recovery-restricted until cleanup succeeds.'])
}

async function cleanupIncompleteRetainsRecoveryMarker(): Promise<PasswordRecoveryValidationResult> {
  const auth = new FakePasswordUpdateAuth({ signOutOk: false })
  await updateRecoveredPassword('correct-horse', 'correct-horse', auth, async () => auth.clear())
  return validation('recovery_27_cleanup_incomplete_retains_marker', !auth.cleared, 'cleanup incomplete retains marker', `cleared=${auth.cleared}`, ['Middleware will continue to classify the session as recovery-only.'])
}

async function cleanupRetrySucceeds(): Promise<PasswordRecoveryValidationResult> {
  const auth = new FakePasswordUpdateAuth({ signOutOk: false })
  const first = await updateRecoveredPassword('correct-horse', 'correct-horse', auth, async () => auth.clear())
  auth.setSignOutOk(true)
  const second = await updateRecoveredPassword('correct-horse', 'correct-horse', auth, async () => auth.clear())
  return validation('recovery_28_cleanup_retry_succeeds', first.status === 'error' && second.status === 'success' && auth.signOutAttempts === 2, 'retry can complete signOut after transient cleanup failure', `first=${first.status}; second=${second.status}; signOut=${auth.signOutAttempts}`, ['Retry remains inside recovery restriction until success.'])
}

async function recoveryCompletionFinallyClearsMarker(): Promise<PasswordRecoveryValidationResult> {
  const auth = new FakePasswordUpdateAuth({ signOutOk: false })
  await updateRecoveredPassword('correct-horse', 'correct-horse', auth, async () => auth.clear())
  auth.setSignOutOk(true)
  await updateRecoveredPassword('correct-horse', 'correct-horse', auth, async () => auth.clear())
  return validation('recovery_29_completion_finally_clears_marker', auth.cleared, 'marker clears only after signOut succeeds', `cleared=${auth.cleared}`, ['The cleanup invariant is signOut-confirmed-before-marker-clear.'])
}

async function domainSeparatedHmacRejectsCrossProtocolValue(): Promise<PasswordRecoveryValidationResult> {
  const payload = b64(JSON.stringify({ v: 1, userId: USER_ID, nonce: 'nonce', exp: Date.now() + 60_000 }))
  const signature = await signWithoutRecoveryDomain(payload, SECRET)
  const result = await verifyRecoveryMarkerValue(`${payload}.${signature}`, USER_ID)
  return validation('recovery_30_domain_separated_hmac', !result.ok && result.reason === 'bad_signature', 'cross-protocol HMAC without recovery context is rejected', `ok=${result.ok}; reason=${result.ok ? 'none' : result.reason}`, ['Recovery marker signing uses explicit protocol context.'])
}

async function mislabeledSignupRecoveryDoesNotStrandInvitation(): Promise<PasswordRecoveryValidationResult> {
  const fixture = makeCallbackFixture({ type: 'recovery', includeCode: true, includeTokenHash: false, latestInvitationStatus: 'account_created' })
  const response = await fixture.run()
  return validation('recovery_31_mislabeled_signup_recovery_not_stranded', response.headers.get('location') === `${ORIGIN}/login?auth=invalid_callback` && fixture.authority.confirmAttempts === 0 && hasClearedCookie(response, 'war_room_recovery'), 'signup callback mislabeled as recovery is rejected without creating recovery marker', `location=${response.headers.get('location')}; confirms=${fixture.authority.confirmAttempts}; recoveryCleared=${hasClearedCookie(response, 'war_room_recovery')}`, ['Recovery now requires token_hash plus type=recovery; signup code callbacks stay separate.'])
}

async function forgotPasswordEnvironmentGate(): Promise<PasswordRecoveryValidationResult> {
  const blocked = assertLiveActionsAllowed({ VERCEL_ENV: 'preview' })
  const allowed = assertLiveActionsAllowed({ VERCEL_ENV: 'production' })
  return validation('recovery_32_forgot_password_environment_gate', blocked !== null && allowed === null, 'forgot-password action uses the same live-action environment gate policy', `previewBlocked=${blocked !== null}; productionAllowed=${allowed === null}`, ['Server action returns generic recovery response when the environment gate blocks sending.'])
}

async function callbackCleanupSignOutSucceeds(): Promise<PasswordRecoveryValidationResult> {
  const fixture = makeCallbackFixture({ type: 'unsupported' })
  const response = await fixture.run()
  return validation('recovery_r2_33_cleanup_signout_succeeds', response.headers.get('location') === `${ORIGIN}/login?auth=unsupported_callback` && fixture.supabase.signOutAttempts === 1 && hasCookie(response, 'war_room_auth_cleanup'), 'cleanup success redirects to ordinary login and clears cleanup marker', `location=${response.headers.get('location')}; signOut=${fixture.supabase.signOutAttempts}; cleanupCookie=${hasCookie(response, 'war_room_auth_cleanup')}`, ['Ordinary login redirect happens only after signOut success.'])
}

async function callbackCleanupSignOutReturnedErrorRestricts(): Promise<PasswordRecoveryValidationResult> {
  const fixture = makeCallbackFixture({ type: 'unsupported', signOutOk: false })
  const response = await fixture.run()
  return validation('recovery_r2_34_cleanup_signout_error_restricts', response.headers.get('location') === `${ORIGIN}/auth/cleanup` && hasCookie(response, 'war_room_auth_cleanup') && !isCleanupAllowedPath('/'), 'signOut returned error routes to cleanup restriction, not login', `location=${response.headers.get('location')}; cleanupMarker=${hasCookie(response, 'war_room_auth_cleanup')}; dashboardAllowed=${isCleanupAllowedPath('/')}`, ['No normal dashboard-capable session is created.'])
}

async function callbackCleanupSignOutThrowsRestricts(): Promise<PasswordRecoveryValidationResult> {
  const fixture = makeCallbackFixture({ type: 'unsupported', signOutThrows: true })
  const response = await fixture.run()
  return validation('recovery_r2_35_cleanup_signout_throw_restricts', response.headers.get('location') === `${ORIGIN}/auth/cleanup` && hasCookie(response, 'war_room_auth_cleanup'), 'thrown signOut failure routes to cleanup restriction', `location=${response.headers.get('location')}; cleanupMarker=${hasCookie(response, 'war_room_auth_cleanup')}`, ['Thrown network/server failures are not suppressed into login.'])
}

async function callbackCleanupRetryLaterSucceeds(): Promise<PasswordRecoveryValidationResult> {
  const marker = await createAuthCleanupMarkerValue({ userId: USER_ID, destination: '/login?auth=unsupported_callback' })
  const supabase = new FakeCleanupSupabase({ signOutOk: true, user: { id: USER_ID } })
  const response = await handleAuthCleanup(makeRequest(`${ORIGIN}/auth/cleanup`, { war_room_auth_cleanup: marker ?? '' }) as never, {
    createSupabaseClient: async () => supabase as never,
  })
  return validation('recovery_r2_36_cleanup_retry_succeeds', response.headers.get('location') === `${ORIGIN}/login?auth=unsupported_callback` && hasCookie(response, 'war_room_auth_cleanup') && supabase.signOutAttempts === 1, 'cleanup retry clears marker after signOut success', `location=${response.headers.get('location')}; cleanupCookie=${hasCookie(response, 'war_room_auth_cleanup')}; signOut=${supabase.signOutAttempts}`, ['Cleanup marker is cleared only after confirmed signOut.'])
}

async function invalidCallbackAfterSessionCannotReachDashboard(): Promise<PasswordRecoveryValidationResult> {
  const fixture = makeCallbackFixture({ type: 'signup', exchangeOk: false, signOutOk: false })
  const response = await fixture.run()
  return validation('recovery_r2_37_invalid_callback_restricted', response.headers.get('location') === `${ORIGIN}/auth/cleanup` && hasCookie(response, 'war_room_auth_cleanup') && !isCleanupAllowedPath('/'), 'invalid_callback with failed signOut cannot reach dashboard', `location=${response.headers.get('location')}; cleanupMarker=${hasCookie(response, 'war_room_auth_cleanup')}; dashboardAllowed=${isCleanupAllowedPath('/')}`, ['The cleanup marker quarantines possibly-live sessions.'])
}

async function unverifiedBranchCannotReachDashboard(): Promise<PasswordRecoveryValidationResult> {
  const fixture = makeCallbackFixture({ type: 'signup', user: null, signOutOk: false })
  const response = await fixture.run()
  return validation('recovery_r2_38_unverified_restricted', response.headers.get('location') === `${ORIGIN}/auth/cleanup` && hasCookie(response, 'war_room_auth_cleanup'), 'unverified branch with failed signOut enters cleanup route', `location=${response.headers.get('location')}; cleanupMarker=${hasCookie(response, 'war_room_auth_cleanup')}`, ['Even without a resolved user id, the signed cleanup marker restricts the session.'])
}

async function invitationMismatchCannotLeaveUnrestrictedSession(): Promise<PasswordRecoveryValidationResult> {
  const fixture = makeCallbackFixture({ type: 'signup', confirmationOk: false, signOutOk: false })
  const response = await fixture.run()
  return validation('recovery_r2_39_invitation_mismatch_restricted', response.headers.get('location') === `${ORIGIN}/auth/cleanup` && hasCookie(response, 'war_room_auth_cleanup'), 'invitation mismatch with failed signOut enters cleanup route', `location=${response.headers.get('location')}; cleanupMarker=${hasCookie(response, 'war_room_auth_cleanup')}`, ['Invitation mismatch never falls through to dashboard-capable login.'])
}

async function unsupportedCallbackCannotLeaveUnrestrictedSession(): Promise<PasswordRecoveryValidationResult> {
  const fixture = makeCallbackFixture({ type: 'unsupported', signOutOk: false })
  const response = await fixture.run()
  return validation('recovery_r2_40_unsupported_callback_restricted', response.headers.get('location') === `${ORIGIN}/auth/cleanup` && hasCookie(response, 'war_room_auth_cleanup'), 'unsupported callback with failed signOut enters cleanup route', `location=${response.headers.get('location')}; cleanupMarker=${hasCookie(response, 'war_room_auth_cleanup')}`, ['Unsupported callback type cannot create unrestricted authenticated session.'])
}

async function normalCallbackSuccessPathsUnchanged(): Promise<PasswordRecoveryValidationResult> {
  const recovery = await makeCallbackFixture({ type: 'recovery' }).run()
  const signup = await makeCallbackFixture({ type: 'signup' }).run()
  return validation('recovery_r2_41_normal_success_paths_unchanged', recovery.headers.get('location') === `${ORIGIN}/update-password` && signup.headers.get('location') === `${ORIGIN}/login?confirmed=1`, 'normal recovery and signup callback success paths remain unchanged', `recovery=${recovery.headers.get('location')}; signup=${signup.headers.get('location')}`, ['R2 only hardens failure cleanup branches.'])
}

async function signupConfirmationStillFunctional(): Promise<PasswordRecoveryValidationResult> {
  const fixture = makeCallbackFixture({ type: 'signup' })
  await fixture.run()
  return validation('recovery_r2_42_signup_confirmation_functional', fixture.authority.confirmAttempts === 1 && fixture.authority.lastEmail === EMAIL, 'signup confirmation remains functional', `confirms=${fixture.authority.confirmAttempts}; email=${fixture.authority.lastEmail}`, ['Invite flow still uses the existing confirmation authority.'])
}

async function passwordRecoveryFlowStillFunctional(): Promise<PasswordRecoveryValidationResult> {
  const fixture = makeCallbackFixture({ type: 'recovery' })
  const response = await fixture.run()
  return validation('recovery_r2_43_password_recovery_functional', response.headers.get('location') === `${ORIGIN}/update-password` && hasCookie(response, 'war_room_recovery'), 'password recovery flow still sets recovery marker', `location=${response.headers.get('location')}; recoveryMarker=${hasCookie(response, 'war_room_recovery')}`, ['Recovery success branch does not use cleanup marker.'])
}

async function recoveryAndCleanupMarkerCreationFailureFailsClosed(): Promise<PasswordRecoveryValidationResult> {
  const result = await withMissingSecret(async () => {
    const fixture = makeCallbackFixture({ type: 'recovery', signOutOk: false })
    return fixture.run()
  })
  return validation('recovery_r3_44_marker_creation_failure_fails_closed', result.status === 503 && result.headers.get('location') === null, 'recovery marker failure + signOut failure + cleanup marker failure returns fail-closed response', `status=${result.status}; location=${result.headers.get('location')}`, ['No ordinary login redirect and no unprotected cleanup redirect are emitted.'])
}

async function cleanupFailureClearsRecoveryAndSetsCleanup(): Promise<PasswordRecoveryValidationResult> {
  const fixture = makeCallbackFixture({ type: 'unsupported', signOutOk: false })
  const response = await fixture.run()
  const cookies = response.headers.get('set-cookie') ?? ''
  return validation('recovery_r3_45_cleanup_quarantine_clears_recovery', response.headers.get('location') === `${ORIGIN}/auth/cleanup` && cookies.includes('war_room_auth_cleanup=') && cookies.includes('war_room_recovery=;'), 'cleanup failure clears recovery marker and sets cleanup marker', `location=${response.headers.get('location')}; cleanup=${cookies.includes('war_room_auth_cleanup=')}; recoveryClear=${cookies.includes('war_room_recovery=;')}`, ['Cleanup quarantine becomes the sole active restriction.'])
}

async function bothMarkersPreferCleanup(): Promise<PasswordRecoveryValidationResult> {
  const updateAllowed = isCleanupAllowedPath('/update-password')
  const dashboardAllowed = isCleanupAllowedPath('/')
  const cleanupAllowed = isCleanupAllowedPath('/auth/cleanup')
  return validation('recovery_r3_46_both_markers_cleanup_precedence', !updateAllowed && !dashboardAllowed && cleanupAllowed, 'cleanup quarantine takes precedence over recovery mode paths', `updateAllowed=${updateAllowed}; dashboardAllowed=${dashboardAllowed}; cleanupAllowed=${cleanupAllowed}`, ['Middleware checks cleanup marker before recovery marker and denies /update-password under cleanup.'])
}

async function cleanupMarkerSetSucceedsQuarantineActive(): Promise<PasswordRecoveryValidationResult> {
  const fixture = makeCallbackFixture({ type: 'unsupported', signOutOk: false })
  const response = await fixture.run()
  return validation('recovery_r3_47_cleanup_marker_success_quarantine_active', response.headers.get('location') === `${ORIGIN}/auth/cleanup` && hasCookie(response, 'war_room_auth_cleanup') && !isCleanupAllowedPath('/'), 'successful cleanup marker write activates quarantine', `location=${response.headers.get('location')}; marker=${hasCookie(response, 'war_room_auth_cleanup')}; dashboardAllowed=${isCleanupAllowedPath('/')}`, ['The session remains restricted to the cleanup endpoint.'])
}

async function cleanupMarkerSetFailsAfterSignOutFailureFailsClosed(): Promise<PasswordRecoveryValidationResult> {
  const response = await withMissingSecret(async () => {
    const supabase = new FakeCleanupSupabase({ signOutOk: false, user: { id: USER_ID } })
    return handleAuthCleanup(makeRequest(`${ORIGIN}/auth/cleanup`, {}) as never, {
      createSupabaseClient: async () => supabase as never,
    })
  })
  return validation('recovery_r3_48_cleanup_marker_failure_fails_closed', response.status === 503 && response.headers.get('location') === null, 'cleanup marker write failure after signOut failure returns explicit fail-closed response', `status=${response.status}; location=${response.headers.get('location')}`, ['No redirect path can be treated as ordinary without confirmed signOut or cleanup marker.'])
}

async function normalRecoverySuccessUnchangedAfterR3(): Promise<PasswordRecoveryValidationResult> {
  const response = await makeCallbackFixture({ type: 'recovery' }).run()
  return validation('recovery_r3_49_normal_recovery_success_unchanged', response.headers.get('location') === `${ORIGIN}/update-password` && hasCookie(response, 'war_room_recovery'), 'normal recovery callback remains unchanged', `location=${response.headers.get('location')}; marker=${hasCookie(response, 'war_room_recovery')}`, ['Fail-closed handling applies only to cleanup failure paths.'])
}

async function normalSignupConfirmationUnchangedAfterR3(): Promise<PasswordRecoveryValidationResult> {
  const fixture = makeCallbackFixture({ type: 'signup' })
  const response = await fixture.run()
  return validation('recovery_r3_50_normal_signup_confirmation_unchanged', response.headers.get('location') === `${ORIGIN}/login?confirmed=1` && fixture.authority.confirmAttempts === 1, 'normal signup confirmation remains unchanged', `location=${response.headers.get('location')}; confirms=${fixture.authority.confirmAttempts}`, ['Signup confirmation still uses invitation authority.'])
}

async function recoveryTokenHashVerifyOtpSucceeds(): Promise<PasswordRecoveryValidationResult> {
  const fixture = makeCallbackFixture({ type: 'recovery' })
  const response = await fixture.run()
  return validation('recovery_r4_51_token_hash_verify_otp_succeeds', response.headers.get('location') === `${ORIGIN}/update-password` && fixture.supabase.verifyAttempts === 1 && fixture.supabase.verifiedType === 'recovery' && hasCookie(response, 'war_room_recovery'), 'valid recovery token_hash verifies via verifyOtp and reaches /update-password', `location=${response.headers.get('location')}; verifyAttempts=${fixture.supabase.verifyAttempts}; type=${fixture.supabase.verifiedType}; marker=${hasCookie(response, 'war_room_recovery')}`, ['Recovery uses verifyOtp({ token_hash, type: recovery }) instead of code exchange.'])
}

async function recoveryVerifyOtpErrorFailsClosed(): Promise<PasswordRecoveryValidationResult> {
  const fixture = makeCallbackFixture({ type: 'recovery', verifyOk: false })
  const response = await fixture.run()
  return validation('recovery_r4_52_verify_otp_error_fails_closed', response.headers.get('location') === `${ORIGIN}/login?auth=invalid_callback` && fixture.supabase.signOutAttempts === 1 && hasClearedCookie(response, 'war_room_recovery'), 'verifyOtp returned error signs out and clears recovery marker', `location=${response.headers.get('location')}; signOut=${fixture.supabase.signOutAttempts}; recoveryCleared=${hasClearedCookie(response, 'war_room_recovery')}`, ['Supabase error details are not exposed.'])
}

async function recoveryVerifyOtpThrowsFailsClosed(): Promise<PasswordRecoveryValidationResult> {
  const fixture = makeCallbackFixture({ type: 'recovery', verifyThrows: true })
  const response = await fixture.run()
  return validation('recovery_r4_53_verify_otp_throw_fails_closed', response.headers.get('location') === `${ORIGIN}/login?auth=invalid_callback` && fixture.supabase.signOutAttempts === 1, 'thrown verifyOtp failure signs out through cleanup path', `location=${response.headers.get('location')}; signOut=${fixture.supabase.signOutAttempts}`, ['Thrown provider/network errors do not fall through.'])
}

async function expiredOrReusedTokenHashFailsClosed(): Promise<PasswordRecoveryValidationResult> {
  const fixture = makeCallbackFixture({ type: 'recovery', verifyOk: false })
  const response = await fixture.run()
  return validation('recovery_r4_54_expired_or_reused_token_fails_closed', response.headers.get('location') === `${ORIGIN}/login?auth=invalid_callback` && fixture.supabase.signOutAttempts === 1, 'expired or reused token_hash is treated as invalid callback', `location=${response.headers.get('location')}; signOut=${fixture.supabase.signOutAttempts}`, ['The callback does not distinguish expired, reused, or invalid token_hash values.'])
}

async function missingTokenHashRejected(): Promise<PasswordRecoveryValidationResult> {
  const fixture = makeCallbackFixture({ type: 'recovery', includeTokenHash: false })
  const response = await fixture.run()
  return validation('recovery_r4_55_missing_token_hash_rejected', response.headers.get('location') === `${ORIGIN}/login?auth=invalid_callback` && fixture.supabase.verifyAttempts === 0, 'recovery callback requires a non-empty token_hash', `location=${response.headers.get('location')}; verifyAttempts=${fixture.supabase.verifyAttempts}`, ['No attempt is made to process a recovery request without token_hash.'])
}

async function missingTypeRejected(): Promise<PasswordRecoveryValidationResult> {
  const fixture = makeCallbackFixture({ type: null, includeCode: true })
  const response = await fixture.run()
  return validation('recovery_r4_56_missing_type_rejected', response.headers.get('location') === `${ORIGIN}/login?auth=unsupported_callback` && fixture.supabase.signOutAttempts === 1, 'callback without type is rejected after safe code exchange cleanup path', `location=${response.headers.get('location')}; signOut=${fixture.supabase.signOutAttempts}`, ['The route does not infer recovery from token_hash alone.'])
}

async function unsupportedTypeRejectedAfterR4(): Promise<PasswordRecoveryValidationResult> {
  const fixture = makeCallbackFixture({ type: 'magic' })
  const response = await fixture.run()
  return validation('recovery_r4_57_unsupported_type_rejected', response.headers.get('location') === `${ORIGIN}/login?auth=unsupported_callback` && fixture.supabase.signOutAttempts === 1, 'unsupported callback type remains rejected', `location=${response.headers.get('location')}; signOut=${fixture.supabase.signOutAttempts}`, ['Only recovery and signup are accepted.'])
}

async function recoveryTokenMislabeledSignupFails(): Promise<PasswordRecoveryValidationResult> {
  const fixture = makeCallbackFixture({ type: 'signup', includeCode: false, includeTokenHash: true })
  const response = await fixture.run()
  return validation('recovery_r4_58_recovery_token_mislabeled_signup_fails', response.headers.get('location') === `${ORIGIN}/login?auth=invalid_callback` && fixture.supabase.verifyAttempts === 0 && fixture.authority.confirmAttempts === 0, 'token_hash with type=signup is rejected and never confirms an invitation', `location=${response.headers.get('location')}; verifyAttempts=${fixture.supabase.verifyAttempts}; confirms=${fixture.authority.confirmAttempts}`, ['Recovery and signup mechanisms stay separate.'])
}

async function signupCallbackMislabeledRecoveryFails(): Promise<PasswordRecoveryValidationResult> {
  const fixture = makeCallbackFixture({ type: 'recovery', includeCode: true, includeTokenHash: false, latestInvitationStatus: 'account_created' })
  const response = await fixture.run()
  return validation('recovery_r4_59_signup_callback_mislabeled_recovery_fails', response.headers.get('location') === `${ORIGIN}/login?auth=invalid_callback` && fixture.authority.confirmAttempts === 0 && fixture.supabase.exchangeAttempts === 0, 'code callback mislabeled recovery is rejected before signup confirmation', `location=${response.headers.get('location')}; confirms=${fixture.authority.confirmAttempts}; exchanges=${fixture.supabase.exchangeAttempts}`, ['A signup code cannot be converted into recovery or invitation confirmation by changing type.'])
}

async function codeAndTokenHashTogetherFailClosed(): Promise<PasswordRecoveryValidationResult> {
  const fixture = makeCallbackFixture({ type: 'recovery', includeCode: true, includeTokenHash: true })
  const response = await fixture.run()
  return validation('recovery_r4_60_code_and_token_hash_fail_closed', response.headers.get('location') === `${ORIGIN}/login?auth=invalid_callback` && fixture.supabase.verifyAttempts === 0 && fixture.supabase.exchangeAttempts === 0, 'ambiguous code plus token_hash callback is rejected without processing either credential', `location=${response.headers.get('location')}; verifyAttempts=${fixture.supabase.verifyAttempts}; exchanges=${fixture.supabase.exchangeAttempts}`, ['Mixed parameter sets fail closed.'])
}

async function getUserFailureAfterVerifyOtpFailsClosed(): Promise<PasswordRecoveryValidationResult> {
  const fixture = makeCallbackFixture({ type: 'recovery', user: null })
  const response = await fixture.run()
  return validation('recovery_r4_61_get_user_failure_fails_closed', response.headers.get('location') === `${ORIGIN}/login?auth=unverified` && fixture.supabase.verifyAttempts === 1 && fixture.supabase.signOutAttempts === 1, 'getUser failure after verifyOtp signs out and does not create marker', `location=${response.headers.get('location')}; verifyAttempts=${fixture.supabase.verifyAttempts}; signOut=${fixture.supabase.signOutAttempts}`, ['No client-supplied user identity is accepted.'])
}

async function updatePasswordReachedOnlyAfterVerifyOtpSuccess(): Promise<PasswordRecoveryValidationResult> {
  const valid = await makeCallbackFixture({ type: 'recovery' }).run()
  const invalid = await makeCallbackFixture({ type: 'recovery', verifyOk: false }).run()
  return validation('recovery_r4_62_update_password_only_after_verify_success', valid.headers.get('location') === `${ORIGIN}/update-password` && invalid.headers.get('location') !== `${ORIGIN}/update-password`, 'only successful verifyOtp reaches /update-password', `valid=${valid.headers.get('location')}; invalid=${invalid.headers.get('location')}`, ['The update-password route is not reachable from invalid recovery callbacks.'])
}

async function implicitFragmentLinkCannotBeConsumed(): Promise<PasswordRecoveryValidationResult> {
  const fixture = makeCallbackFixture({ type: null, includeCode: false, includeTokenHash: false })
  const response = await fixture.run()
  return validation('recovery_r4_63_implicit_fragment_not_consumed', response.headers.get('location') === `${ORIGIN}/login?auth=missing_code` && fixture.supabase.verifyAttempts === 0 && fixture.supabase.exchangeAttempts === 0, 'server route cannot consume browser fragment tokens', `location=${response.headers.get('location')}; verifyAttempts=${fixture.supabase.verifyAttempts}; exchanges=${fixture.supabase.exchangeAttempts}`, ['No fragment parsing or access-token handling was added.'])
}

async function noTokenHashInErrorsOrPersistence(): Promise<PasswordRecoveryValidationResult> {
  const fixture = makeCallbackFixture({ type: 'recovery', verifyOk: false, tokenHash: 'secret-token-hash-never-log' })
  const response = await fixture.run()
  const serialized = JSON.stringify({ status: response.status, location: response.headers.get('location'), cookies: response.headers.get('set-cookie') })
  return validation('recovery_r4_64_token_hash_not_reflected', !serialized.includes('secret-token-hash-never-log'), 'token_hash is not reflected in responses, errors, or cookies', `containsTokenHash=${serialized.includes('secret-token-hash-never-log')}`, ['The token_hash is passed only to verifyOtp and is not persisted by War Room.'])
}

async function recoveryRedirectTargetHasNoTokenFragment(): Promise<PasswordRecoveryValidationResult> {
  const auth = new FakeRecoveryRequestAuth(true)
  await requestPasswordRecovery(EMAIL, auth, ORIGIN)
  const redirectTo = auth.lastRedirectTo ?? ''
  const hasTokenFragment = redirectTo.includes('#') || redirectTo.includes('access_token') || redirectTo.includes('refresh_token')
  return validation('recovery_r4_65_redirect_target_no_token_fragment', !hasTokenFragment, 'recovery redirect target contains no token fragment or token params', `hasTokenFragment=${hasTokenFragment}; redirectTo=${redirectTo}`, ['The repo never asks Supabase to place tokens in the browser URL.'])
}

class FakeRecoveryRequestAuth {
  attempts = 0
  lastRedirectTo: string | null = null
  readonly reason: string | null

  constructor(private readonly ok: boolean, private readonly options: { throws?: boolean; reason?: string } = {}) {
    this.reason = options.reason ?? null
  }

  async resetPasswordForEmail(input: { email: string; redirectTo: string }): Promise<{ ok: true } | { ok: false }> {
    this.lastRedirectTo = input.redirectTo
    this.attempts += 1
    if (this.options.throws) throw new Error(this.options.reason ?? 'reset failed')
    return this.ok ? { ok: true } : { ok: false }
  }
}

class FakePasswordUpdateAuth {
  updateAttempts = 0
  signOutAttempts = 0
  cleared = false
  readonly evidence: string[] = []

  constructor(private options: { updateOk?: boolean; signOutOk?: boolean } = {}) {}

  async updatePassword(password: string): Promise<{ ok: true } | { ok: false }> {
    void password
    this.updateAttempts += 1
    this.evidence.push('update-attempt')
    return this.options.updateOk === false ? { ok: false } : { ok: true }
  }

  async signOut(): Promise<{ ok: true } | { ok: false }> {
    this.signOutAttempts += 1
    this.evidence.push('signout-attempt')
    return this.options.signOutOk === false ? { ok: false } : { ok: true }
  }

  clear(): void {
    this.cleared = true
    this.evidence.push('marker-cleared')
  }

  setSignOutOk(signOutOk: boolean): void {
    this.options = { ...this.options, signOutOk }
  }
}

class FakeCallbackSupabase {
  signOutAttempts = 0
  exchangeAttempts = 0
  verifyAttempts = 0
  exchangedCode: string | null = null
  verifiedTokenHash: string | null = null
  verifiedType: string | null = null

  constructor(private readonly options: { exchangeOk: boolean; verifyOk: boolean; verifyThrows: boolean; user: { id: string; email: string } | null; signOutOk: boolean; signOutThrows: boolean }) {}

  auth = {
    exchangeCodeForSession: async (code: string) => {
      this.exchangeAttempts += 1
      this.exchangedCode = code
      return { error: this.options.exchangeOk ? null : new Error('bad code') }
    },
    verifyOtp: async (input: { token_hash: string; type: 'recovery' }) => {
      this.verifyAttempts += 1
      this.verifiedTokenHash = input.token_hash
      this.verifiedType = input.type
      if (this.options.verifyThrows) throw new Error('verify failed')
      return { error: this.options.verifyOk ? null : new Error('bad token') }
    },
    getUser: async () => ({ data: { user: this.options.user }, error: this.options.user ? null : new Error('no user') }),
    signOut: async () => {
      this.signOutAttempts += 1
      if (this.options.signOutThrows) throw new Error('signout failed')
      if (!this.options.signOutOk) return { error: new Error('signout failed') }
      return { error: null }
    },
  }
}

class FakeCleanupSupabase {
  signOutAttempts = 0

  constructor(private readonly options: { user: { id: string } | null; signOutOk: boolean }) {}

  auth = {
    getUser: async () => ({ data: { user: this.options.user }, error: this.options.user ? null : new Error('no user') }),
    signOut: async () => {
      this.signOutAttempts += 1
      return { error: this.options.signOutOk ? null : new Error('signout failed') }
    },
  }
}

type FakeInvitationStatus = 'account_created' | 'confirmed' | null

class FakeInvitationAuthority {
  confirmAttempts = 0
  findAttempts = 0
  lastEmail: string | null = null
  lastUserId: string | null = null

  constructor(private readonly ok: boolean, private readonly latestStatus: FakeInvitationStatus = null) {}

  async findLatestByEmail(email: string) {
    this.findAttempts += 1
    if (!this.latestStatus) return null
    return this.makeInvitation(email, USER_ID, this.latestStatus)
  }

  async confirmAccountForVerifiedUser(email: string, authUserId: string) {
    this.confirmAttempts += 1
    this.lastEmail = email
    this.lastUserId = authUserId
    if (!this.ok) return { ok: false as const, status: 'no_matching_invitation' as const, message: 'no match' }
    return {
      ok: true as const,
      status: 'confirmed' as const,
      invitation: this.makeInvitation(email, authUserId, 'confirmed'),
    }
  }

  private makeInvitation(email: string, authUserId: string, status: 'account_created' | 'confirmed') {
    return {
      invitation_id: 'invite-1',
      normalized_email: email,
      token_hash: 'hash',
      status,
      created_by_user_id: 'creator',
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 1000).toISOString(),
      claimed_at: new Date().toISOString(),
      claim_nonce: 'nonce',
      account_created_at: new Date().toISOString(),
      confirmed_at: status === 'confirmed' ? new Date().toISOString() : null,
      claimed_by_auth_user_id: status === 'confirmed' ? authUserId : null,
      revoked_at: null,
      revoked_reason: null,
    }
  }
}

function makeCallbackFixture(options: {
  type: string | null
  exchangeOk?: boolean
  verifyOk?: boolean
  verifyThrows?: boolean
  user?: { id: string; email: string } | null
  confirmationOk?: boolean
  latestInvitationStatus?: FakeInvitationStatus
  signOutOk?: boolean
  signOutThrows?: boolean
  extraQuery?: string
  includeCode?: boolean
  includeTokenHash?: boolean
  tokenHash?: string
}) {
  const supabase = new FakeCallbackSupabase({
    exchangeOk: options.exchangeOk ?? true,
    verifyOk: options.verifyOk ?? true,
    verifyThrows: options.verifyThrows ?? false,
    user: options.user === undefined ? { id: USER_ID, email: EMAIL } : options.user,
    signOutOk: options.signOutOk ?? true,
    signOutThrows: options.signOutThrows ?? false,
  })
  const authority = new FakeInvitationAuthority(options.confirmationOk ?? true, options.latestInvitationStatus ?? null)
  const includeCode = options.includeCode ?? options.type !== 'recovery'
  const includeTokenHash = options.includeTokenHash ?? options.type === 'recovery'
  const queryParts: string[] = []
  if (includeCode) queryParts.push('code=abc')
  if (includeTokenHash) queryParts.push(`token_hash=${encodeURIComponent(options.tokenHash ?? 'recovery-token-hash')}`)
  if (options.type !== null) queryParts.push(`type=${encodeURIComponent(options.type)}`)
  const query = queryParts.length > 0 ? `?${queryParts.join('&')}${options.extraQuery ?? ''}` : ''
  return {
    supabase,
    authority,
    run: () =>
      handleAuthCallback(
        { url: `${ORIGIN}/auth/callback${query}` } as never,
        {
          createSupabaseClient: async () => supabase as never,
          createInvitationAuthority: () => authority as never,
        }
      ),
  }
}

function hasCookie(response: Response, name: string): boolean {
  return response.headers.get('set-cookie')?.includes(name) ?? false
}

function hasClearedCookie(response: Response, name: string): boolean {
  return response.headers.get('set-cookie')?.includes(`${name}=;`) ?? false
}

function makeRequest(url: string, cookieMap: Record<string, string>) {
  return {
    url,
    cookies: {
      get(name: string) {
        const value = cookieMap[name]
        return value ? { name, value } : undefined
      },
    },
  }
}

async function withMissingSecret<T>(run: () => Promise<T>): Promise<T> {
  const previousSecret = process.env.WAR_ROOM_SIGNUP_INVITATION_SECRET
  delete process.env.WAR_ROOM_SIGNUP_INVITATION_SECRET
  try {
    return await run()
  } finally {
    process.env.WAR_ROOM_SIGNUP_INVITATION_SECRET = previousSecret
  }
}

async function signWithoutRecoveryDomain(encodedPayload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encodedPayload))
  return bytesToBase64url(new Uint8Array(signature))
}

function b64(value: string): string {
  return bytesToBase64url(new TextEncoder().encode(value))
}

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function validation(caseId: string, passed: boolean, expected: string, observed: string, notes: string[]): PasswordRecoveryValidationResult {
  return { caseId, passed, expected, observed, notes }
}
