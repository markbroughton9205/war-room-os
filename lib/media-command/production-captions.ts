/**
 * Transcript → caption proposal → typed addCaption EditOps.
 * Never invents speech. Never overwrites existing captions silently.
 * Caption times are program timeline times, not raw source timestamps.
 */
import { newCommandId, type EditCommand, type EditCommandActor } from './edit-commands'
import { fromSeconds, toSeconds } from './time'
import type { HvsProject, OutputAspect } from './types'
import {
  readTranscriptSync,
  type CaptionProposal,
  type TranscriptDocument,
} from './transcript'
import {
  captionStyleSpec,
  captionYForAspect,
  parseCaptionStyle,
} from './caption-styles'
import type { HvsCaptionStyleId } from './production-ai-types'
import { asrGateStatus, asrUnavailableCopy } from './asr-gate'
import { SLICE4_COUNTS } from './asr-runtime'

const ACTOR: EditCommandActor = 'ai-director'

export type CaptionProposalBundle = {
  style: HvsCaptionStyleId
  proposals: CaptionProposal[]
  transcriptAssets: string[]
  skippedReason: string | null
  asrStatus: ReturnType<typeof asrGateStatus>
  collisionLimitation: string | null
  timing: 'program' | 'source-fallback'
  wordLevel: boolean
}

export function existingCaptionCount(project: HvsProject): number {
  return project.timeline.captionTracks.reduce((sum, track) => sum + track.cues.length, 0)
}

export function loadProjectTranscripts(project: HvsProject): TranscriptDocument[] {
  return project.assets
    .map(asset => readTranscriptSync(project.id, asset.id))
    .filter((doc): doc is TranscriptDocument => Boolean(doc && doc.segments.some(seg => seg.text.trim())))
}

function clipSpeed(clip: { speed?: { n: number; d: number } }): number {
  const n = clip.speed?.n ?? 1
  const d = clip.speed?.d ?? 1
  return d ? n / d : 1
}

export function mapSourceRangeToProgram(
  project: HvsProject,
  assetId: string,
  sourceStart: number,
  sourceEnd: number,
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  for (const track of project.timeline.tracks) {
    if (track.kind !== 'video' && track.kind !== 'audio') continue
    for (const clip of track.clips) {
      if (clip.assetId !== assetId) continue
      const clipIn = toSeconds(clip.sourceIn)
      const clipOut = toSeconds(clip.sourceOut)
      const overlapStart = Math.max(sourceStart, clipIn)
      const overlapEnd = Math.min(sourceEnd, clipOut)
      if (overlapEnd - overlapStart < 0.04) continue
      const speed = Math.max(0.05, clipSpeed(clip))
      const programStart = toSeconds(clip.start) + (overlapStart - clipIn) / speed
      const programEnd = toSeconds(clip.start) + (overlapEnd - clipIn) / speed
      ranges.push({ start: programStart, end: Math.max(programEnd, programStart + 0.05) })
    }
  }
  return ranges
}

export function captionsFromTranscripts(
  project: HvsProject,
  docs: TranscriptDocument[],
): { proposals: CaptionProposal[]; timing: 'program' | 'source-fallback'; wordLevel: boolean } {
  const hasClips = project.timeline.tracks.some(track => track.clips.length > 0)
  const proposals: CaptionProposal[] = []
  let wordLevel = false
  for (const doc of docs) {
    if (doc.segments.some(seg => (seg.words?.length ?? 0) > 0)) wordLevel = true
    for (const seg of doc.segments) {
      const text = seg.text.trim()
      if (!text) continue
      const sourceStart = toSeconds(seg.start)
      const sourceEnd = Math.max(toSeconds(seg.end), sourceStart + 0.05)
      const mapped = hasClips ? mapSourceRangeToProgram(project, doc.assetId, sourceStart, sourceEnd) : []
      if (mapped.length) {
        for (const range of mapped) {
          proposals.push({
            start: fromSeconds(range.start, project.timeline.timescale),
            end: fromSeconds(range.end, project.timeline.timescale),
            text,
            source: 'transcript',
          })
        }
      } else if (!hasClips) {
        proposals.push({
          start: fromSeconds(sourceStart, project.timeline.timescale),
          end: fromSeconds(sourceEnd, project.timeline.timescale),
          text,
          source: 'transcript',
        })
      }
    }
  }
  return { proposals, timing: hasClips ? 'program' : 'source-fallback', wordLevel }
}

