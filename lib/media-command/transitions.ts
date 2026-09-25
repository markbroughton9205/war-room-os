/**
 * Dissolve transitions. Structured track.transitions — not CSS.
 * Adjacent clips overlap by duration when a dissolve is added.
 * Audio crossfade uses the same window (afade in render; Program picture mix).
 */
import { addTime, compareTime, fromSeconds, subTime, toSeconds, type MediaTime } from './time'
import type { Clip, HvsProject, Track, Transition } from './types'

export const DISSOLVE_KIND = 'dissolve'

export type DissolveWindow = {
  transition: Transition
  outgoing: Clip
  incoming: Clip
  startSec: number
  endSec: number
  durationSec: number
}

export function clipEnd(clip: Clip): MediaTime {
  return addTime(clip.start, clip.duration)
}

export function clipsAdjacentOrOverlap(out: Clip, inn: Clip, timescale: number): boolean {
  const gap = toSeconds(inn.start) - toSeconds(clipEnd(out))
  const frame = 1 / 24
  if (gap > frame) return false
  if (toSeconds(inn.start) + toSeconds(inn.duration) <= toSeconds(out.start) + frame) return false
  return true
}

export function findTransitionClips(track: Track, transition: Transition): { outgoing: Clip; incoming: Clip } | null {
  const outgoing = track.clips.find(c => c.id === transition.outgoingClipId)
  const incoming = track.clips.find(c => c.id === transition.incomingClipId)
  if (!outgoing || !incoming) return null
  return { outgoing, incoming }
}

export function dissolveWindowFor(track: Track, transition: Transition): DissolveWindow | null {
  if (transition.kind !== DISSOLVE_KIND && transition.kind !== 'crossfade') return null
  const pair = findTransitionClips(track, transition)
  if (!pair) return null
  const startSec = Math.max(toSeconds(pair.outgoing.start), toSeconds(pair.incoming.start))
  const endSec = Math.min(toSeconds(clipEnd(pair.outgoing)), toSeconds(clipEnd(pair.incoming)))
  const overlap = endSec - startSec
  const requested = toSeconds(transition.duration)
  const durationSec = Math.min(overlap > 1 / 24000 ? overlap : requested, requested)
  if (durationSec <= 0) return null
  const mixStart = overlap > 1 / 24000 ? startSec : toSeconds(clipEnd(pair.outgoing)) - durationSec
  return {
    transition,
    outgoing: pair.outgoing,
    incoming: pair.incoming,
    startSec: mixStart,
    endSec: mixStart + durationSec,
    durationSec,
  }
}

export function dissolveAt(project: HvsProject, programSeconds: number): DissolveWindow | null {
  for (const track of project.timeline.tracks) {
    if (track.kind !== 'video' && track.kind !== 'graphics') continue
    for (const tr of track.transitions) {
      const win = dissolveWindowFor(track, tr)
      if (!win) continue
      if (programSeconds >= win.startSec && programSeconds < win.endSec) return win
    }
  }
  return null
}

export function dissolveProgress(win: DissolveWindow, programSeconds: number): number {
  if (win.durationSec <= 0) return 1
  return Math.max(0, Math.min(1, (programSeconds - win.startSec) / win.durationSec))
}

export function clipDissolveOpacity(project: HvsProject, clip: Clip, programSeconds: number): number {
  const win = dissolveAt(project, programSeconds)
  if (!win) return 1
  const u = dissolveProgress(win, programSeconds)
  if (clip.id === win.outgoing.id) return 1 - u
  if (clip.id === win.incoming.id) return u
  return 1
}

export function validateDissolveDuration(out: Clip, inn: Clip, duration: MediaTime): string | null {
  const d = toSeconds(duration)
  if (!(d > 0)) return 'Transition duration must be positive.'
  const max = Math.min(toSeconds(out.duration), toSeconds(inn.duration))
  if (d > max + 1 / 24000) return 'Transition duration exceeds clip handles.'
  return null
}

export function pairForPlayhead(project: HvsProject, playheadSeconds: number): { outgoing: Clip; incoming: Clip; track: Track } | null {
  const ts = project.timeline.timescale
  const t = fromSeconds(playheadSeconds, ts)
  for (const track of project.timeline.tracks) {
    if (track.kind !== 'video') continue
    const sorted = [...track.clips].filter(c => c.enabled).sort((a, b) => a.start.ticks - b.start.ticks)
    for (let i = 0; i < sorted.length - 1; i++) {
      const out = sorted[i]
      const inn = sorted[i + 1]
      const cut = clipEnd(out)
      const nearCut = Math.abs(toSeconds(cut) - playheadSeconds) <= Math.max(0.25, toSeconds(out.duration) * 0.05)
        || (compareTime(t, out.start) >= 0 && compareTime(t, clipEnd(inn)) < 0)
      if (nearCut && clipsAdjacentOrOverlap(out, inn, ts)) return { outgoing: out, incoming: inn, track }
    }
  }
  return null
}

export const HVS_AUDIO_CROSSFADE_POLICY = 'Dissolve on a video pair also crossfades that pair\'s audio in the render graph (afade out/in over the mix window). Program picture mix is visual; Program audio remains the MediaElement feeding StereoPanner — not a second DAW mix.'
