/**
 * Bounded production evidence for creative review.
 * Does not dump project JSON, transcripts, lesson stores, or full media.
 * Does not claim visual inspection unless a visual adapter actually ran.
 */
import { toSeconds } from '../time'
import { timelineDuration, type HvsProject } from '../types'
import { commercialOkForAsset } from '../rights'
import { getThemeSpec } from '../themes'
import type { HvsProductionIntent, HvsProductionPlan } from '../production-ai-types'
import type { HvsPlanningConstraint } from '../lessons/types'
import type { HvsVisualFrame, HvsVisualReviewAdapter } from './types'

export type HvsShotEvidence = {
  id: string
  name: string
  durationSec: number
  trackKind: string
  role: 'open' | 'body' | 'close' | null
}

export type HvsCreativeEvidence = {
  requestedDurationSec: number | null
  timelineDurationSec: number
  aspect: string
  requestedAspect: string | null
  platform: string | null
  productionMode: string
  style: string | null
  themeId: string | null
  themeName: string | null
  shots: HvsShotEvidence[]
  openingHoldSec: number | null
  transitionCount: number
  overlayCount: number
  overlayTextChars: number
  captionCount: number
  titleSafeLocked: boolean
  fontFamilies: string[]
  colorNodeTypes: string[]
  lookId: string | null
  audioChannelCount: number
  musicTrackPresent: boolean
  voiceTrackPresent: boolean
  loudnessTargetLufs: number | null
  audioClipping: boolean | null
  silenceSuspected: boolean | null
  cameraShotSizes: string[]
  cameraFraming: string[]
  renderPath: string | null
  renderHash: string | null
  renderJobId: string | null
  versionId: string | null
  qcVerdict: string | null
  rightsStates: string[]
  unknownRightsAssetIds: string[]
  missingAssetIds: string[]
  lessonRules: string[]
  lessonIds: string[]
  visualFrames: HvsVisualFrame[]
  visualAnalysisRan: boolean
  visualSkipReason: string | null
}

