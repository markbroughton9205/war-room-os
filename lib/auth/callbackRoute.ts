import type { NextRequest, NextResponse } from 'next/server'
import { NextResponse as ResponseFactory } from 'next/server'
import type { SupabaseSignupInvitationAuthority } from '@/lib/signup-invitations'
import { clearAuthCleanupMarker, clearRecoveryMarker, setAuthCleanupMarker, setRecoveryMarker } from './recovery'

type CallbackSupabaseClient = {
  auth: {
    exchangeCodeForSession(code: string): Promise<{ error: unknown | null }>
    verifyOtp(input: { token_hash: string; type: 'recovery' }): Promise<{ error: unknown | null }>
    getUser(): Promise<{ data: { user: { id: string; email?: string | null } | null }; error: unknown | null }>
    signOut(): Promise<{ error: unknown | null }>
  }
}

export type AuthCallbackDeps = {
  createSupabaseClient(): Promise<CallbackSupabaseClient>
  createInvitationAuthority(): SupabaseSignupInvitationAuthority
}

export async function handleAuthCallback(req: NextRequest, deps: AuthCallbackDeps): Promise<NextResponse> {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const tokenHash = url.searchParams.get('token_hash')
  const type = url.searchParams.get('type')
  const origin = url.origin

  if (type === 'recovery') {
    const supabase = await deps.createSupabaseClient()
    if (!tokenHash?.trim() || code) {
      return cleanupAndRedirect(supabase, `${origin}/login?auth=invalid_callback`)
    }

    try {
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
      if (error) return cleanupAndRedirect(supabase, `${origin}/login?auth=invalid_callback`)
    } catch {
      return cleanupAndRedirect(supabase, `${origin}/login?auth=invalid_callback`)
    }

    const { data, error: userError } = await supabase.auth.getUser()
    const user = data.user
    if (userError || !user?.id) {
      return cleanupAndRedirect(supabase, `${origin}/login?auth=unverified`)
    }

    const response = ResponseFactory.redirect(`${origin}/update-password`)
    if (!(await setRecoveryMarker(response, user.id))) {
      return cleanupAndRedirect(supabase, `${origin}/login?auth=recovery_unavailable`)
    }
    return response
  }

  if (type === 'signup' && tokenHash) {
    const supabase = await deps.createSupabaseClient()
    return cleanupAndRedirect(supabase, `${origin}/login?auth=invalid_callback`)
  }

  if (!code) return ResponseFactory.redirect(`${origin}/login?auth=missing_code`)

  const supabase = await deps.createSupabaseClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) return cleanupAndRedirect(supabase, `${origin}/login?auth=invalid_callback`)

  const { data, error: userError } = await supabase.auth.getUser()
  const user = data.user
  const email = user?.email
  if (userError || !user?.id || !email) {
    return cleanupAndRedirect(supabase, `${origin}/login?auth=unverified`)
  }

  if (type === 'signup') {
    const invitationAuthority = deps.createInvitationAuthority()
    const confirmation = await invitationAuthority.confirmAccountForVerifiedUser(email, user.id)
    if (!confirmation.ok) {
      return cleanupAndRedirect(supabase, `${origin}/login?auth=invitation_mismatch`)
    }
    return ResponseFactory.redirect(`${origin}/login?confirmed=1`)
  }

  return cleanupAndRedirect(supabase, `${origin}/login?auth=unsupported_callback`)
}

async function cleanupAndRedirect(supabase: CallbackSupabaseClient, destination: string): Promise<NextResponse> {
  const signOut = await safeSignOut(supabase)
  const response = ResponseFactory.redirect(signOut.ok ? destination : `${new URL(destination).origin}/auth/cleanup`)
  if (!signOut.ok) {
    clearRecoveryMarker(response)
    const cleanupMarkerSet = await setAuthCleanupMarker(response, {
      userId: signOut.userId,
      destination: toRelativeDestination(destination),
    })
    if (!cleanupMarkerSet) return failClosedCleanupResponse()
    return response
  }
  clearRecoveryMarker(response)
  clearAuthCleanupMarker(response)
  return response
}

function failClosedCleanupResponse(): NextResponse {
  return ResponseFactory.json(
    { error: 'Authentication cleanup could not be completed safely. Refresh this page to retry.' },
    { status: 503 }
  )
}

async function safeSignOut(supabase: CallbackSupabaseClient): Promise<{ ok: true } | { ok: false; userId: string | null }> {
  let userId: string | null = null
  try {
    const userResult = await supabase.auth.getUser()
    userId = userResult.data.user?.id ?? null
  } catch {
    userId = null
  }

  try {
    const { error } = await supabase.auth.signOut()
    return error ? { ok: false, userId } : { ok: true }
  } catch {
    return { ok: false, userId }
  }
}

function toRelativeDestination(destination: string): string {
  try {
    const parsed = new URL(destination)
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return '/login?auth=cleanup_required'
  }
}
