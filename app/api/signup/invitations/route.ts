import { NextResponse } from 'next/server'
import { assertLiveActionsAllowed } from '@/lib/security/actionRoutePolicy'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { createSupabaseSignupInvitationAuthority } from '@/lib/signup-invitations'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const environmentBlocked = assertLiveActionsAllowed()
  if (environmentBlocked) return environmentBlocked

  const commander = await requireCommanderSession('Signup invitation creation')
  if (!commander.ok) return commander.response

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const record = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
  const email = typeof record.email === 'string' ? record.email : ''
  const ttlHours = typeof record.ttlHours === 'number' ? record.ttlHours : undefined

  const authority = createSupabaseSignupInvitationAuthority()
  const result = await authority.createInvitation({
    email,
    ttlHours,
    createdByUserId: commander.userId,
  })

  if (!result.ok) {
    const status = result.reason === 'invalid_email' ? 400 : 503
    return NextResponse.json({
      ok: false,
      error: result.reason === 'invalid_email' ? 'Invalid invitation email.' : 'Invitation creation unavailable.',
      reason: result.reason,
    }, { status })
  }

  return NextResponse.json({
    ok: true,
    invitationId: result.invitation.invitation_id,
    email: result.invitation.normalized_email,
    status: result.invitation.status,
    expiresAt: result.invitation.expires_at,
    inviteUrl: result.inviteUrl,
  }, { status: 201 })
}
