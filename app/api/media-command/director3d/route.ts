import { NextResponse } from 'next/server'
import { cloneProject } from '@/lib/media-command/types'
import { createProject, loadProject, saveProject } from '@/lib/media-command/store'
import { productionAuthorityOk, proveNoMutation } from '@/lib/media-command/production-ai'
import {
  apply3DRevision,
  build3DScene,
  direct3DFromPrompt,
  useThisScene,
} from '@/lib/media-command/director3d/contract'
import { parse3DPlanPatch } from '@/lib/media-command/director3d/patch'
import { activeScene, restoreSceneRevision } from '@/lib/media-command/director3d/persist'
import { buildPrevisResult } from '@/lib/media-command/director3d/blueprint'
import { loadDirector3DSession, saveDirector3DSession } from '@/lib/media-command/director3d/session'
import { attachCameraBridge } from '@/lib/media-command/director3d/camera-bridge'
import { auditBlender, HVS_GODOT_STATUS } from '@/lib/media-command/director3d/blender-audit'
import { applyDirectorRevision, buildScenePrevis, directScene, isDirectorOrchestrationPrompt, parseDirectorPlanPatch, useDirectorScene } from '@/lib/media-command/director/contract'
import { applyDirectorPlanPatch } from '@/lib/media-command/director/patch'
import { scenePlanFromDirector } from '@/lib/media-command/director/plan'
import { parse3DIntent } from '@/lib/media-command/director3d/intent'
import { DigitalHumanHVS } from '@/lib/media-command/digital-human/contract'
import { activeCinemaPlan } from '@/lib/media-command/cinema-director/persist'
import { bindCinemaPlanCameras } from '@/lib/media-command/cinema-director/scene-bind'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Director3DAction =
  | 'plan'
  | 'build'
  | 'revise'
  | 'apply-revision'
  | 'reject-revision'
  | 'use-scene'
  | 'restore-revision'

function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status })
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')
  if (!projectId) return jsonError('projectId is required.')
  const project = await loadProject(projectId)
  if (!project) return jsonError('Project not found.', 404)
  const session = await loadDirector3DSession(projectId)
  const scene = activeScene(project)
  const attached = scene ? DigitalHumanHVS.attachDirectorPerformance(project, scene) : null
  const plan = activeCinemaPlan(project)
  const boundScene = attached?.scene
    ? (plan ? bindCinemaPlanCameras(attached.scene, plan) : attached.scene)
    : scene
  return NextResponse.json({
    project,
    session,
    scene: boundScene,
    performanceTracks: attached?.tracks ?? [],
    previs: boundScene ? buildPrevisResult(boundScene) : null,
    cameraBridge: boundScene ? attachCameraBridge(boundScene) : null,
    blender: auditBlender(),
    godot: HVS_GODOT_STATUS,
  })
}

