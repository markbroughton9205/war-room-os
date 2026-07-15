'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseSignupInvitationAuthority } from '@/lib/signup-invitations'
import { normalizeEmail } from '@/lib/signup-invitations/token'
import {
  processInviteSignup,
  type SignupFlowAuthClient,
  type SignupFlowState,
} from '@/lib/signup-invitations/signupFlow'
import type { User } from '@supabase/supabase-js'

type ExistingAuthLookup =
  | { status: 'none' }
  | { status: 'unconfirmed'; user: User }
  | { status: 'confirmed'; user: User }
  | { status: 'lookup_unavailable' }

export async function signUpWithInvitation(_prevState: SignupFlowState, formData: FormData): Promise<SignupFlowState> {
  const rawToken = String(formData.get('invite') ?? formData.get('token') ?? '').trim()
  const email = normalizeEmail(String(formData.get('email') ?? ''))
  const password = String(formData.get('password') ?? '')
  const confirmPassword = String(formData.get('confirmPassword') ?? '')

  const invitationAuthority = createSupabaseSignupInvitationAuthority()
  const supabase = await createSupabaseServerClient()
  const auth: SignupFlowAuthClient = {
    async findExistingAuthUserByEmail(candidateEmail) {
      const existing = await findExistingAuthUserByEmail(candidateEmail)
      if (existing.status === 'none' || existing.status === 'lookup_unavailable') return existing
      return { status: existing.status, userId: existing.user.id }
    },
    async resend(input) {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: input.email,
        options: { emailRedirectTo: input.emailRedirectTo },
      })
      return error ? { ok: false } : { ok: true }
    },
    async signUp(input) {
      const { error } = await supabase.auth.signUp({
        email: input.email,
        password: input.password,
        options: { emailRedirectTo: input.emailRedirectTo },
      })
      return error ? { ok: false } : { ok: true }
    },
  }

  return processInviteSignup({ rawToken, email, password, confirmPassword }, { authority: invitationAuthority, auth })
}

async function findExistingAuthUserByEmail(email: string): Promise<
  ExistingAuthLookup
> {
  try {
    const admin = createSupabaseAdminClient()
    const normalizedEmail = normalizeEmail(email)
    let page = 1
    const perPage = 1000

    while (page <= 10) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
      if (error) return { status: 'lookup_unavailable' }
      const user = data.users.find(candidate => normalizeEmail(candidate.email ?? '') === normalizedEmail)
      if (user) {
        return isEmailConfirmed(user) ? { status: 'confirmed', user } : { status: 'unconfirmed', user }
      }
      if (data.users.length < perPage) break
      page += 1
    }
  } catch {
    return { status: 'lookup_unavailable' }
  }
  return { status: 'none' }
}

function isEmailConfirmed(user: User): boolean {
  const candidate = user as User & { confirmed_at?: string | null }
  return Boolean(candidate.email_confirmed_at ?? candidate.confirmed_at)
}
