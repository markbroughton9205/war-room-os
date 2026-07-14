import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { handleAuthCleanup } from '@/lib/auth/cleanupRoute'

export async function GET(req: NextRequest) {
  return handleAuthCleanup(req, { createSupabaseClient: createSupabaseServerClient })
}
