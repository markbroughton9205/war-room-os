/**
 * War Room → HVS Director routing (server).
 * Always uses HVS.createFromPrompt for new productions. Never bypasses project truth.
 */
import type { HvsProject } from './types'
import { HVS, type HvsCreateFromPromptResult } from './hvs-producer-contract'
import { parseRevisionRequest } from './production-patches'
import type { HvsProductionSession } from './production-ai-types'
import { parseRequestedVariantAspects } from './production-variants'
import type { HvsWarRoomPacket } from './war-room-hvs-intent'
import { loadWarRoomBinding, saveWarRoomBinding } from './war-room-hvs-session'
import { loadProjectTranscripts } from './production-captions'
import { searchTranscript } from './transcript'
import { toSeconds } from './time'

export {
  detectHvsProductionIntent,
  emptyUnroutedPacket,
  isHvsApprovalUtterance,
  type HvsWarRoomPacket,
  type HvsWarRoomRouteKind,
} from './war-room-hvs-intent'

export type HvsWarRoomMediaHandoff = {
  sourceAssetIds: string[]
  warRoomFileIds: string[]
  rejectedPaths: string[]
}

export async function bindWarRoomConversation(conversationId: string, projectId: string): Promise<void> {
  await saveWarRoomBinding(conversationId, projectId)
}

export async function loadBoundProjectId(conversationId: string): Promise<string | null> {
  return (await loadWarRoomBinding(conversationId))?.projectId ?? null
}

export function normalizeWarRoomMediaRefs(input: {
  sourceAssetIds?: string[]
  warRoomFileIds?: string[]
  localPaths?: string[]
}): HvsWarRoomMediaHandoff {
  return {
    sourceAssetIds: [...new Set((input.sourceAssetIds ?? []).filter(Boolean))],
    warRoomFileIds: [...new Set((input.warRoomFileIds ?? []).filter(Boolean))],
    rejectedPaths: [...new Set((input.localPaths ?? []).filter(Boolean))],
  }
}

export function createWarRoomPlan(
  project: HvsProject,
  input: { prompt: string; sourceAssetIds?: string[] },
): HvsCreateFromPromptResult {
  return HVS.createFromPrompt(project, {
    prompt: input.prompt,
    projectId: project.id,
    sourceAssetIds: input.sourceAssetIds,
  })
}

export function packetFromPlan(
  result: HvsCreateFromPromptResult,
  conversationId: string | null,
): HvsWarRoomPacket {
  return {
    routed: true,
    kind: 'new_production',
    projectId: result.projectId,
    conversationId,
    approvalRequired: true,
    approvalAction: 'MAKE_VIDEO',
    mutated: false,
    intent: result.intent,
    plan: result.plan,
    patch: null,
    intent3d: null,
    scenePlan: null,
    cinemaIntent: null,
    cinemaPlan: null,
    directorPlan: null,
    directorPatch: null,
    cinemaPatch: null,
    summaryLines: result.plan.summaryLines,
    progressHint: 'I can make that. Review the plan, then start.',
  }
}

