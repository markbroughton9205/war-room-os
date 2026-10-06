import { NextResponse } from 'next/server'
import { cloneProject } from '@/lib/media-command/types'
import { createProject, loadProject, saveProject } from '@/lib/media-command/store'
import { productionAuthorityOk, proveNoMutation } from '@/lib/media-command/production-ai'
import {
  applyCinemaRevision,
  directCinemaFromPrompt,
  previewCinemaPlan,
  proposeCinemaRevision,
} from '@/lib/media-command/cinema-director/contract'
import { loadCinemaDirectorSession, saveCinemaDirectorSession } from '@/lib/media-command/cinema-director/session'
import { activeCinemaPlan } from '@/lib/media-command/cinema-director/persist'
import { activeScene } from '@/lib/media-command/director3d/persist'
import { buildPrevisResult } from '@/lib/media-command/director3d/blueprint'
import { compileCameraSpecForBackend } from '@/lib/media-command/cinema-director/provider'
import { attachCameraBridge } from '@/lib/media-command/director3d/camera-bridge'
import { DigitalHumanHVS } from '@/lib/media-command/digital-human/contract'
import { bindCinemaPlanCameras } from '@/lib/media-command/cinema-director/scene-bind'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type CinemaAction = 'plan' | 'preview' | 'revise' | 'apply-revision' | 'reject-revision' | 'use-shots'

function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status })
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')
  if (!projectId) return jsonError('projectId is required.')
  const project = await loadProject(projectId)
  if (!project) return jsonError('Project not found.', 404)
  const session = await loadCinemaDirectorSession(projectId)
  const plan = activeCinemaPlan(project) ?? session?.plan ?? null
  const scene = activeScene(project)
  const attached = scene ? DigitalHumanHVS.attachDirectorPerformance(project, scene) : null
  const boundScene = attached?.scene
    ? (plan ? bindCinemaPlanCameras(attached.scene, plan) : attached.scene)
    : scene
  return NextResponse.json({
    project,
    session,
    plan,
    scene: boundScene,
    performanceTracks: attached?.tracks ?? [],
    previs: boundScene ? buildPrevisResult(boundScene) : null,
    cameraBridge: boundScene ? attachCameraBridge(boundScene) : null,
    compiled: plan?.specs.map(spec => compileCameraSpecForBackend(spec, 'hvs-3d', {
      shot: plan.shots.find(item => item.cameraSpec.id === spec.id),
      path: plan.paths.find(item => item.shotId === plan.shots.find(shot => shot.cameraSpec.id === spec.id)?.id),
    })) ?? [],
  })
}

export async function POST(req: Request) {
  let body: {
    action?: CinemaAction
    projectId?: string
    prompt?: string
    projectName?: string
  } = {}
  try {
    body = await req.json() as typeof body
  } catch {
    return jsonError('I could not read that request.')
  }

  const authority = productionAuthorityOk()
  if (!authority.ok) return jsonError(authority.error, 403)

  const action = body.action ?? 'plan'
  let project = body.projectId ? await loadProject(body.projectId) : null
  if (!project) {
    project = await createProject({
      name: (body.projectName ?? body.prompt ?? 'Cinema sequence').trim().slice(0, 48) || 'Cinema sequence',
      productionMode: 'CUSTOM',
    })
  }

  if (action === 'plan') {
    const before = cloneProject(project)
    const result = directCinemaFromPrompt(project, { prompt: body.prompt ?? '', projectId: project.id })
    await saveCinemaDirectorSession({
      projectId: project.id,
      intent: result.intent,
      plan: result.plan,
      patch: null,
      updatedAt: new Date().toISOString(),
    })
    const after = await loadProject(project.id)
    const mutated = after
      ? !proveNoMutation(before, after)
        || JSON.stringify(before.cinemaDirector ?? null) !== JSON.stringify(after.cinemaDirector ?? null)
        || JSON.stringify(before.director3d ?? null) !== JSON.stringify(after.director3d ?? null)
      : true
    return NextResponse.json({
      intent: result.intent,
      plan: result.plan,
      project: after ?? project,
      scene: activeScene(after ?? project),
      approvalRequired: true,
      mutated,
      approved: false,
    })
  }

  const session = await loadCinemaDirectorSession(project.id)
  if (action === 'preview') {
    if (!session?.intent || !session.plan) return jsonError('Create a cinema plan first.')
    const built = previewCinemaPlan(project, session.intent, session.plan, { approved: true })
    const saved = await saveProject(built.project)
    await saveCinemaDirectorSession({ ...session, plan: built.plan, projectId: saved.id, updatedAt: new Date().toISOString() })
    return NextResponse.json({
      intent: session.intent,
      plan: built.plan,
      project: saved,
      scene: built.scene,
      previs: buildPrevisResult(built.scene),
      mutated: true,
      approved: true,
    })
  }

  if (action === 'revise') {
    const plan = session?.plan ?? activeCinemaPlan(project)
    if (!plan) return jsonError('Create a cinema plan first.')
    const patch = proposeCinemaRevision(plan, body.prompt ?? '')
    if (session) await saveCinemaDirectorSession({ ...session, patch, updatedAt: new Date().toISOString() })
    return NextResponse.json({
      intent: session?.intent ?? null,
      plan,
      patch,
      project,
      scene: activeScene(project),
      approvalRequired: true,
      mutated: false,
    })
  }

  if (action === 'apply-revision') {
    if (!session?.intent || !session.plan || !session.patch) return jsonError('Propose a camera change first.')
    const revised = applyCinemaRevision(project, session.intent, session.plan, session.patch, { approved: true })
    const saved = await saveProject(revised.project)
    await saveCinemaDirectorSession({
      ...session,
      plan: revised.plan,
      patch: { ...session.patch, status: 'applied' },
      updatedAt: new Date().toISOString(),
    })
    return NextResponse.json({
      intent: session.intent,
      plan: revised.plan,
      patch: { ...session.patch, status: 'applied' },
      project: saved,
      scene: revised.scene,
      mutated: true,
      approved: true,
    })
  }

  if (action === 'reject-revision') {
    if (session) await saveCinemaDirectorSession({ ...session, patch: session.patch ? { ...session.patch, status: 'rejected' } : null, updatedAt: new Date().toISOString() })
    return NextResponse.json({
      intent: session?.intent ?? null,
      plan: session?.plan ?? null,
      patch: null,
      project,
      scene: activeScene(project),
      mutated: false,
    })
  }

  if (action === 'use-shots') {
    if (!session?.intent || !session.plan) return jsonError('Create a cinema plan first.')
    const built = session.plan.status === 'built'
      ? { project, scene: activeScene(project), plan: session.plan }
      : previewCinemaPlan(project, session.intent, session.plan, { approved: true })
    if (!built.scene) return jsonError('Preview the shots first.')
    const saved = built.project.id === project.id && session.plan.status === 'built' ? project : await saveProject(built.project)
    return NextResponse.json({
      intent: session.intent,
      plan: built.plan,
      project: saved,
      scene: built.scene,
      mutated: session.plan.status !== 'built',
      approved: true,
    })
  }

  return jsonError('Unknown cinema action.')
}
