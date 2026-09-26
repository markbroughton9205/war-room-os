import { NextResponse } from 'next/server'
import { archiveFoundrySession, appendFoundryChat, getFoundrySession, renameFoundrySession, restoreFoundrySession } from '@/lib/native-builder/foundrySessions'
import { getMissionExecutionStrategy } from '@/lib/mission-runtime'
import { runInResolvedWorkspace } from '@/lib/mission-runtime/withWorkspace'
import { listWorkspaces } from '@/lib/native-builder/workspaceRegistry'
import { campaignShouldOwn } from '@/lib/native-builder/foundryEngineeringCampaign'
import { contextShouldOwn } from '@/lib/native-builder/foundryProjectContextIO'
import { resolveRepoRoot } from '@/lib/repo/paths'
import {
  WAR_ROOM_CANONICAL_WORKSPACE_ID,
  decorateWorkspaceIdentity,
  getCanonicalWarRoomSourceRoot,
  hasGeneratedWarRoomOsNameCollision,
  resolveFoundryMissionWorkspace,
} from '@/lib/native-builder/foundryWorkspaceIdentity'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const workspaceId = new URL(req.url).searchParams.get('workspaceId') ?? undefined
  const result = await runInResolvedWorkspace(workspaceId, async () => {
    const session = await getFoundrySession(id)
    if (!session) return NextResponse.json({ error: 'Session not found.' }, { status: 404 })
    return NextResponse.json({ session })
  })
  return result.ok ? result.value : result.response
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  let body: { title?: string; workspaceId?: string; archived?: boolean } = {}
  try {
    const raw = await req.json()
    if (raw !== null && typeof raw === 'object') body = raw
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (body.archived === true && typeof body.title === 'string') {
    return NextResponse.json({ error: 'Rename and archive cannot be combined in one request.', code: 'MIXED_PATCH' }, { status: 400 })
  }
  const workspaceId = body.workspaceId ?? new URL(req.url).searchParams.get('workspaceId') ?? undefined
  const result = await runInResolvedWorkspace(workspaceId, async () => {
    if (body.archived === true) {
      const archived = await archiveFoundrySession(id, { archived: true, archivedBy: 'local-commander' })
      if (!archived.ok) {
        const status = archived.code === 'NOT_FOUND' ? 404 : archived.code === 'ACTIVE_MISSION' ? 409 : 400
        return NextResponse.json({ error: archived.error, code: archived.code }, { status })
      }
      return NextResponse.json({ session: archived.session, alreadyArchived: archived.alreadyArchived })
    }
    if (body.archived === false) {
      const restored = await restoreFoundrySession(id)
      if (!restored.ok) {
        const status = restored.code === 'NOT_FOUND' ? 404 : 400
        return NextResponse.json({ error: restored.error, code: restored.code }, { status })
      }
      return NextResponse.json({ session: restored.session, alreadyRestored: restored.alreadyRestored })
    }
    if (typeof body.title !== 'string') {
      return NextResponse.json({ error: 'title or archived:true is required.', code: 'INVALID' }, { status: 400 })
    }
    const renamed = await renameFoundrySession(id, body.title)
    if (!renamed.ok) {
      const status = renamed.code === 'NOT_FOUND' ? 404 : 400
      return NextResponse.json({ error: renamed.error, code: renamed.code }, { status })
    }
    return NextResponse.json({ session: renamed.session })
  })
  return result.ok ? result.value : result.response
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  let body: { text?: string; workspaceId?: string; waitForCompletion?: boolean; confirmedWorkspaceId?: string } = {}
  try {
    const raw = await req.json()
    if (raw !== null && typeof raw === 'object') body = raw
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (!body.text?.trim()) return NextResponse.json({ error: 'text is required.' }, { status: 400 })

  const workspaces = await listWorkspaces()
  const resolved = resolveFoundryMissionWorkspace({
    request: body.text.trim(),
    requestedWorkspaceId: body.workspaceId,
    generatedCollisionExists: hasGeneratedWarRoomOsNameCollision(workspaces),
    confirmedWorkspaceId: body.confirmedWorkspaceId,
  })
  if (resolved.kind === 'confirm') {
    const canonical = decorateWorkspaceIdentity({
      id: WAR_ROOM_CANONICAL_WORKSPACE_ID,
      root: getCanonicalWarRoomSourceRoot(),
    })
    return NextResponse.json({
      needsConfirmation: true,
      target: {
        title: 'War Room Canonical Source',
        displayTitle: canonical.displayTitle,
        displayKind: canonical.displayKind,
        path: canonical.root,
        workspaceId: WAR_ROOM_CANONICAL_WORKSPACE_ID,
      },
      reason: resolved.reason,
    }, { status: 409 })
  }

  const requestedWorkspaceId = resolved.kind === 'canonical'
    ? WAR_ROOM_CANONICAL_WORKSPACE_ID
    : (resolved.workspaceId ?? body.workspaceId)
  const existing = await getFoundrySession(id)
  const workspaceId = existing?.workspaceId || requestedWorkspaceId

  const result = await runInResolvedWorkspace(workspaceId, async () => {
    const session = await getFoundrySession(id)
    if (!session) return NextResponse.json({ error: 'Session not found.' }, { status: 404 })
    await appendFoundryChat(id, 'COMMANDER', body.text!.trim())
    const strategy = getMissionExecutionStrategy('engineering')
    const text = body.text!.trim()
    const mission = await strategy.create({
      title: text.slice(0, 80),
      description: text,
      naturalLanguage: text,
      subsystem: 'project',
      executionMode: 'bounded_coding',
      // A request the campaign owns (by its API/UI shape, or because discovery grounds it in the project) is carried out by model-driven specialists.
      specialistIntelligence: campaignShouldOwn(text) || await contextShouldOwn(resolveRepoRoot(), text) ? 'model' : undefined,
      autoRun: true,
      waitForCompletion: body.waitForCompletion === true,
      sessionId: id,
    })
    return NextResponse.json({ session: await getFoundrySession(id), mission })
  })
  return result.ok ? result.value : result.response
}