export async function POST(req: Request) {
  let body: {
    action?: Director3DAction
    projectId?: string
    prompt?: string
    projectName?: string
    revisionId?: string
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
      name: (body.projectName ?? body.prompt ?? '3D Director scene').trim().slice(0, 48) || '3D Director scene',
      productionMode: 'CUSTOM',
    })
  }

  if (action === 'plan') {
    const before = cloneProject(project)
    const prompt = body.prompt ?? ''
    if (isDirectorOrchestrationPrompt(prompt)) {
      const result = directScene(project, { prompt, projectId: project.id })
      const intent = parse3DIntent({ prompt, projectId: project.id })
      const scenePlan = scenePlanFromDirector(result.directorPlan)
      await saveDirector3DSession({
        projectId: project.id,
        intent,
        plan: scenePlan,
        patch: null,
        blueprint: null,
        directorPlan: result.directorPlan,
        directorPatch: null,
        directorPrevis: null,
        directorBlueprint: null,
        qc: null,
        updatedAt: new Date().toISOString(),
      })
      const after = await loadProject(project.id)
      const mutated = after ? !proveNoMutation(before, after) || JSON.stringify(before.director3d ?? null) !== JSON.stringify(after.director3d ?? null) : true
      return NextResponse.json({
        intent,
        plan: scenePlan,
        directorPlan: result.directorPlan,
        project: after ?? project,
        scene: activeScene(after ?? project),
        approvalRequired: true,
        mutated,
        approved: false,
      })
    }
    const result = direct3DFromPrompt(project, { prompt, projectId: project.id })
    await saveDirector3DSession({
      projectId: project.id,
      intent: result.intent,
      plan: result.scenePlan,
      patch: null,
      blueprint: null,
      directorPlan: null,
      directorPatch: null,
      updatedAt: new Date().toISOString(),
    })
    const after = await loadProject(project.id)
    const mutated = after ? !proveNoMutation(before, after) || JSON.stringify(before.director3d ?? null) !== JSON.stringify(after.director3d ?? null) : true
    return NextResponse.json({
      intent: result.intent,
      plan: result.scenePlan,
      project: after ?? project,
      scene: activeScene(after ?? project),
      approvalRequired: true,
      mutated,
      approved: false,
    })
  }

  const session = await loadDirector3DSession(project.id)

  if (action === 'build') {
    if (session?.directorPlan) {
      const built = buildScenePrevis(project, session.directorPlan, { approved: true })
      const saved = await saveProject(built.project)
      await saveDirector3DSession({
        ...session,
        plan: session.plan ? { ...session.plan, status: 'built' } : scenePlanFromDirector(built.plan),
        directorPlan: built.plan,
        directorPrevis: built.previs,
        qc: built.qc,
        updatedAt: new Date().toISOString(),
      })
      return NextResponse.json({
        intent: session.intent,
        plan: session.plan,
        directorPlan: built.plan,
        directorPrevis: built.previs,
        qc: built.qc,
        project: saved,
        scene: built.scene,
        previs: buildPrevisResult(built.scene),
        opsCount: built.opsCount,
        mutated: true,
        approved: true,
      })
    }
    if (!session?.intent || !session.plan) return jsonError('Create a 3D plan first.')
    const built = build3DScene(project, session.intent, session.plan, { approved: true })
    const saved = await saveProject(built.project)
    session.plan = { ...session.plan, status: 'built' }
    await saveDirector3DSession({ ...session, projectId: saved.id, updatedAt: new Date().toISOString() })
    return NextResponse.json({
      intent: session.intent,
      plan: session.plan,
      project: saved,
      scene: built.scene,
      previs: buildPrevisResult(built.scene),
      opsCount: built.opsCount,
      mutated: true,
      approved: true,
    })
  }

  if (action === 'revise') {
    const scene = activeScene(project)
    if (!body.prompt?.trim()) return jsonError('Tell me what you would like changed.')
    if (session?.directorPlan) {
      const directorPatch = parseDirectorPlanPatch(session.directorPlan, body.prompt)
      await saveDirector3DSession({
        ...session,
        directorPatch,
        updatedAt: new Date().toISOString(),
      })
      return NextResponse.json({
        project,
        scene,
        directorPlan: session.directorPlan,
        directorPatch,
        patch: {
          id: directorPatch.id,
          sceneId: scene?.id ?? session.directorPlan.sceneId,
          prompt: directorPatch.prompt,
          kinds: directorPatch.kinds,
          summaryLines: [directorPatch.summary, ...(directorPatch.directorChoice ? [directorPatch.directorChoice] : [])],
          status: 'proposed',
          approvalRequired: true,
          createdAt: directorPatch.createdAt,
        },
        mutated: false,
        approved: false,
      })
    }
    if (!scene) return jsonError('Build the scene first.')
    const patch = parse3DPlanPatch(scene, body.prompt)
    await saveDirector3DSession({
      projectId: project.id,
      intent: session?.intent ?? null,
      plan: session?.plan ?? null,
      patch,
      blueprint: session?.blueprint ?? null,
      directorPlan: session?.directorPlan ?? null,
      updatedAt: new Date().toISOString(),
    })
    return NextResponse.json({
      project,
      scene,
      patch,
      mutated: false,
      approved: false,
    })
  }

  if (action === 'reject-revision') {
    if (session) {
      await saveDirector3DSession({
        ...session,
        patch: session.patch ? { ...session.patch, status: 'rejected' } : null,
        updatedAt: new Date().toISOString(),
      })
    }
    return NextResponse.json({ project, scene: activeScene(project), mutated: false })
  }

  if (action === 'apply-revision') {
    if (session?.directorPlan && session.directorPatch && !activeScene(project)) {
      const nextPlan = applyDirectorPlanPatch(session.directorPlan, { ...session.directorPatch, status: 'applied' })
      await saveDirector3DSession({
        ...session,
        directorPlan: nextPlan,
        directorPatch: null,
        updatedAt: new Date().toISOString(),
      })
      return NextResponse.json({
        intent: session.intent,
        plan: session.plan,
        directorPlan: nextPlan,
        directorPatch: null,
        project,
        scene: null,
        mutated: false,
        approved: true,
      })
    }
    if (session?.directorPlan && session.directorPatch) {
      const applied = applyDirectorRevision(project, session.directorPlan, session.directorPatch, { approved: true })
      const saved = await saveProject(applied.project)
      await saveDirector3DSession({
        ...session,
        directorPlan: applied.plan,
        directorPatch: { ...session.directorPatch, status: 'applied' },
        directorPrevis: applied.previs,
        qc: applied.qc,
        plan: session.plan ? { ...session.plan, status: 'built' } : scenePlanFromDirector(applied.plan),
        updatedAt: new Date().toISOString(),
      })
      return NextResponse.json({
        project: saved,
        scene: applied.scene,
        directorPlan: applied.plan,
        directorPatch: { ...session.directorPatch, status: 'applied' },
        directorPrevis: applied.previs,
        qc: applied.qc,
        patch: { ...session.directorPatch, status: 'applied', summaryLines: [session.directorPatch.summary] },
        previs: buildPrevisResult(applied.scene),
        mutated: true,
        approved: true,
      })
    }
    if (!session?.patch) return jsonError('There is no 3D change waiting for approval.')
    const applied = apply3DRevision(project, session.patch, { approved: true })
    const saved = await saveProject(applied.project)
    await saveDirector3DSession({
      ...session,
      patch: { ...session.patch, status: 'applied' },
      updatedAt: new Date().toISOString(),
    })
    return NextResponse.json({
      project: saved,
      scene: applied.scene,
      patch: { ...session.patch, status: 'applied' },
      previs: buildPrevisResult(applied.scene),
      mutated: true,
      approved: true,
    })
  }

  if (action === 'use-scene') {
    if (session?.directorPlan && session.directorPrevis) {
      const used = useDirectorScene(project, session.directorPlan, session.directorPrevis)
      const saved = await saveProject(used.project)
      await saveDirector3DSession({
        ...session,
        directorPlan: { ...session.directorPlan, status: 'approved' },
        directorBlueprint: used.blueprint,
        updatedAt: new Date().toISOString(),
      })
      return NextResponse.json({
        project: saved,
        scene: activeScene(saved),
        directorPlan: { ...session.directorPlan, status: 'approved' },
        blueprint: used.blueprint,
        generatorAuthorized: false,
        mutated: true,
      })
    }
    const used = useThisScene(project)
    const saved = await saveProject(used.project)
    if (session) {
      await saveDirector3DSession({
        ...session,
        blueprint: used.blueprint,
        updatedAt: new Date().toISOString(),
      })
    }
    return NextResponse.json({
      project: saved,
      scene: activeScene(saved),
      blueprint: used.blueprint,
      generatorAuthorized: false,
      mutated: true,
    })
  }

  if (action === 'restore-revision') {
    if (!body.revisionId) return jsonError('revisionId is required.')
    const restored = restoreSceneRevision(project, body.revisionId)
    const saved = await saveProject(restored)
    return NextResponse.json({
      project: saved,
      scene: activeScene(saved),
      mutated: true,
    })
  }

  return jsonError('Unknown action.')
}
