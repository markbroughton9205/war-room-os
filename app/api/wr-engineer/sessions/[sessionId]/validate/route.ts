import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { wrEngineerSessionStore } from '@/lib/wr-engineer/session/store'
import { recordToolActivity } from '@/lib/wr-engineer/session/session'
import { runGitDiffCheck } from '@/lib/wr-engineer/validation'
import { logWrEngineerAudit } from '@/lib/wr-engineer/audit'

export const dynamic = 'force-dynamic'

/**
 * Runs a single bounded, allow-listed validation operation (git_diff_check — see
 * lib/native-builder/validationRunner.ts) against the server's own repository and records it as an
 * observable tool-activity event on the session. Deliberately fixed to one fast, safe operation for
 * this Phase 2 UI action; the full typecheck/lint/build/test surface is already available via
 * lib/wr-engineer/validation.ts for a future, more complete validation panel.
 */
export async function POST(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const session = await requireCommanderSession('WR-Engineer validation')
  if (!session.ok) return session.response

  const { sessionId } = await params
  const existing = await wrEngineerSessionStore.getSession(sessionId)
  if (!existing || existing.commanderUserId !== session.userId) {
    return NextResponse.json({ error: 'Session not found.' }, { status: 404 })
  }

  const result = await runGitDiffCheck()
  await recordToolActivity(wrEngineerSessionStore, sessionId, 'RUN_VALIDATION', 'git_diff_check', result.ok ? 'PASS' : 'FAIL')
  await logWrEngineerAudit('validation run from WR-Engineer session', { sessionId, operation: 'git_diff_check', ok: result.ok })

  return NextResponse.json({ result })
}