export function packetFromRevision(
  project: HvsProject,
  session: HvsProductionSession,
  utterance: string,
  conversationId: string | null,
): HvsWarRoomPacket {
  const lower = utterance.toLowerCase()
  if (/find where i say|go to the part where i mention|where i (say|mention)/i.test(lower)) {
    const spoken = lower.match(/(?:where i (?:say|mention)|find where i say|mention)\s+["“]?(.+?)["”]?$/)
    const phrase = (spoken?.[1] ?? utterance).replace(/[.?!]$/, '').trim()
    const hits = loadProjectTranscripts(project).flatMap(doc => searchTranscript(doc, phrase))
    return {
      routed: true,
      kind: 'revision',
      projectId: project.id,
      conversationId,
      approvalRequired: false,
      approvalAction: null,
      mutated: false,
      intent: session.intent,
      plan: session.plan,
      patch: null,
      intent3d: null,
      scenePlan: null,
      cinemaIntent: null,
      cinemaPlan: null,
      directorPlan: null,
    directorPatch: null,
    cinemaPatch: null,
      summaryLines: hits.length
        ? hits.slice(0, 8).map(hit => `${toSeconds(hit.timestamp).toFixed(2)}s · ${hit.text}`)
        : ['No matching spoken words in the transcript.'],
      progressHint: hits[0] ? `Seek ${toSeconds(hits[0].timestamp).toFixed(2)}s` : 'No matching spoken words.',
    }
  }
  const parsed = parseRevisionRequest({
    projectId: project.id,
    planId: session.plan?.id ?? 'plan',
    utterance,
    project,
  })
  const variantAspects = parseRequestedVariantAspects(utterance)
  const approvalAction = variantAspects.length > 1 ? 'CREATE_VERSIONS' : 'APPLY_CHANGES'
  return {
    routed: true,
    kind: parsed.patch.kind === 'CHANGE_CAPTIONS' ? 'captions' : parsed.patch.kind === 'CHANGE_ASPECT' ? 'variants' : 'revision',
    projectId: project.id,
    conversationId,
    approvalRequired: true,
    approvalAction,
    mutated: false,
    intent: session.intent,
    plan: session.plan,
    patch: parsed.patch,
    intent3d: null,
    scenePlan: null,
    cinemaIntent: null,
    cinemaPlan: null,
    directorPlan: null,
    directorPatch: null,
    cinemaPatch: null,
    summaryLines: [parsed.patch.summary],
    progressHint: parsed.patch.summary,
  }
}

export function formatWarRoomPlanMessage(packet: HvsWarRoomPacket): string {
  const lines = [
    'HVS understands this as a video production request.',
    packet.plan ? `Length: ${packet.plan.lengthLabel}` : null,
    packet.plan ? `Format: ${packet.plan.formatLabel}` : null,
    packet.plan ? `Look: ${packet.plan.styleLabel}` : null,
    '',
    'HVS will:',
    ...(packet.summaryLines ?? []).map(line => `✓ ${line}`),
    '',
    'Nothing has been cut yet.',
    'Reply MAKE VIDEO to start, or change the request.',
  ]
  return lines.filter(line => line !== null).join('\n')
}

export function packetFrom3DPlan(
  result: { intent: import('./director3d/types').Hvs3DIntent; scenePlan: import('./director3d/types').HvsScenePlan; projectId: string },
  conversationId: string | null,
): HvsWarRoomPacket {
  return {
    routed: true,
    kind: 'director3d',
    projectId: result.projectId,
    conversationId,
    approvalRequired: true,
    approvalAction: 'BUILD_SCENE',
    mutated: false,
    intent: null,
    plan: null,
    patch: null,
    intent3d: result.intent,
    scenePlan: result.scenePlan,
    cinemaIntent: null,
    cinemaPlan: null,
    directorPlan: null,
    directorPatch: null,
    cinemaPatch: null,
    summaryLines: result.scenePlan.steps.map(step => step.label),
    progressHint: `I can build that scene.\n${result.scenePlan.shotCount} shots\n${result.scenePlan.durationLabel}`,
  }
}

export function formatWarRoom3DPlanMessage(packet: HvsWarRoomPacket): string {
  const plan = packet.scenePlan
  return [
    'I can build that scene.',
    plan ? `${plan.shotCount} shots` : null,
    plan?.durationLabel ?? null,
    '',
    'HVS will:',
    ...(packet.summaryLines ?? []).map(line => `✓ ${line}`),
    '',
    'Nothing has been built yet.',
    'Reply BUILD SCENE, or open 3D Director.',
  ].filter(Boolean).join('\n')
}

