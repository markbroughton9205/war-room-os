import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static, _next/image (build assets)
     * - /cesium/ (CesiumJS vendor static runtime copied to public/cesium)
     * - favicon.ico and other static file extensions
     * - /api/health (public liveness; must not await Supabase session refresh)
     * API routes ARE included — lib/supabase/middleware.ts enforces the
     * session gate on them too, with its own exemption list for routes that
     * carry their own authorization (see PUBLIC_API_PATHS/PREFIXES there).
     */
    '/((?!_next/static|_next/image|favicon.ico|api/health|cesium/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
