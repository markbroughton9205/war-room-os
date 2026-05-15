import { createClient } from '@supabase/supabase-js'

/**
 * Server-only Supabase client using the service role JWT only.
 * Do not import this module from client components or shared code that ships to the browser.
 *
 * Uses `NEXT_PUBLIC_SUPABASE_URL` (project URL) and `SUPABASE_SERVICE_ROLE_KEY` only.
 * Never use `NEXT_PUBLIC_SUPABASE_ANON_KEY` here.
 */
function assertSupabaseUrl(url: string | undefined): asserts url is string {
  if (!url?.trim()) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured')
  }
}

function assertServiceRoleKeyShape(key: string | undefined): asserts key is string {
  if (!key?.trim()) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured')
  }
  const parts = key.trim().split('.')
  if (parts.length !== 3) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY must be the JWT-style secret from Supabase (Project Settings → API).',
    )
  }
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { role?: string }
    const role = payload.role
    if (role && role !== 'service_role') {
      throw new Error(
        'SUPABASE_SERVICE_ROLE_KEY must be the service_role secret from Supabase (Project Settings → API), not the anon or publishable key.',
      )
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('SUPABASE_SERVICE_ROLE_KEY must be the service_role')) {
      throw e
    }
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY could not be read; paste the full service_role secret from Supabase (Project Settings → API).',
    )
  }
}

export function createSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  assertSupabaseUrl(supabaseUrl)
  assertServiceRoleKeyShape(serviceRoleKey)

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
