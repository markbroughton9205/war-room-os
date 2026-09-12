import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { isSafeRedirectPath } from '@/lib/auth/redirect'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { LoginForm } from '@/components/auth/LoginForm'
import { LocalCommanderLoginPanel } from '@/components/auth/LocalCommanderLoginPanel'
import { isLoopbackRequestHost } from '@/lib/sovereign-runtime/session'
import {
  LOCAL_SESSION_COOKIE,
  extractBearerOrCookieToken,
  getLocalOwnershipStore,
} from '@/lib/sovereign-runtime/local-ownership'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next: rawNext } = await searchParams
  const next = typeof rawNext === 'string' && isSafeRedirectPath(rawNext) ? rawNext : '/'

  const h = await headers()
  const host = h.get('host')
  const loopback = isLoopbackRequestHost(host)

  // Local Commander session on loopback — enter War Room without Supabase
  if (loopback) {
    try {
      const store = getLocalOwnershipStore(process.env.WAR_ROOM_LOCAL_DATA_DIR ?? null)
      const token = extractBearerOrCookieToken({
        authorization: h.get('authorization'),
        cookieHeader: h.get('cookie'),
        cookieName: LOCAL_SESSION_COOKIE,
      })
      if (store.verifySessionToken(token)) {
        redirect(next)
      }
    } catch {
      /* continue to login UI */
    }
  }

  let remoteUser: { id: string } | null = null
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    remoteUser = user
  } catch {
    remoteUser = null
  }

  if (remoteUser) {
    redirect(next)
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-black px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold tracking-widest" style={{ color: '#FFD700' }}>⚔ WAR ROOM</h1>
          <p className="mt-1 text-xs tracking-widest" style={{ color: '#444' }}>RA&apos;EL — HIGHER VISION INC</p>
        </div>

        {loopback ? <LocalCommanderLoginPanel next={next} /> : null}

        <div className={loopback ? 'mt-8' : ''}>
          {loopback ? (
            <p className="mb-3 text-center text-[10px] font-bold tracking-widest" style={{ color: '#666' }}>
              REMOTE ACCOUNT (SUPABASE)
            </p>
          ) : null}
          <LoginForm next={next} />
        </div>
      </div>
    </main>
  )
}
