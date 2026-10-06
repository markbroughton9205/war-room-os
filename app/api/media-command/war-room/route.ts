import { NextResponse } from 'next/server'
import { loadProject, createProject, saveProject } from '@/lib/media-command/store'
import {
  emptyProductionSession,
  loadProductionSession,
  saveProductionSession,
} from '@/lib/media-command/production-session'
import { HVS } from '@/lib/media-command/hvs-producer-contract'
import {
  createWarRoomPlan,
  detectHvsProductionIntent,
  emptyUnroutedPacket,
  normalizeWarRoomMediaRefs,
  packetFromPlan,
  packetFromRevision,
  packetFrom3DPlan,
  packetFromCinemaPlan,
  packetFromDirectorPlan,
  packetFromDirectorPatch,
  packetFromActorDirection,
} from '@/lib/media-command/war-room-hvs'
import type { HvsWarRoomPacket } from '@/lib/media-command/war-room-hvs-intent'
import { loadWarRoomBinding, saveWarRoomBinding } from '@/lib/media-command/war-room-hvs-session'
import { asrGateStatus } from '@/lib/media-command/asr-gate'
import { POST as producePost } from '../produce/route'
import { loadDirector3DSession, saveDirector3DSession } from '@/lib/media-command/director3d/session'
import { build3DScene } from '@/lib/media-command/director3d/contract'
import { activeScene } from '@/lib/media-command/director3d/persist'
import { loadCinemaDirectorSession, saveCinemaDirectorSession } from '@/lib/media-command/cinema-director/session'
import { previewCinemaPlan } from '@/lib/media-command/cinema-director/contract'
import { applyDirectorRevision, buildScenePrevis, parseDirectorPlanPatch } from '@/lib/media-command/director/contract'
import { isDirectorFollowUp, isDirectorOrchestrationPrompt } from '@/lib/media-command/director/parse'
import { scenePlanFromDirector } from '@/lib/media-command/director/plan'
import { parse3DIntent } from '@/lib/media-command/director3d/intent'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status })
}

