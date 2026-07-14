'use server'

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { assertLiveActionsAllowed } from '@/lib/security/actionRoutePolicy'
import { clearRecoveryMarkerFromCookieStore, verifyRecoveryMarkerFromCookieStore } from './recovery'
import {
  requestPasswordRecovery,
  updateRecoveredPassword,
  type PasswordRecoveryRequestState,
  type PasswordUpdateState,
} from './recoveryFlow'

export type { PasswordRecoveryRequestState, PasswordUpdateState }

export async function sendPasswordRecoveryEmail(_prevState: PasswordRecoveryRequestState, formData: FormData): Promise<PasswordRecoveryRequestState> {
  const environmentBlocked = assertLiveActionsAllowed()
  if (environmentBlocked) {
    return { status: 'sent', message: 'If that email can reset a War Room password, a recovery link has been sent.' }
  }

  const email = String(formData.get('email') ?? '')
  const supabase = await createSupabaseServerClient()
  return requestPasswordRecovery(email, {
    async resetPasswordForEmail(input) {
      const { error } = await supabase.auth.resetPasswordForEmail(input.email, {
        redirectTo: input.redirectTo,
      })
      return error ? { ok: false } : { ok: true }
    },
  })
}

export async function updatePasswordAfterRecovery(_prevState: PasswordUpdateState, formData: FormData): Promise<PasswordUpdateState> {
  const environmentBlocked = assertLiveActionsAllowed()
  if (environmentBlocked) return { status: 'error', message: 'Password reset is not available in this environment.' }

  const password = String(formData.get('password') ?? '')
  const confirmPassword = String(formData.get('confirmPassword') ?? '')
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.getUser()
  const user = data.user
  if (error || !user?.id) {
    await clearRecoveryMarkerFromCookieStore()
    return { status: 'error', message: 'Recovery session has expired. Request a new recovery link.' }
  }

  const marker = await verifyRecoveryMarkerFromCookieStore(user.id)
  if (!marker.ok) {
    await clearRecoveryMarkerFromCookieStore()
    return { status: 'error', message: 'Recovery session has expired. Request a new recovery link.' }
  }

  const result = await updateRecoveredPassword(
    password,
    confirmPassword,
    {
      async updatePassword(nextPassword) {
        const { error: updateError } = await supabase.auth.updateUser({ password: nextPassword })
        return updateError ? { ok: false } : { ok: true }
      },
      async signOut() {
        const { error: signOutError } = await supabase.auth.signOut()
        return signOutError ? { ok: false } : { ok: true }
      },
    },
    clearRecoveryMarkerFromCookieStore
  )

  if (result.status === 'success') redirect('/login?reset=success')
  return result
}
