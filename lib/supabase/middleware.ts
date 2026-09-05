import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import {
  AUTH_CLEANUP_MARKER_COOKIE,
  clearAuthCleanupMarker,
  clearRecoveryMarker,
  setAuthCleanupMarker,
  verifyAuthCleanupMarkerFromRequest,
  verifyRecoveryMarkerFromRequest,
} from '@/lib/auth/recovery'

const PUBLIC_PATHS = ['/login', '/signup', '/forgot-password', '/auth/callback', '/auth/cleanup']

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(path => pathname === path || pathname.startsWith(`${path}/`))
}

// Routes that already enforce their own authorization (shared secret or —
// for grok/chat + payments/deposits + payments/proof —
// assertActionRouteAuthorized accepting WAR_ROOM_ACTION_SECRET OR a signed-in
// session). Middleware must not blanket-401 these or it breaks the
// server-to-server secret path these routes still support.
//
// internet/status + research are read-only diagnostic GETs (boolean config
// flags only, no secret values) called both from the browser and, more
// heavily, from internal server-to-server probes (lib/engine-control/
// tool-snapshot.ts, canonicalStatus.ts, runtimeIntegrityCollect.ts) that have
// no session cookie to present. Same low-sensitivity category as
// PUBLIC_API_PREFIXES's /api/debug/* below, not the secret-or-session pattern.
const PUBLIC_API_PATHS = new Set([
  '/api/signals/rss/poll',
  '/api/grok/chat',
  '/api/payments/deposits',
  '/api/payments/proof',
  '/api/tools/internet/status',
  '/api/tools/research',
])

const PUBLIC_API_PREFIXES = ['/api/debug/']

function isExemptApiRequest(pathname: string, method: string): boolean {
  // GET now requires a session (log reads are Commander-only); POST keeps its
  // existing WAR_ROOM_AUDIT_POST_SECRET gate.
  if (pathname === '/api/audit/logs') {
    return method === 'POST'
  }
  if (PUBLIC_API_PATHS.has(pathname)) {
    return true
  }
  return PUBLIC_API_PREFIXES.some(prefix => pathname.startsWith(prefix))
}

/**
 * Refreshes the Supabase session cookie on every request and redirects
 * unauthenticated visitors to /login. Must return the same response object
 * threaded through supabase's cookie handlers — swapping it for a fresh
 * NextResponse drops the refreshed session cookie.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { pathname } = request.nextUrl

  if (user) {
    const cleanupMarkerCookie = request.cookies.get(AUTH_CLEANUP_MARKER_COOKIE)?.value
    if (cleanupMarkerCookie) {
      const marker = await verifyAuthCleanupMarkerFromRequest(request, user.id)
      if (!marker.ok) {
        // A still-live session must not reach an ordinary redirect unless
        // sign-out is confirmed — an invalid/expired marker on its own says
        // nothing about whether the session was actually terminated.
        let signOutOk = false
        try {
          const { error } = await supabase.auth.signOut()
          signOutOk = !error
        } catch {
          signOutOk = false
        }

        if (signOutOk) {
          const loginUrl = request.nextUrl.clone()
          loginUrl.pathname = '/login'
          loginUrl.search = '?auth=cleanup_required'
          const response = NextResponse.redirect(loginUrl)
          clearAuthCleanupMarker(response)
          clearRecoveryMarker(response)
          return response
        }

        const cleanupUrl = request.nextUrl.clone()
        cleanupUrl.pathname = '/auth/cleanup'
        cleanupUrl.search = ''
        const response = NextResponse.redirect(cleanupUrl)
        clearRecoveryMarker(response)
        const cleanupMarkerSet = await setAuthCleanupMarker(response, { userId: user.id, destination: '/login?auth=cleanup_required' })
        if (!cleanupMarkerSet) return failClosedCleanupResponse()
        return response
      }

      if (!isCleanupAllowedPath(pathname)) {
        const cleanupUrl = request.nextUrl.clone()
        cleanupUrl.pathname = '/auth/cleanup'
        cleanupUrl.search = ''
        const response = NextResponse.redirect(cleanupUrl)
        clearRecoveryMarker(response)
        return response
      }
    }

    const markerCookie = request.cookies.get('war_room_recovery')?.value
    if (markerCookie) {
      const marker = await verifyRecoveryMarkerFromRequest(request, user.id)
      if (!marker.ok) {
        // Same invariant as the cleanup-marker branch above: don't fall
        // through to an ordinary redirect on an invalid recovery marker
        // unless sign-out is confirmed. On failure, hand off to the
        // auth-cleanup quarantine rather than inventing a second retry path.
        let signOutOk = false
        try {
          const { error } = await supabase.auth.signOut()
          signOutOk = !error
        } catch {
          signOutOk = false
        }

        if (signOutOk) {
          const loginUrl = request.nextUrl.clone()
          loginUrl.pathname = '/login'
          loginUrl.search = '?auth=recovery_required'
          const response = NextResponse.redirect(loginUrl)
          clearRecoveryMarker(response)
          return response
        }

        const cleanupUrl = request.nextUrl.clone()
        cleanupUrl.pathname = '/auth/cleanup'
        cleanupUrl.search = ''
        const response = NextResponse.redirect(cleanupUrl)
        clearRecoveryMarker(response)
        const cleanupMarkerSet = await setAuthCleanupMarker(response, { userId: user.id, destination: '/login?auth=recovery_required' })
        if (!cleanupMarkerSet) return failClosedCleanupResponse()
        return response
      }

      if (!isRecoveryAllowedPath(pathname)) {
        const updateUrl = request.nextUrl.clone()
        updateUrl.pathname = '/update-password'
        updateUrl.search = ''
        return NextResponse.redirect(updateUrl)
      }
    } else if (pathname === '/update-password' || pathname.startsWith('/update-password/')) {
      const loginUrl = request.nextUrl.clone()
      loginUrl.pathname = '/login'
      loginUrl.search = '?auth=recovery_required'
      return NextResponse.redirect(loginUrl)
    }
  }

  if (!user) {
    if (pathname.startsWith('/api/')) {
      if (!isExemptApiRequest(pathname, request.method)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    } else if (!isPublicPath(pathname)) {
      const loginUrl = request.nextUrl.clone()
      loginUrl.pathname = '/login'
      loginUrl.search = ''
      return NextResponse.redirect(loginUrl)
    }
  }

  return supabaseResponse
}

function failClosedCleanupResponse(): NextResponse {
  return NextResponse.json(
    { error: 'Authentication cleanup could not be completed safely. Refresh this page to retry.' },
    { status: 503 }
  )
}

export function isCleanupAllowedPath(pathname: string): boolean {
  if (pathname === '/auth/cleanup' || pathname.startsWith('/auth/cleanup/')) return true
  if (pathname === '/auth/callback' || pathname.startsWith('/auth/callback/')) return true
  if (pathname.startsWith('/_next/')) return true
  if (pathname === '/favicon.ico' || pathname === '/robots.txt') return true
  return false
}

export function isRecoveryAllowedPath(pathname: string): boolean {
  if (pathname === '/update-password' || pathname.startsWith('/update-password/')) return true
  if (pathname === '/auth/callback' || pathname.startsWith('/auth/callback/')) return true
  if (pathname.startsWith('/_next/')) return true
  if (pathname === '/favicon.ico' || pathname === '/robots.txt') return true
  return false
}
