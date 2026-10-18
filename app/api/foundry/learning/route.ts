import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { handleLearningRead } from '@/lib/recursive-learning/api'
import { defaultLearningLog } from '@/lib/recursive-learning/paths'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Phase 9 recursive-learning intelligence. READ-ONLY by design: GET only, no mutation, no policy/memory/routing writes. */
export async function GET(req: Request) {
  const commander = await requireCommanderSession('Foundry')
  if (!commander.ok) return commander.response
  const { status, body } = handleLearningRead(new URL(req.url), defaultLearningLog({ readOnly: true }))
  return NextResponse.json(body, { status })
}
