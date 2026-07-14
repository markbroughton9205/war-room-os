import type { NextRequest, NextResponse } from 'next/server'
import { NextResponse as ResponseFactory } from 'next/server'
import {
  clearAuthCleanupMarker,
  clearRecoveryMarker,
  setAuthCleanupMarker,
  verifyAuthCleanupMarkerFromRequest,
} from './recovery'

type CleanupSupabaseClient = {
  auth: {
    getUser(): Promise<{ data: { user: { id: string } | null }; error?: unknown | null }>
    signOut(): Promise<{ error: unknown | null }>
  }
}

export type AuthCleanupDeps = {
  createSupabaseClient(): Promise<CleanupSupabaseClient>
}

export async function handleAuthCleanup(req: NextRequest, deps: AuthCleanupDeps): Promise<NextResponse> {
  const origin = new URL(req.url).origin
  const supabase = await deps.createSupabaseClient()
  const { data } = await supabase.auth.getUser()
  const userId = data.user?.id ?? null
  const marker = await verifyAuthCleanupMarkerFromRequest(req, userId)
  const destination = marker.ok ? marker.payload.destination : '/login?auth=cleanup_required'

  // A live session must never fall through to an ordinary redirect based on
  // marker validity alone — the marker only carries bookkeeping (where to go
  // once signed out), not proof that sign-out happened. If a session is
  // still live, sign-out must be attempted and confirmed regardless of
  // whether the marker itself is still valid; on continued failure, re-mint
  // a fresh marker so the retry loop never depends on a stale/expired one.
  if (userId) {
    let signOutOk = false
    try {
      const { error } = await supabase.auth.signOut()
      signOutOk = !error
    } catch {
      signOutOk = false
    }

    if (!signOutOk) {
      const response = ResponseFactory.redirect(`${origin}/auth/cleanup?retry=1`)
      clearRecoveryMarker(response)
      const cleanupMarkerSet = await setAuthCleanupMarker(response, { userId, destination })
      if (!cleanupMarkerSet) return failClosedCleanupResponse()
      return response
    }
  }

  const response = ResponseFactory.redirect(`${origin}${destination}`)
  clearAuthCleanupMarker(response)
  clearRecoveryMarker(response)
  return response
}

function failClosedCleanupResponse(): NextResponse {
  return ResponseFactory.json(
    { error: 'Authentication cleanup could not be completed safely. Refresh this page to retry.' },
    { status: 503 }
  )
}