export async function POST(req: Request) {
  let body: {
    action?: 'route' | 'plan' | 'approve' | 'retry' | 'revise' | 'apply-revision' | 'reject-revision' | 'render' | 'create-versions'
    prompt?: string
    utterance?: string
    projectId?: string
    conversationId?: string
    sourceAssetIds?: string[]
    warRoomFileIds?: string[]
    localPaths?: string[]
  } = {}
  try {
    body = await req.json() as typeof body
  } catch {
    return jsonError('I could not read that request.')
  }

  const action = body.action ?? 'route'
  const media = normalizeWarRoomMediaRefs({
    sourceAssetIds: body.sourceAssetIds,
    warRoomFileIds: body.warRoomFileIds,
    localPaths: body.localPaths,
  })

  if (action === 'route' || action === 'plan') {
    const binding = await loadWarRoomBinding(body.conversationId)
    const existingId = body.projectId ?? binding?.projectId ?? null
    let project = existingId ? await loadProject(existingId) : null
    const session = project ? await loadProductionSession(project.id) : null
    const hasActive = Boolean(session?.plan)
    const kind = detectHvsProductionIntent(body.prompt ?? body.utterance ?? '', hasActive)
    const promptText = body.prompt ?? body.utterance ?? ''
    const existingDirector = existingId ? await loadDirector3DSession(existingId) : null
    if (kind !== 'actors' && existingDirector?.directorPlan && isDirectorFollowUp(promptText) && !isDirectorOrchestrationPrompt(promptText)) {
      const directorPatch = parseDirectorPlanPatch(existingDirector.directorPlan, promptText)
      await saveDirector3DSession({ ...existingDirector, directorPatch, updatedAt: new Date().toISOString() })
      return NextResponse.json({
        packet: packetFromDirectorPatch(existingDirector.directorPlan, directorPatch, existingDirector.projectId, body.conversationId ?? null),
        project,
        mutated: false,
      })
    }
    if (kind === 'none') {
      return NextResponse.json({ packet: emptyUnroutedPacket(), mutated: false })
    }
    if (kind === 'actors') {
      if (!project) {
        return NextResponse.json({
          packet: packetFromActorDirection({
            projectId: null,
            conversationId: body.conversationId ?? null,
            summaryLines: ['Open the current Higher Vision Studios production, then cast again.'],
            needsProject: true,
          }),
          mutated: false,
        })
      }
      try {
        const directed = HVS.directPerformance(project, promptText, 'commander')
        await saveProject(project)
        return NextResponse.json({
          packet: packetFromActorDirection({
            projectId: project.id,
            conversationId: body.conversationId ?? null,
            summaryLines: [directed.summary],
            needsProject: false,
          }),
          project,
          mutated: true,
        })
      } catch (error) {
        return jsonError(error instanceof Error ? error.message : 'HVS could not direct that.')
      }
    }
    if (kind !== 'director3d' && kind !== 'cinema' && media.rejectedPaths.length) {
      return jsonError('HVS needs ingested project media, not raw computer paths. Attach the clips in Higher Vision Studios first.')
    }
    if (!project) {
      const created = await createProject({
        name: (body.prompt ?? (kind === 'cinema' ? 'Cinema sequence' : kind === 'director3d' ? '3D Director scene' : 'War Room video')).trim().slice(0, 48) || (kind === 'cinema' ? 'Cinema sequence' : kind === 'director3d' ? '3D Director scene' : 'War Room video'),
        productionMode: kind === 'director3d' || kind === 'cinema' ? 'CUSTOM' : 'SOCIAL',
      })
      project = created
    }
    if (!media.sourceAssetIds.length) {
      media.sourceAssetIds = project.assets
        .filter(asset => (asset.kind === 'video' || asset.kind === 'audio') && !asset.generated)
        .map(asset => asset.id)
    }
    if (body.conversationId) await saveWarRoomBinding(body.conversationId, project.id)

    if (kind === 'cinema') {
      const planned = HVS.directCinemaFromPrompt(project, { prompt: body.prompt ?? '', projectId: project.id })
      await saveCinemaDirectorSession({
        projectId: project.id,
        intent: planned.intent,
        plan: planned.plan,
        patch: null,
        updatedAt: new Date().toISOString(),
      })
      return NextResponse.json({
        packet: packetFromCinemaPlan(planned, body.conversationId ?? null),
        project,
        mutated: false,
      })
    }

    if (kind === 'director3d') {
      if (isDirectorOrchestrationPrompt(body.prompt ?? '')) {
        const planned = HVS.directScene(project, { prompt: body.prompt ?? '', projectId: project.id })
        const intent = parse3DIntent({ prompt: body.prompt ?? '', projectId: project.id })
        const scenePlan = scenePlanFromDirector(planned.directorPlan)
        await saveDirector3DSession({
          projectId: project.id,
          intent,
          plan: scenePlan,
          patch: null,
          blueprint: null,
          directorPlan: planned.directorPlan,
          directorPatch: null,
          updatedAt: new Date().toISOString(),
        })
        return NextResponse.json({
          packet: packetFromDirectorPlan(planned, body.conversationId ?? null),
          project,
          mutated: false,
        })
      }
      const planned = HVS.direct3DFromPrompt(project, { prompt: body.prompt ?? '', projectId: project.id })
      await saveDirector3DSession({
        projectId: project.id,
        intent: planned.intent,
        plan: planned.scenePlan,
        patch: null,
        blueprint: null,
        updatedAt: new Date().toISOString(),
      })
      return NextResponse.json({
        packet: packetFrom3DPlan(planned, body.conversationId ?? null),
        project,
        mutated: false,
      })
    }

    if (kind === 'revision' || kind === 'captions' || kind === 'variants') {
      const liveSession = session ?? emptyProductionSession({
        ...((await loadProductionSession(project.id))?.intent ?? HVS.createFromPrompt(project, {
          prompt: body.prompt ?? body.utterance ?? '',
          projectId: project.id,
          sourceAssetIds: media.sourceAssetIds,
        }).intent),
      })
      if (!liveSession.plan) {
        const planned = createWarRoomPlan(project, { prompt: body.prompt ?? '', sourceAssetIds: media.sourceAssetIds })
        liveSession.plan = planned.plan
        liveSession.intent = planned.intent
        await saveProductionSession(liveSession)
        const packet = packetFromPlan(planned, body.conversationId ?? null)
        return NextResponse.json({ packet, session: liveSession, project, mutated: false })
      }
      const packet = packetFromRevision(project, liveSession, body.prompt ?? body.utterance ?? '', body.conversationId ?? null)
      liveSession.pendingPatch = packet.patch
      liveSession.pendingRevision = packet.patch
        ? {
            id: packet.patch.revisionId,
            projectId: project.id,
            planId: liveSession.plan.id,
            utterance: body.prompt ?? body.utterance ?? '',
            createdAt: new Date().toISOString(),
            status: 'proposed',
          }
        : null
      liveSession.warRoomConversationId = body.conversationId ?? null
      await saveProductionSession(liveSession)
      return NextResponse.json({ packet, session: liveSession, project, mutated: false })
    }

    const planned = createWarRoomPlan(project, {
      prompt: body.prompt ?? '',
      sourceAssetIds: media.sourceAssetIds,
    })
    const nextSession = emptyProductionSession(planned.intent)
    nextSession.plan = planned.plan
    nextSession.warRoomConversationId = body.conversationId ?? null
    nextSession.asrStatus = asrGateStatus().status
    await saveProductionSession(nextSession)
    return NextResponse.json({
      packet: packetFromPlan(planned, body.conversationId ?? null),
      session: nextSession,
      project,
      mutated: false,
      media,
    })
  }

  const bound = await loadWarRoomBinding(body.conversationId)
  const projectId = body.projectId ?? bound?.projectId
  if (!projectId) return jsonError('A project is required.')

  if (action === 'apply-revision' || action === 'approve') {
    const d3Patch = await loadDirector3DSession(projectId)
    if (d3Patch?.directorPatch && d3Patch.directorPlan && d3Patch.directorPatch.status === 'proposed') {
      const live = await loadProject(projectId)
      if (!live) return jsonError('Project not found.', 404)
      const applied = applyDirectorRevision(live, d3Patch.directorPlan, d3Patch.directorPatch, { approved: true })
      const saved = await saveProject(applied.project)
      await saveDirector3DSession({
        ...d3Patch,
        directorPlan: applied.plan,
        directorPatch: { ...d3Patch.directorPatch, status: 'applied' },
        directorPrevis: applied.previs,
        qc: applied.qc,
        plan: d3Patch.plan ? { ...d3Patch.plan, status: 'built' } : scenePlanFromDirector(applied.plan),
        updatedAt: new Date().toISOString(),
      })
      return NextResponse.json({
        packet: {
          ...packetFromDirectorPlan({ directorPlan: applied.plan, projectId: saved.id }, body.conversationId ?? null),
          approvalRequired: false,
          progressHint: applied.plan.shots.map(shot => `${shot.order}. ${shot.commanderLabel}`).join('\n'),
        },
        project: saved,
        scene: applied.scene,
        mutated: true,
        approved: true,
      })
    }
  }

  if (action === 'approve') {
    const cinema = await loadCinemaDirectorSession(projectId)
    if (cinema?.intent && cinema.plan && cinema.plan.status !== 'built') {
      const live = await loadProject(projectId)
      if (!live) return jsonError('Project not found.', 404)
      const built = previewCinemaPlan(live, cinema.intent, cinema.plan, { approved: true })
      const saved = await saveProject(built.project)
      await saveCinemaDirectorSession({ ...cinema, plan: built.plan, updatedAt: new Date().toISOString() })
      return NextResponse.json({
        packet: {
          ...packetFromCinemaPlan({ intent: cinema.intent, plan: built.plan, projectId: saved.id }, body.conversationId ?? null),
          approvalRequired: false,
          progressHint: 'The shot previs is ready. Open Camera to play it.',
        },
        project: saved,
        scene: built.scene,
        mutated: true,
        approved: true,
      })
    }
    const d3 = await loadDirector3DSession(projectId)
    if (d3?.directorPatch && d3.directorPlan && d3.directorPatch.status === 'proposed') {
      const live = await loadProject(projectId)
      if (!live) return jsonError('Project not found.', 404)
      const applied = applyDirectorRevision(live, d3.directorPlan, d3.directorPatch, { approved: true })
      const saved = await saveProject(applied.project)
      await saveDirector3DSession({
        ...d3,
        directorPlan: applied.plan,
        directorPatch: { ...d3.directorPatch, status: 'applied' },
        directorPrevis: applied.previs,
        qc: applied.qc,
        plan: d3.plan ? { ...d3.plan, status: 'built' } : scenePlanFromDirector(applied.plan),
        updatedAt: new Date().toISOString(),
      })
      return NextResponse.json({
        packet: {
          ...packetFromDirectorPlan({ directorPlan: applied.plan, projectId: saved.id }, body.conversationId ?? null),
          approvalRequired: false,
          progressHint: applied.plan.shots.map(shot => `${shot.order}. ${shot.commanderLabel}`).join('\n'),
        },
        project: saved,
        scene: applied.scene,
        mutated: true,
        approved: true,
      })
    }
    if (d3?.directorPlan && d3.directorPlan.status === 'proposed') {
      const live = await loadProject(projectId)
      if (!live) return jsonError('Project not found.', 404)
      const built = buildScenePrevis(live, d3.directorPlan, { approved: true })
      const saved = await saveProject(built.project)
      await saveDirector3DSession({
        ...d3,
        directorPlan: built.plan,
        directorPrevis: built.previs,
        qc: built.qc,
        plan: d3.plan ? { ...d3.plan, status: 'built' } : scenePlanFromDirector(built.plan),
        updatedAt: new Date().toISOString(),
      })
      return NextResponse.json({
        packet: {
          ...packetFromDirectorPlan({ directorPlan: built.plan, projectId: saved.id }, body.conversationId ?? null),
          approvalRequired: false,
          progressHint: 'The Director previs is ready. Open 3D Director to play it.',
        },
        project: saved,
        scene: built.scene,
        mutated: true,
        approved: true,
      })
    }
    if (d3?.intent && d3.plan && d3.plan.status !== 'built') {
      const live = await loadProject(projectId)
      if (!live) return jsonError('Project not found.', 404)
      const built = build3DScene(live, d3.intent, d3.plan, { approved: true })
      const saved = await saveProject(built.project)
      await saveDirector3DSession({ ...d3, plan: { ...d3.plan, status: 'built' }, updatedAt: new Date().toISOString() })
      return NextResponse.json({
        packet: {
          ...packetFrom3DPlan({ intent: d3.intent, scenePlan: { ...d3.plan, status: 'built' }, projectId: saved.id }, body.conversationId ?? null),
          approvalRequired: false,
          progressHint: 'The 3D scene is built. Open 3D Director to play it.',
        },
        project: saved,
        scene: activeScene(saved) ?? built.scene,
        mutated: true,
        approved: true,
      })
    }
  }
  const mapped = action === 'approve' ? 'approve' : action
  const produced = await producePost(new Request(req.url.replace(/war-room\/?$/, 'produce'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: mapped,
      projectId,
      prompt: body.prompt,
      utterance: body.utterance ?? body.prompt,
      sourceAssetIds: media.sourceAssetIds,
      conversationId: body.conversationId,
    }),
  }))
  const data = await produced.json() as {
    session?: { plan?: HvsWarRoomPacket['plan']; intent?: HvsWarRoomPacket['intent']; pendingPatch?: HvsWarRoomPacket['patch'] }
    mutated?: boolean
    error?: string
    project?: unknown
  }
  const patch = mapped === 'revise' ? (data.session?.pendingPatch ?? null) : null
  const approvalAction: HvsWarRoomPacket['approvalAction'] =
    mapped === 'create-versions' ? 'CREATE_VERSIONS'
    : mapped === 'apply-revision' ? 'APPLY_CHANGES'
    : mapped === 'revise'
      ? (patch?.kind === 'CHANGE_ASPECT' ? 'CREATE_VERSIONS' : 'APPLY_CHANGES')
      : 'MAKE_VIDEO'
  const kind: HvsWarRoomPacket['kind'] =
    mapped === 'create-versions' || (mapped === 'revise' && patch?.kind === 'CHANGE_ASPECT') ? 'variants'
    : mapped === 'revise' && patch?.kind === 'CHANGE_CAPTIONS' ? 'captions'
    : mapped === 'revise' || mapped === 'apply-revision' ? 'revision'
    : 'new_production'
  const packet: HvsWarRoomPacket = {
    routed: true,
    kind,
    projectId,
    conversationId: body.conversationId ?? null,
    approvalRequired: mapped === 'revise',
    approvalAction,
    mutated: false,
    intent: data.session?.intent ?? null,
    plan: data.session?.plan ?? null,
    patch,
    intent3d: null,
    scenePlan: null,
    cinemaIntent: null,
    cinemaPlan: null,
    directorPlan: null,
    directorPatch: null,
    cinemaPatch: null,
    summaryLines: patch?.summary ? [patch.summary] : [],
    progressHint: mapped === 'create-versions'
      ? 'YOUR VIDEOS ARE READY'
      : mapped === 'revise'
        ? (patch?.summary ?? 'Review the change.')
        : 'YOUR VIDEO IS READY',
  }
  return NextResponse.json({ ...data, packet }, { status: produced.status })
}
