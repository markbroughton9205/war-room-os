import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseSignupInvitationAuthority } from '@/lib/signup-invitations'
import { handleAuthCallback } from '@/lib/auth/callbackRoute'

export async function GET(req: NextRequest) {
  return handleAuthCallback(req, {
    createSupabaseClient: createSupabaseServerClient,
    createInvitationAuthority: createSupabaseSignupInvitationAuthority,
  })
}
