import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

/**
 * Server-only Supabase client using the anon key, session-aware via cookies.
 * This is the operator's own identity (once logged in), distinct from
 * lib/supabase/admin.ts's service-role client, which is War Room's server
 * identity to Supabase and unrelated to end-user auth.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Called from a Server Component render, where cookies can't be
            // mutated. Harmless — middleware refreshes the session cookie on
            // every request instead.
          }
        },
      },
    },
  )
}