export function packetFromCinemaPlan(
  result: { intent: import('./cinema-director/types').HvsCinemaIntent; plan: import('./cinema-director/types').HvsCinemaPlan; projectId: string },
  conversationId: string | null,
): HvsWarRoomPacket {
  return {
    routed: true,
    kind: 'cinema',
    projectId: result.projectId,
    conversationId,
    approvalRequired: true,
    approvalAction: 'PREVIEW',
    mutated: false,
    intent: null,
    plan: null,
    patch: null,
    intent3d: null,
    scenePlan: null,
    cinemaIntent: result.intent,
    cinemaPlan: result.plan,
    directorPlan: null,
    directorPatch: null,
    cinemaPatch: null,
    summaryLines: result.plan.commanderShotList.map(item => `${item.index}. ${item.name} — ${item.durationLabel}`),
    progressHint: `I can direct that sequence.\n${result.plan.shots.length} shots\nReply PREVIEW, or open Camera.`,
  }
}

export function formatWarRoomCinemaPlanMessage(packet: HvsWarRoomPacket): string {
  const plan = packet.cinemaPlan
  return [
    'YOUR SHOTS',
    ...(plan?.commanderShotList ?? []).map(item => `${item.index}. ${item.name} — ${item.durationLabel}`),
    '',
    'Nothing has been built yet.',
    'Reply PREVIEW, or open Camera to review.',
  ].join('\n')
}

export function packetFromDirectorPlan(
  result: { directorPlan: import('./director/types').HvsDirectorPlan; projectId: string },
  conversationId: string | null,
): HvsWarRoomPacket {
  const plan = result.directorPlan
  return {
    routed: true,
    kind: 'director3d',
    projectId: result.projectId,
    conversationId,
    approvalRequired: true,
    approvalAction: 'BUILD_SCENE',
    mutated: false,
    intent: null,
    plan: null,
    patch: null,
    intent3d: null,
    scenePlan: null,
    directorPlan: plan,
    directorPatch: null,
    cinemaIntent: null,
    cinemaPlan: null,
    cinemaPatch: null,
    summaryLines: plan.shots.map(shot => `${shot.order}. ${shot.commanderLabel}`),
    progressHint: `YOUR SCENE\n${plan.timing.durationSec} seconds\n${plan.shots.length} shots\nReply BUILD PREVIS, or open 3D Director.`,
  }
}

export function packetFromActorDirection(input: {
  projectId: string | null
  conversationId: string | null
  summaryLines: string[]
  needsProject: boolean
}): HvsWarRoomPacket {
  return {
    routed: true,
    kind: 'actors',
    projectId: input.projectId,
    conversationId: input.conversationId,
    approvalRequired: false,
    approvalAction: null,
    mutated: !input.needsProject && Boolean(input.projectId),
    intent: null,
    plan: null,
    patch: null,
    intent3d: null,
    scenePlan: null,
    directorPlan: null,
    directorPatch: null,
    cinemaIntent: null,
    cinemaPlan: null,
    cinemaPatch: null,
    summaryLines: input.summaryLines,
    progressHint: input.needsProject
      ? 'Casting stays on the open Higher Vision Studios production. I will not open a new project.'
      : 'That stays on this production. Open Characters to see the cast.',
  }
}

export function formatWarRoomActorMessage(packet: HvsWarRoomPacket): string {
  return [
    packet.projectId ? 'HVS updated this production.' : 'HVS will not open a new project for casting.',
    ...packet.summaryLines,
    packet.progressHint,
  ].join('\n')
}

export function packetFromDirectorPatch(
  plan: import('./director/types').HvsDirectorPlan,
  patch: import('./director/types').HvsDirectorPlanPatch,
  projectId: string,
  conversationId: string | null,
): HvsWarRoomPacket {
  return {
    routed: true,
    kind: 'director3d',
    projectId,
    conversationId,
    approvalRequired: true,
    approvalAction: 'APPLY_CHANGES',
    mutated: false,
    intent: null,
    plan: null,
    patch: null,
    intent3d: null,
    scenePlan: null,
    directorPlan: plan,
    directorPatch: patch,
    cinemaIntent: null,
    cinemaPlan: null,
    cinemaPatch: null,
    summaryLines: [patch.summary, ...(patch.directorChoice ? [patch.directorChoice] : []), ...patch.linkedUpdates],
    progressHint: patch.summary,
  }
}
