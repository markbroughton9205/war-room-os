import { isPlausibleEmail, normalizeEmail, readBaseUrl } from '@/lib/signup-invitations/token'

export type PasswordRecoveryRequestState = {
  status: 'idle' | 'sent'
  message: string | null
}

export type PasswordUpdateState = {
  status: 'idle' | 'error' | 'success'
  message: string | null
}

export type PasswordRecoveryAuthClient = {
  resetPasswordForEmail(input: { email: string; redirectTo: string }): Promise<{ ok: true } | { ok: false }>
}

export type PasswordUpdateAuthClient = {
  updatePassword(password: string): Promise<{ ok: true } | { ok: false }>
  signOut(): Promise<{ ok: true } | { ok: false }>
}

export const GENERIC_RECOVERY_SENT_MESSAGE = 'If that email can reset a War Room password, a recovery link has been sent.'
export const GENERIC_PASSWORD_UPDATE_FAILURE = 'Password could not be updated. Please try again in a few minutes.'
export const GENERIC_RECOVERY_CLEANUP_FAILURE = 'Password was updated, but recovery cleanup is still in progress. Try again to finish sign out.'

export async function requestPasswordRecovery(
  email: string,
  auth: PasswordRecoveryAuthClient,
  baseUrl = readBaseUrl()
): Promise<PasswordRecoveryRequestState> {
  const normalizedEmail = normalizeEmail(email)
  if (!isPlausibleEmail(normalizedEmail)) {
    return { status: 'sent', message: GENERIC_RECOVERY_SENT_MESSAGE }
  }

  try {
    await auth.resetPasswordForEmail({
      email: normalizedEmail,
      redirectTo: `${baseUrl.replace(/\/+$/, '')}/auth/callback?type=recovery`,
    })
  } catch {
    // Recovery request responses are intentionally generic and non-enumerating.
  }

  return { status: 'sent', message: GENERIC_RECOVERY_SENT_MESSAGE }
}

export async function updateRecoveredPassword(
  password: string,
  confirmPassword: string,
  auth: PasswordUpdateAuthClient,
  clearRecoveryState: () => Promise<void> | void
): Promise<PasswordUpdateState> {
  if (!password || !confirmPassword) {
    return { status: 'error', message: 'New password and confirmation are required.' }
  }
  if (password !== confirmPassword) {
    return { status: 'error', message: 'Passwords do not match.' }
  }
  if (password.length < 8) {
    return { status: 'error', message: 'Password must be at least 8 characters.' }
  }

  const updated = await safeUpdatePassword(auth, password)
  if (!updated.ok) return { status: 'error', message: GENERIC_PASSWORD_UPDATE_FAILURE }

  const signedOut = await safeSignOut(auth)
  if (!signedOut.ok) return { status: 'error', message: GENERIC_RECOVERY_CLEANUP_FAILURE }

  await clearRecoveryState()
  return { status: 'success', message: 'Password updated.' }
}

async function safeUpdatePassword(auth: PasswordUpdateAuthClient, password: string): Promise<{ ok: true } | { ok: false }> {
  try {
    return await auth.updatePassword(password)
  } catch {
    return { ok: false }
  }
}

async function safeSignOut(auth: PasswordUpdateAuthClient): Promise<{ ok: true } | { ok: false }> {
  try {
    return await auth.signOut()
  } catch {
    return { ok: false }
  }
}
