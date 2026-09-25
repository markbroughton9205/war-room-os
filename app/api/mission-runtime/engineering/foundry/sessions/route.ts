import { NextResponse } from 'next/server'
import { listFoundrySessions, pruneEmptyFoundrySessions, reuseOrCreateFoundrySession, isUntouchedEmptySession } from '@/lib/native-builder/foundrySessions'
import { runInResolvedWorkspace } from '@/lib/mission-runtime/withWorkspace'
import { commanderSessionLooksLikeSystemTest } from '@/lib/native-builder/foundryMissionVisibility'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const workspaceId = url.searchParams.get('workspaceId') ?? undefined
  const view = url.searchParams.get('view')
  const includeSystem = view === 'system'
  const archivedView = view === 'archived'
  const result = await runInResolvedWorkspace(workspaceId, async () => {
    await pruneEmptyFoundrySessions(workspaceId)
    const sessions = (await listFoundrySessions(workspaceId, {
      includeArchived: archivedView,
      archivedOnly: archivedView,
    })).filter(session => {
      if (archivedView) return session.archived === true && (includeSystem || !commanderSessionLooksLikeSystemTest(session.title, session.chat))
      if (!includeSystem && commanderSessionLooksLikeSystemTest(session.title, session.chat)) return false
      if (!includeSystem && isUntouchedEmptySession(session)) return false
      return true
    })
    return NextResponse.json({ sessions })
  })
  return result.ok ? result.value : result.response
}

export async function POST(req: Request) {
  let body: { title?: string; workspaceId?: string; projectName?: string } = {}
  try {
    const raw = await req.json()
    if (raw !== null && typeof raw === 'object') body = raw
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (!body.title?.trim()) return NextResponse.json({ error: 'title is required.' }, { status: 400 })
  const result = await runInResolvedWorkspace(body.workspaceId, async () => {
    const created = await reuseOrCreateFoundrySession({
      title: body.title!.trim(),
      workspaceId: body.workspaceId,
      projectName: body.projectName,
    })
    return NextResponse.json({ session: created.session, reused: created.reused })
  })
  return result.ok ? result.value : result.response
}
