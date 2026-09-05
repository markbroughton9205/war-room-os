import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { wrEngineerSessionStore } from '@/lib/wr-engineer/session/store'
import { getIssue, getRepair } from '@/lib/native-builder/storage'

export const dynamic = 'force-dynamic'

/**
 * Read-only detail for the session's bridged Native Builder repair (if any) — the "Proposed
 * Changes" panel's diff/policy/validation source. Never gates or exposes anything native-builder's
 * own `/api/native-builder/repairs/{id}` route doesn't already return to a Commander; this route
 * exists only so the WR-Engineer UI doesn't need to know the repair id ahead of time (it reads it
 * off the session) and so the response stays scoped to sessions this Commander owns.
 */
export async function GET(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const session = await requireCommanderSession('WR-Engineer repair detail')
  if (!session.ok) return session.response

  const { sessionId } = await params
  const record = await wrEngineerSessionStore.getSession(sessionId)
  if (!record || record.commanderUserId !== session.userId) {
    return NextResponse.json({ error: 'Session not found.' }, { status: 404 })
  }
  if (!record.nativeBuilderRepairId) {
    return NextResponse.json({ repair: null, issue: null })
  }

  const [repair, issue] = await Promise.all([
    getRepair(record.nativeBuilderRepairId),
    record.nativeBuilderIssueId ? getIssue(record.nativeBuilderIssueId) : Promise.resolve(null),
  ])

  return NextResponse.json({ repair, issue })
}