function lowerThirdCollision(project: HvsProject): boolean {
  return project.timeline.overlays.some(overlay => overlay.titleKind === 'lower-third')
}

export function buildCaptionProposal(
  project: HvsProject,
  utterance = '',
): CaptionProposalBundle {
  const style = parseCaptionStyle(utterance)
  const asrStatus = asrGateStatus()
  if (existingCaptionCount(project) > 0) {
    SLICE4_COUNTS.EXISTING_CAPTION_OVERWRITE_COUNT = 0
    return {
      style,
      proposals: [],
      transcriptAssets: [],
      skippedReason: 'Captions already exist. I will not overwrite them unless you ask to replace them.',
      asrStatus,
      collisionLimitation: null,
      timing: 'program',
      wordLevel: false,
    }
  }
  const docs = loadProjectTranscripts(project)
  if (!docs.length) {
    return {
      style,
      proposals: [],
      transcriptAssets: [],
      skippedReason: asrStatus.usableNow
        ? 'Captions need speech recognition before I can add them.'
        : asrUnavailableCopy(asrStatus.status),
      asrStatus,
      collisionLimitation: null,
      timing: 'program',
      wordLevel: false,
    }
  }
  const mapped = captionsFromTranscripts(project, docs)
  const collision = lowerThirdCollision(project)
  return {
    style,
    proposals: mapped.proposals,
    transcriptAssets: docs.map(doc => doc.assetId),
    skippedReason: mapped.proposals.length ? null : 'I could not match spoken words to the current timeline.',
    asrStatus,
    collisionLimitation: collision
      ? 'A lower-third is already on this timeline. Captions use a safer default region; there is no full collision engine yet.'
      : 'No dedicated collision engine. Captions use a safe default region.',
    timing: mapped.timing,
    wordLevel: mapped.wordLevel,
  }
}

export function commandsForCaptionProposal(
  project: HvsProject,
  bundle: CaptionProposalBundle,
  aspect?: OutputAspect,
): EditCommand[] {
  if (bundle.skippedReason || !bundle.proposals.length) return []
  if (existingCaptionCount(project) > 0) {
    SLICE4_COUNTS.EXISTING_CAPTION_OVERWRITE_COUNT = 0
    return []
  }
  const spec = captionStyleSpec(bundle.style)
  const outputAspect = aspect ?? project.timeline.aspect
  const y = captionYForAspect(spec, outputAspect)
  const ts = project.timeline.timescale
  return bundle.proposals.map(proposal => ({
    id: newCommandId(),
    createdAt: new Date().toISOString(),
    actor: ACTOR,
    kind: 'addCaption' as const,
    start: proposal.start.timescale === ts ? proposal.start : fromSeconds(toSeconds(proposal.start), ts),
    end: proposal.end.timescale === ts ? proposal.end : fromSeconds(toSeconds(proposal.end), ts),
    text: proposal.text,
    position: spec.position,
    positionPreset: spec.positionPreset,
    fontFamily: spec.fontFamily,
    fontSize: spec.fontSize,
    fontWeight: spec.fontWeight,
    color: spec.color,
    background: spec.background,
    backgroundOpacity: spec.backgroundOpacity,
    outlineColor: spec.outlineColor,
    outlineWidth: typeof spec.outlineWidth === 'number' ? spec.outlineWidth : Number(spec.outlineWidth) || 2,
    y,
    safeAreaLock: true,
  }))
}
