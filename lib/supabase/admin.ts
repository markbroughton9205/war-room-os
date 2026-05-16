import { createClient } from '@supabase/supabase-js'
import { SERVER_ONLY_SUPABASE_SECRET_LABEL, SUPABASE_SERVICE_ROLE_ENV } from '@/lib/security/sensitiveEnv'

/**
 * Server-only Supabase client using the service role JWT only.
 * Do not import this module from client components or shared code that ships to the browser.
 *
 * Uses `NEXT_PUBLIC_SUPABASE_URL` (project URL) and the server-only Supabase role secret only.
 * Never use `NEXT_PUBLIC_SUPABASE_ANON_KEY` here.
 */
function assertSupabaseUrl(url: string | undefined): asserts url is string {
  if (!url?.trim()) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured')
  }
}

function assertServiceRoleKeyShape(key: string | undefined): asserts key is string {
  if (!key?.trim()) {
    throw new Error(`${SERVER_ONLY_SUPABASE_SECRET_LABEL} is not configured`)
  }
  const parts = key.trim().split('.')
  if (parts.length !== 3) {
    throw new Error(
      `${SERVER_ONLY_SUPABASE_SECRET_LABEL} must be the JWT-style secret from Supabase (Project Settings API).`,
    )
  }
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { role?: string }
    const role = payload.role
    if (role && role !== 'service_role') {
      throw new Error(
        `${SERVER_ONLY_SUPABASE_SECRET_LABEL} must be the service_role secret from Supabase (Project Settings API), not the anon or publishable key.`,
      )
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith(`${SERVER_ONLY_SUPABASE_SECRET_LABEL} must be the service_role`)) {
      throw e
    }
    throw new Error(
      `${SERVER_ONLY_SUPABASE_SECRET_LABEL} could not be read; paste the full service_role secret from Supabase (Project Settings API).`,
    )
  }
}

export function createSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env[SUPABASE_SERVICE_ROLE_ENV]

  assertSupabaseUrl(supabaseUrl)
  assertServiceRoleKeyShape(serviceRoleKey)

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
