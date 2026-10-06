/**
 * PreviewEngine — Program Viewer maps committed timeline truth.
 * Interactive playback uses proxy when present. Render uses originals.
 *
 * V1 playback clock is the HTML5 media element currentTime while a forward clip is under the playhead.
 * HVS maps that source currentTime back into rational timeline time via playback-clock.ts:
 *   program = clip.start + (sourceTime - sourceIn) / speed     (forward)
 *   program = clip.start + (sourceOut - sourceTime) / speed    (reverse)
 * Gap / freeze / reverse do not use HTML5 playbackRate. They advance program ticks from rAF
 * and seek the element (or show black) so float drift does not accumulate as stored state.
 */
import { addTime, compareTime, convertTime, subTime, toSeconds, type MediaTime } from './time'
import type { Clip, HvsProject, OverlaySpec, Track } from './types'
import { clipSpeedRate, sourceSecondsAtLocal } from './playback-clock'
import { dissolveAt, type DissolveWindow } from './transitions'

export type PreviewFrame = {
  clip: Clip | null
  track: Track | null
  sourceSeconds: number
  programSeconds: number
  ended: boolean
  gap: boolean
  layers: PictureLayer[]
  dissolve: DissolveWindow | null
}

export type PictureLayer = {
  clip: Clip
  track: Track
  sourceSeconds: number
  zIndex: number
  trackIndex: number
  kind: Track['kind']
}

export function clipEnd(clip: Clip): MediaTime {
  return addTime(clip.start, clip.duration)
}

export function clipContains(clip: Clip, program: MediaTime): boolean {
  return compareTime(program, clip.start) >= 0 && compareTime(program, clipEnd(clip)) < 0
}

export function localTimeOnClip(clip: Clip, program: MediaTime): MediaTime {
  return subTime(convertTime(program, clip.start.timescale), clip.start)
}

/** Higher track.index draws later (on top). Graphics above video. Captions/overlays are separate. */
export function trackDrawOrder(a: Track, b: Track): number {
  const rank = (kind: Track['kind']) => (kind === 'video' ? 0 : kind === 'graphics' ? 1 : 2)
  const kindDelta = rank(a.kind) - rank(b.kind)
  if (kindDelta !== 0) return kindDelta
  return a.index - b.index
}

export function pictureStackAt(project: HvsProject, programSeconds: number): PictureLayer[] {
  const ticks = Math.round(programSeconds * project.timeline.timescale)
  const program = { ticks, timescale: project.timeline.timescale }
  const layers: PictureLayer[] = []
  const tracks = [...project.timeline.tracks]
    .filter(t => (t.kind === 'video' || t.kind === 'graphics') && !t.muted)
    .sort(trackDrawOrder)
  for (const track of tracks) {
    for (const clip of track.clips) {
      if (!clip.enabled) continue
      if (!clipContains(clip, program)) continue
      layers.push({
        clip,
        track,
        sourceSeconds: sourceSecondsAtLocal(clip, localTimeOnClip(clip, program)),
        zIndex: track.index,
        trackIndex: track.index,
        kind: track.kind,
      })
    }
  }
  return layers
}

export function audioClipsAt(project: HvsProject, programSeconds: number): Clip[] {
  const ticks = Math.round(programSeconds * project.timeline.timescale)
  const program = { ticks, timescale: project.timeline.timescale }
  const clips: Clip[] = []
  for (const track of project.timeline.tracks) {
    if (track.muted) continue
    if (track.kind !== 'audio' && track.kind !== 'video') continue
    for (const clip of track.clips) {
      if (!clip.enabled || clip.volume <= 0) continue
      if (clipContains(clip, program)) clips.push(clip)
    }
  }
  return clips
}

export function overlaysAt(project: HvsProject, programSeconds: number): OverlaySpec[] {
  return project.timeline.overlays.filter(overlay => {
    const start = toSeconds(overlay.start)
    const end = start + toSeconds(overlay.duration)
    return programSeconds >= start && programSeconds < end
  })
}

export function mapPlayheadToSource(project: HvsProject, programSeconds: number): PreviewFrame {
  const stack = pictureStackAt(project, programSeconds)
  const top = stack[stack.length - 1]
  const duration = (() => {
    let max = 0
    for (const track of project.timeline.tracks) {
      for (const clip of track.clips) max = Math.max(max, toSeconds(clip.start) + toSeconds(clip.duration))
    }
    return max
  })()
  const ended = programSeconds >= duration && duration > 0
  const mix = dissolveAt(project, programSeconds)
  if (!top) {
    return {
      clip: null,
      track: null,
      sourceSeconds: 0,
      programSeconds,
      ended,
      gap: programSeconds >= 0 && !ended,
      layers: [],
      dissolve: mix,
    }
  }
  return {
    clip: top.clip,
    track: top.track,
    sourceSeconds: top.sourceSeconds,
    programSeconds,
    ended: false,
    gap: false,
    layers: stack,
    dissolve: mix,
  }
}

export function frameStepSeconds(fps = 24): number {
  return 1 / Math.max(1, fps)
}

export function frameStepFromRate(fps?: { n: number; d: number } | null): number {
  if (!fps || fps.n <= 0 || fps.d <= 0) return 1 / 24
  return fps.d / fps.n
}

export function clipSpeed(clip: Clip): number {
  return clipSpeedRate(clip)
}

export function clipSourceSeconds(clip: Clip, localTimelineSeconds: number): number {
  const ts = clip.start.timescale || 24_000
  return sourceSecondsAtLocal(clip, { ticks: Math.round(localTimelineSeconds * ts), timescale: ts })
}

export function programFromSourceSeconds(clip: Clip, browserCurrentTime: number): number {
  const { toSeconds: sec } = { toSeconds }
  const rate = clipSpeedRate(clip)
  const inSec = sec(clip.sourceIn)
  const spanSec = Math.max(0, sec(clip.sourceOut) - inSec)
  if (clip.freeze) return sec(clip.start)
  let consumed = clip.reversed ? (inSec + spanSec) - browserCurrentTime : browserCurrentTime - inSec
  if (!Number.isFinite(consumed)) consumed = 0
  const localSec = rate === 0 ? 0 : consumed / rate
  return sec(clip.start) + Math.max(0, localSec)
}

export { clipSpeedRate }
export { HVS_PLAYBACK_CLOCK } from './playback-clock'
export { dissolveAt, dissolveProgress } from './transitions'
