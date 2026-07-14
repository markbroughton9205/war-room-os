import { createBrowserClient } from '@supabase/ssr'

/**
 * Browser-only Supabase client using the anon key. Session cookies are
 * managed by @supabase/ssr and kept in sync with the server via
 * lib/supabase/middleware.ts on every request.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        detectSessionInUrl: false,
      },
    },
  )
}
