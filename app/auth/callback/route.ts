import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseSignupInvitationAuthority } from '@/lib/signup-invitations'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const origin = url.origin

  if (!code) {
    return NextResponse.redirect(`${origin}/login?auth=missing_code`)
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(`${origin}/login?auth=invalid_callback`)
  }

  const { data, error: userError } = await supabase.auth.getUser()
  const user = data.user
  const email = user?.email
  if (userError || !user?.id || !email) {
    return NextResponse.redirect(`${origin}/login?auth=unverified`)
  }

  const invitationAuthority = createSupabaseSignupInvitationAuthority()
  const confirmation = await invitationAuthority.confirmAccountForVerifiedUser(email, user.id)
  if (!confirmation.ok) {
    return NextResponse.redirect(`${origin}/login?auth=invitation_mismatch`)
  }

  return NextResponse.redirect(`${origin}/login?confirmed=1`)
}
