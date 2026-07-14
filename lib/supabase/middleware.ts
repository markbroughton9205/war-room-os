import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/login', '/signup', '/auth/callback']

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(path => pathname === path || pathname.startsWith(`${path}/`))
}

// Routes that already enforce their own authorization (shared secret, Twilio
// sender check, or — for grok/chat + payments/deposits + payments/proof —
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
  '/api/sms/inbound',
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

  if (!user) {
    const { pathname } = request.nextUrl

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
