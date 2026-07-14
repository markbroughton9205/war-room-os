import { NextResponse } from 'next/server'
import { readCommanderIdentityConfig } from '@/lib/security/commanderIdentity'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export type CommanderSession =
  | {
      ok: true
      userId: string
    }
  | {
      ok: false
      response: NextResponse
    }

export async function requireCommanderSession(actionLabel = 'War Room memory'): Promise<CommanderSession> {
  const commanderConfig = readCommanderIdentityConfig()
  if (!commanderConfig.ok) {
    return {
      ok: false,
      response: NextResponse.json({
        error: `${actionLabel} is unavailable because Commander identity is not configured.`,
      }, { status: 503 }),
    }
  }

  let userId: string | null = null
  try {
    const sessionClient = await createSupabaseServerClient()
    const { data, error } = await sessionClient.auth.getUser()
    if (!error && data.user?.id) userId = data.user.id
  } catch {
    userId = null
  }

  if (!userId) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Authenticated Commander session required.' }, { status: 401 }),
    }
  }

  if (userId !== commanderConfig.commanderUserId) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Commander session required.' }, { status: 403 }),
    }
  }

  return { ok: true, userId }
}
