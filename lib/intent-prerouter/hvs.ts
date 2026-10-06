/**
 * War Room chat → HVS producer. Additive early return.
 * Delegates to /api/media-command/war-room so MAKE VIDEO uses the same produce path.
 */
import { NextResponse } from 'next/server'
import { durationReportLine, formatLabelForAspect, lengthLabel } from '@/lib/media-command/production-language'
import {
  detectHvsProductionIntent,
  formatWarRoomPlanMessage,
  formatWarRoom3DPlanMessage,
  formatWarRoomCinemaPlanMessage,
  formatWarRoomActorMessage,
  isHvsApprovalUtterance,
  loadBoundProjectId,
  normalizeWarRoomMediaRefs,
} from '@/lib/media-command/war-room-hvs'
import type { HvsWarRoomPacket } from '@/lib/media-command/war-room-hvs-intent'
import type { HvsProductionSession } from '@/lib/media-command/production-ai-types'
import type { HvsProject } from '@/lib/media-command/types'

export type WarRoomHvsHandled = {
  responseText: string
  intent: 'HVS_PRODUCTION'
  projectId: string | null
  approvalRequired: boolean
}

function jsonHvs(result: WarRoomHvsHandled, conversationId: string) {
  return NextResponse.json({
    councilSingleResponse: result.responseText,
    councilSingleFamily: 'war_room',
    results: [{ family: 'War Room', content: result.responseText, status: 'OK' }],
    councilProviderHttpStatus: 'ok',
    conversationId,
    agiIntentPreRouted: result.intent,
    hvsProjectId: result.projectId,
    hvsApprovalRequired: result.approvalRequired,
  })
}

function readyCopy(session: HvsProductionSession | undefined, projectId: string | null): string {
  const duration = durationReportLine(session?.intent?.durationSec, session?.result?.durationSec)
  const format = session?.result?.aspect ? formatLabelForAspect(session.result.aspect) : 'current production'
  const length = session?.result?.durationSec != null ? lengthLabel(session.result.durationSec) : null
  return [
    session?.progress?.headline ?? 'YOUR VIDEO IS READY',
    duration,
    length ? `Length: ${length}` : null,
    `Format: ${format}`,
    '',
    'SAVE · CHANGE SOMETHING · MAKE ANOTHER VERSION · OPEN IN HVS',
  ].filter(Boolean).join('\n')
}

export async function tryHandleWarRoomHvs(
  message: string,
  conversationId: string,
  extras?: { sourceAssetIds?: string[]; warRoomFileIds?: string[]; localPaths?: string[] },
): Promise<NextResponse | null> {
  const handoff = normalizeWarRoomMediaRefs(extras ?? {})
  const boundId = await loadBoundProjectId(conversationId)
  const approval = isHvsApprovalUtterance(message)
  const kind = detectHvsProductionIntent(message, Boolean(boundId))
  if (!approval && kind === 'none') return null

  if (handoff.rejectedPaths.length && kind !== 'director3d' && kind !== 'cinema' && (kind === 'new_production' || !boundId)) {
    return jsonHvs({
      responseText: 'HVS needs ingested project media, not raw computer paths. Attach the clips in Higher Vision Studios first, then ask again.',
      intent: 'HVS_PRODUCTION',
      projectId: boundId,
      approvalRequired: false,
    }, conversationId)
  }

  const action = approval === 'MAKE_VIDEO' || approval === 'BUILD_SCENE' || approval === 'PREVIEW'
    ? 'approve'
    : approval === 'APPLY_CHANGES'
      ? 'apply-revision'
      : approval === 'CREATE_VERSIONS'
        ? 'create-versions'
        : 'route'

  const { POST } = await import('@/app/api/media-command/war-room/route')
  const res = await POST(new Request('http://hvs.local/api/media-command/war-room', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action,
      prompt: message,
      utterance: message,
      conversationId,
      projectId: boundId ?? undefined,
      sourceAssetIds: handoff.sourceAssetIds,
      warRoomFileIds: handoff.warRoomFileIds,
    }),
  }))
  const data = await res.json() as {
    error?: string
    packet?: HvsWarRoomPacket
    session?: HvsProductionSession
    project?: HvsProject
  }
  const projectId = data.packet?.projectId ?? data.session?.projectId ?? boundId

  if (!res.ok) {
    return jsonHvs({
      responseText: `${data.error ?? "I couldn't finish the video."}\n\nTRY AGAIN · CHANGE REQUEST · OPEN DETAILS`,
      intent: 'HVS_PRODUCTION',
      projectId,
      approvalRequired: false,
    }, conversationId)
  }

  if (action === 'approve' || action === 'apply-revision') {
    if (data.packet?.kind === 'cinema') {
      const href = projectId ? `/higher-vision-studios/camera?project=${encodeURIComponent(projectId)}` : '/higher-vision-studios/camera'
      return jsonHvs({
        responseText: `The shot previs is ready.\nOpen Camera to play it: ${href}\nNothing was generated or published.`,
        intent: 'HVS_PRODUCTION',
        projectId,
        approvalRequired: false,
      }, conversationId)
    }
    if (data.packet?.kind === 'director3d') {
      const href = projectId ? `/higher-vision-studios/3d-director?project=${encodeURIComponent(projectId)}` : '/higher-vision-studios/3d-director'
      return jsonHvs({
        responseText: `The 3D scene is built.\nOpen 3D Director to play it: ${href}\nNothing was generated or published.`,
        intent: 'HVS_PRODUCTION',
        projectId,
        approvalRequired: false,
      }, conversationId)
    }
    return jsonHvs({
      responseText: readyCopy(data.session, projectId),
      intent: 'HVS_PRODUCTION',
      projectId,
      approvalRequired: false,
    }, conversationId)
  }

  if (action === 'create-versions') {
    const lines = (data.session?.variants ?? []).map(item => `${item.name}: ${item.status}`)
    return jsonHvs({
      responseText: ['YOUR VIDEOS ARE READY', ...lines, 'Preview / Save for each version. Nothing was published.'].join('\n'),
      intent: 'HVS_PRODUCTION',
      projectId,
      approvalRequired: false,
    }, conversationId)
  }

  if (data.packet && !data.packet.routed) return null

  const text = data.packet?.kind === 'actors'
    ? formatWarRoomActorMessage(data.packet)
    : data.packet?.kind === 'cinema'
    ? formatWarRoomCinemaPlanMessage(data.packet)
    : data.packet?.kind === 'director3d'
    ? formatWarRoom3DPlanMessage(data.packet)
    : data.packet
      ? formatWarRoomPlanMessage(data.packet)
      : 'HVS can make that. Review the plan, then start.'
  return jsonHvs({
    responseText: data.packet?.kind === 'new_production' || data.packet?.kind === 'director3d' || data.packet?.kind === 'cinema' || data.packet?.kind === 'actors' ? text : [
      data.packet?.progressHint ?? data.session?.pendingPatch?.summary ?? 'I can make that change.',
      data.packet?.approvalAction === 'CREATE_VERSIONS'
        ? 'Reply CREATE VERSIONS to make those sizes.'
        : 'Reply APPLY CHANGES to use this, or keep the current cut.',
    ].join('\n'),
    intent: 'HVS_PRODUCTION',
    projectId,
    approvalRequired: Boolean(data.packet?.approvalRequired),
  }, conversationId)
}