export async function collectCreativeEvidence(input: {
  project: HvsProject
  intent: HvsProductionIntent
  plan?: HvsProductionPlan | null
  constraints?: HvsPlanningConstraint[]
  audioClipping?: boolean | null
  silenceSuspected?: boolean | null
  qcVerdict?: string | null
  currentRender?: { path?: string | null; hash?: string | null; jobId?: string | null; versionId?: string | null } | null
  visualAdapter?: HvsVisualReviewAdapter | null
}): Promise<HvsCreativeEvidence> {
  const video = input.project.timeline.tracks.filter(track => track.kind === 'video' || track.kind === 'graphics')
  const clips = video.flatMap(track => track.clips.map(clip => ({
    id: clip.id,
    name: clip.name,
    durationSec: toSeconds(clip.duration),
    trackKind: track.kind,
    role: null as HvsShotEvidence['role'],
  })))
  if (clips[0]) clips[0].role = 'open'
  if (clips.length > 1) clips[clips.length - 1].role = 'close'
  const overlays = input.project.timeline.overlays
  const captions = input.project.timeline.captionTracks.flatMap(track => track.cues)
  const fonts = [
    ...input.project.timeline.captionTracks.map(track => track.fontFamily),
    ...overlays.map(row => row.fontFamily).filter((row): row is string => Boolean(row)),
  ]
  const theme = getThemeSpec(input.project.timeline.themeId)
  const wanted = input.intent.sourceAssetIds.length ? input.intent.sourceAssetIds : []
  const missing = wanted.filter(id => !input.project.assets.some(asset => asset.id === id))
  const unknownRights = input.project.assets
    .filter(asset => !commercialOkForAsset(asset).ok || asset.rights?.state === 'UNKNOWN' || !asset.rights)
    .map(asset => asset.id)
  let visualFrames: HvsVisualFrame[] = []
  let visualAnalysisRan = false
  let visualSkipReason: string | null = input.visualAdapter ? null : 'No visual review adapter ran. Review stays metadata/context based.'
  if (input.visualAdapter && input.currentRender && (input.currentRender.path || input.currentRender.hash || input.currentRender.jobId)) {
    visualFrames = (await input.visualAdapter.sampleFrames({
      renderIdentity: input.currentRender,
      maxFrames: 12,
    })).slice(0, 12)
    visualAnalysisRan = visualFrames.length > 0 && input.visualAdapter.didInspect === true
    visualSkipReason = visualAnalysisRan ? null : 'Visual adapter returned no frames.'
  }
  return {
    requestedDurationSec: input.intent.durationSec,
    timelineDurationSec: toSeconds(timelineDuration(input.project.timeline)),
    aspect: input.project.timeline.aspect,
    requestedAspect: input.intent.aspect,
    platform: input.intent.platform,
    productionMode: input.project.productionMode,
    style: input.intent.style,
    themeId: input.project.timeline.themeId,
    themeName: theme?.name ?? null,
    shots: clips,
    openingHoldSec: clips[0]?.durationSec ?? null,
    transitionCount: input.project.timeline.tracks.reduce((sum, track) => sum + track.transitions.length, 0),
    overlayCount: overlays.length,
    overlayTextChars: overlays.reduce((sum, row) => sum + (row.text?.length ?? 0) + (row.secondaryText?.length ?? 0), 0),
    captionCount: captions.length,
    titleSafeLocked: overlays.some(row => row.safeAreaLock === true) || input.project.timeline.captionTracks.some(track => track.safeAreaLock === true),
    fontFamilies: [...new Set(fonts.filter(Boolean))],
    colorNodeTypes: input.project.colorPipeline.nodes.filter(node => node.enabled).map(node => node.type),
    lookId: theme?.color.lookId ?? null,
    audioChannelCount: input.project.audioGraph.channels.length,
    musicTrackPresent: input.project.timeline.tracks.some(track => /music/i.test(track.name) && track.clips.length > 0),
    voiceTrackPresent: input.project.timeline.tracks.some(track => /dialogue|voice/i.test(track.name) && track.clips.length > 0),
    loudnessTargetLufs: input.project.audioGraph.loudnessTargetLufs ?? null,
    audioClipping: input.audioClipping ?? null,
    silenceSuspected: input.silenceSuspected ?? null,
    cameraShotSizes: input.project.timeline.cameraSpecs.map(spec => spec.shotSize),
    cameraFraming: input.project.timeline.cameraSpecs.map(spec => spec.framing),
    renderPath: input.currentRender?.path ?? null,
    renderHash: input.currentRender?.hash ?? null,
    renderJobId: input.currentRender?.jobId ?? null,
    versionId: input.currentRender?.versionId ?? input.project.currentVersionId,
    qcVerdict: input.qcVerdict ?? null,
    rightsStates: input.project.assets.map(asset => asset.rights?.state ?? 'UNKNOWN'),
    unknownRightsAssetIds: unknownRights,
    missingAssetIds: missing,
    lessonRules: (input.constraints ?? []).map(row => row.rule),
    lessonIds: (input.constraints ?? []).map(row => row.lessonId),
    visualFrames,
    visualAnalysisRan,
    visualSkipReason,
  }
}

export function boundEvidenceForProvider(evidence: HvsCreativeEvidence): Record<string, unknown> {
  return {
    requestedDurationSec: evidence.requestedDurationSec,
    timelineDurationSec: evidence.timelineDurationSec,
    aspect: evidence.aspect,
    requestedAspect: evidence.requestedAspect,
    platform: evidence.platform,
    productionMode: evidence.productionMode,
    style: evidence.style,
    themeId: evidence.themeId,
    shotCount: evidence.shots.length,
    openingHoldSec: evidence.openingHoldSec,
    shotDurationsSec: evidence.shots.slice(0, 12).map(row => row.durationSec),
    transitionCount: evidence.transitionCount,
    overlayCount: evidence.overlayCount,
    overlayTextChars: evidence.overlayTextChars,
    captionCount: evidence.captionCount,
    titleSafeLocked: evidence.titleSafeLocked,
    fontFamilies: evidence.fontFamilies.slice(0, 6),
    colorNodeTypes: evidence.colorNodeTypes.slice(0, 8),
    lookId: evidence.lookId,
    musicTrackPresent: evidence.musicTrackPresent,
    voiceTrackPresent: evidence.voiceTrackPresent,
    loudnessTargetLufs: evidence.loudnessTargetLufs,
    audioClipping: evidence.audioClipping,
    silenceSuspected: evidence.silenceSuspected,
    cameraShotSizes: evidence.cameraShotSizes.slice(0, 8),
    cameraFraming: evidence.cameraFraming.slice(0, 8),
    renderJobId: evidence.renderJobId,
    renderHash: evidence.renderHash,
    qcVerdict: evidence.qcVerdict,
    unknownRightsCount: evidence.unknownRightsAssetIds.length,
    missingAssetCount: evidence.missingAssetIds.length,
    lessonIds: evidence.lessonIds,
    visualAnalysisRan: evidence.visualAnalysisRan,
    visualFrameCount: evidence.visualFrames.length,
  }
}
