/**
 * EditOps engine. Tracks remain source of truth. Magnetic snap is a UX helper only.
 * Inverse commands power undo. AI goes: proposal → schema → preconditions → policy → preview → commit.
 */
import { addTime, compareTime, convertTime, fromSeconds, mediaTime, parseMediaTime, subTime, toSeconds, zeroTime, type MediaTime } from './time'
import { cloneProject, findAsset, findClip, IDENTITY_CROP, IDENTITY_TRANSFORM, type AssetRecord, type Clip, type HvsProject, type Track } from './types'
import type { EditCommand, EditCommandResult } from './edit-commands'
import { validateEditCommandSchema } from './edit-commands'
import { LUXURY_BEAUTY_V1_ID, getThemeSpec } from './themes'
import { clampPan } from './pan'
import { DISSOLVE_KIND, clipEnd as trnClipEnd, clipsAdjacentOrOverlap, validateDissolveDuration } from './transitions'
import { policyCheck } from './policy'
import { correctSubject, followFramingCrop, sourcePixelRatio } from './tracking'
import { uniqueCaptionCues } from './captions'
import { validateAssetSourceRange } from './source-monitor'
import { POSITION_PRESETS, clampStyleToTitleSafe, resolveCaptionStyle, resolveOverlayStyle } from './text-layout'
import { applyTitlePreset, getTitlePreset } from './title-presets'
import { aspectDimensions } from './safe-area'
import { validateEffectGraph, defaultPorts, type HvsEffectGraph, type HvsEffectNode, type HvsEffectNodeKind } from './effect-graph'
import { identityColorPipelineOr, validateColorPipeline, type ColorPipeline } from './color-pipeline'
import { validateAudioGraph, type AudioGraph } from './audio-graph'

function fail(error: string, code = 'PRECONDITION'): EditCommandResult {
  return { ok: false, error, code }
}

function clipEnd(clip: Clip) {
  return addTime(clip.start, clip.duration)
}

function projectSourceRatio(project: HvsProject): number {
  const clip = project.timeline.tracks.flatMap(t => t.clips)[0]
  const asset = clip ? findAsset(project, clip.assetId) : null
  return sourcePixelRatio(asset?.width, asset?.height)
}

function projectSourceAspect(project: HvsProject): '16:9' | '9:16' | '1:1' {
  const ratio = projectSourceRatio(project)
  if (ratio < 0.8) return '9:16'
  if (ratio > 1.3) return '16:9'
  return '1:1'
}

function makeClip(partial: Omit<Clip, 'transform' | 'crop' | 'opacity' | 'volume' | 'fadeIn' | 'fadeOut' | 'pan' | 'color' | 'effects' | 'filters' | 'enabled' | 'speed' | 'reversed' | 'freeze'> & Partial<Clip>): Clip {
  const timescale = partial.start.timescale
  return {
    transform: IDENTITY_TRANSFORM,
    crop: IDENTITY_CROP,
    opacity: 1,
    volume: 1,
    fadeIn: zeroTime(timescale),
    fadeOut: zeroTime(timescale),
    pan: 0,
    color: { exposure: 0, contrast: 0, saturation: 0, temperature: 0, lookId: null },
    effects: [],
    filters: [],
    enabled: true,
    speed: { n: 1, d: 1 },
    reversed: false,
    freeze: false,
    ...partial,
  }
}

function requireTrack(project: HvsProject, trackId: string): Track | null {
  return project.timeline.tracks.find(t => t.id === trackId) ?? null
}

function sortClips(track: Track) {
  track.clips.sort((a, b) => a.start.ticks - b.start.ticks)
}

function overlaps(a: Clip, b: Clip): boolean {
  return compareTime(a.start, clipEnd(b)) < 0 && compareTime(b.start, clipEnd(a)) < 0
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function sortedTrackClips(track: Track): Clip[] {
  return [...track.clips].sort((a, b) => a.start.ticks - b.start.ticks)
}

function neighborClips(track: Track, clipId: string): { prev: Clip | null; clip: Clip | null; next: Clip | null } {
  const clips = sortedTrackClips(track)
  const index = clips.findIndex(c => c.id === clipId)
  if (index < 0) return { prev: null, clip: null, next: null }
  return {
    prev: clips[index - 1] ?? null,
    clip: clips[index] ?? null,
    next: clips[index + 1] ?? null,
  }
}

/** Split overlapping clips so [start, end) is empty, keeping left/right remnants. */
function carveRange(track: Track, start: MediaTime, end: MediaTime) {
  const kept: Clip[] = []
  for (const clip of track.clips) {
    const c0 = clip.start
    const c1 = clipEnd(clip)
    if (compareTime(c1, start) <= 0 || compareTime(c0, end) >= 0) {
      kept.push(clip)
      continue
    }
    if (compareTime(c0, start) < 0) {
      kept.push({
        ...clip,
        duration: subTime(start, c0),
        sourceOut: addTime(clip.sourceIn, subTime(start, c0)),
      })
    }
    if (compareTime(c1, end) > 0) {
      const into = subTime(end, c0)
      kept.push(makeClip({
        ...clip,
        id: newId('clip'),
        start: end,
        duration: subTime(c1, end),
        sourceIn: addTime(clip.sourceIn, into),
        sourceOut: clip.sourceOut,
      }))
    }
  }
  track.clips = kept
}

function trackEnd(track: Track, timescale: number): MediaTime {
  let end = zeroTime(timescale)
  for (const clip of track.clips) {
    const c1 = clipEnd(clip)
    if (compareTime(c1, end) > 0) end = c1
  }
  return end
}

function resolveSourceWindow(
  asset: AssetRecord,
  timescale: number,
  sourceIn?: MediaTime,
  sourceOut?: MediaTime,
  duration?: MediaTime,
): { ok: true; sourceIn: MediaTime; sourceOut: MediaTime; duration: MediaTime } | { ok: false; error: string } {
  const inn = sourceIn ? parseMediaTime(sourceIn, timescale) : zeroTime(timescale)
  let out: MediaTime
  let dur: MediaTime
  if (sourceOut) {
    out = parseMediaTime(sourceOut, timescale)
    dur = duration ? parseMediaTime(duration, timescale) : subTime(out, inn)
  } else if (duration) {
    dur = parseMediaTime(duration, timescale)
    out = addTime(inn, dur)
  } else {
    const full = convertTime(asset.duration, timescale)
    out = addTime(inn, full)
    dur = full
  }
  if (dur.ticks <= 0) return { ok: false, error: 'Source range duration must be positive.' }
  const range = validateAssetSourceRange(asset, inn, out, timescale)
  if (!range.ok) return range
  return { ok: true, sourceIn: inn, sourceOut: out, duration: dur }
}

export function applyEditCommand(project: HvsProject, command: EditCommand): { project: HvsProject } & EditCommandResult {
  const schema = validateEditCommandSchema(command)
  if (!schema.ok) return { project, ...schema }
  const policy = policyCheck(project, command)
  if (!policy.ok) return { project, ...policy }

  const next = cloneProject(project)
  next.updatedAt = command.createdAt || new Date().toISOString()
  const warnings: string[] = []

  switch (command.kind) {
    case 'insertClip': {
      const asset = findAsset(next, command.assetId)
      if (!asset) return { project, ...fail('Asset not found.') }
      const track = requireTrack(next, command.trackId)
      if (!track) return { project, ...fail('Track not found.') }
      const start = parseMediaTime(command.start, next.timeline.timescale)
      const window = resolveSourceWindow(asset, next.timeline.timescale, command.sourceIn, command.sourceOut, command.duration)
      if (!window.ok) return { project, ...fail(window.error) }
      const clip = makeClip({
        id: newId('clip'),
        trackId: track.id,
        assetId: asset.id,
        name: asset.name,
        start,
        duration: window.duration,
        sourceIn: window.sourceIn,
        sourceOut: window.sourceOut,
      })
      const colliding = track.clips.filter(existing => overlaps(existing, clip))
      if (colliding.length) {
        // Magnetic UX: ripple later clips forward. Storage stays explicit clip starts.
        const shift = subTime(clipEnd(clip), colliding[0].start)
        for (const existing of track.clips) {
          if (compareTime(existing.start, start) >= 0) {
            existing.start = addTime(existing.start, shift)
          }
        }
        warnings.push('Magnetic ripple applied as EditOp UX; tracks remain source of truth.')
      }
      track.clips.push(clip)
      sortClips(track)
      break
    }
    case 'overwriteClip': {
      const asset = findAsset(next, command.assetId)
      if (!asset) return { project, ...fail('Asset not found.') }
      const track = requireTrack(next, command.trackId)
      if (!track) return { project, ...fail('Track not found.') }
      const start = parseMediaTime(command.start, next.timeline.timescale)
      const window = resolveSourceWindow(asset, next.timeline.timescale, command.sourceIn, command.sourceOut, command.duration)
      if (!window.ok) return { project, ...fail(window.error) }
      const incoming = makeClip({
        id: newId('clip'),
        trackId: track.id,
        assetId: asset.id,
        name: asset.name,
        start,
        duration: window.duration,
        sourceIn: window.sourceIn,
        sourceOut: window.sourceOut,
      })
      carveRange(track, start, clipEnd(incoming))
      track.clips.push(incoming)
      sortClips(track)
      break
    }
    case 'appendClip': {
      const asset = findAsset(next, command.assetId)
      if (!asset) return { project, ...fail('Asset not found.') }
      const track = requireTrack(next, command.trackId)
      if (!track) return { project, ...fail('Track not found.') }
      const window = resolveSourceWindow(asset, next.timeline.timescale, command.sourceIn, command.sourceOut, command.duration)
      if (!window.ok) return { project, ...fail(window.error) }
      const start = trackEnd(track, next.timeline.timescale)
      track.clips.push(makeClip({
        id: newId('clip'),
        trackId: track.id,
        assetId: asset.id,
        name: asset.name,
        start,
        duration: window.duration,
        sourceIn: window.sourceIn,
        sourceOut: window.sourceOut,
      }))
      sortClips(track)
      break
    }
    case 'liftClip': {
      const found = findClip(next, command.clipId)
      if (!found) return { project, ...fail('Clip not found.') }
      found.track.clips = found.track.clips.filter(c => c.id !== command.clipId)
      break
    }
    case 'extractClip': {
      const found = findClip(next, command.clipId)
      if (!found) return { project, ...fail('Clip not found.') }
      const gap = found.clip.duration
      const start = found.clip.start
      found.track.clips = found.track.clips.filter(c => c.id !== command.clipId)
      for (const clip of found.track.clips) {
        if (compareTime(clip.start, start) >= 0) clip.start = subTime(clip.start, gap)
      }
      break
    }
    case 'rippleTrim': {
      const found = findClip(next, command.clipId)
      if (!found) return { project, ...fail('Clip not found.') }
      const to = parseMediaTime(command.to, next.timeline.timescale)
      const oldStart = found.clip.start
      const oldEnd = clipEnd(found.clip)
      if (command.edge === 'in') {
        if (compareTime(to, oldEnd) >= 0) return { project, ...fail('Ripple trim in-point past out-point.') }
        const delta = subTime(to, oldStart)
        found.clip.start = to
        found.clip.duration = subTime(found.clip.duration, delta)
        found.clip.sourceIn = addTime(found.clip.sourceIn, delta)
        for (const clip of found.track.clips) {
          if (compareTime(clip.start, oldStart) >= 0) clip.start = subTime(clip.start, delta)
        }
      } else {
        if (compareTime(to, oldStart) <= 0) return { project, ...fail('Ripple trim out-point before in-point.') }
        found.clip.duration = subTime(to, oldStart)
        found.clip.sourceOut = addTime(found.clip.sourceIn, found.clip.duration)
        const shift = subTime(clipEnd(found.clip), oldEnd)
        for (const clip of found.track.clips) {
          if (clip.id !== command.clipId && compareTime(clip.start, oldEnd) >= 0) {
            clip.start = addTime(clip.start, shift)
          }
        }
      }
      if (found.clip.duration.ticks <= 0) return { project, ...fail('Ripple trim would remove the clip.') }
      break
    }
    case 'rollEdit': {
      const outgoing = findClip(next, command.outgoingClipId)
      const incoming = findClip(next, command.incomingClipId)
      if (!outgoing || !incoming) return { project, ...fail('Roll clips not found.') }
      if (outgoing.track.id !== incoming.track.id) return { project, ...fail('Roll requires adjacent clips on the same track.') }
      const to = parseMediaTime(command.to, next.timeline.timescale)
      const outStart = outgoing.clip.start
      const inEnd = clipEnd(incoming.clip)
      if (compareTime(to, outStart) <= 0 || compareTime(to, inEnd) >= 0) {
        return { project, ...fail('Roll edit point must stay inside the two-clip span.') }
      }
      const oldInStart = incoming.clip.start
      outgoing.clip.duration = subTime(to, outStart)
      outgoing.clip.sourceOut = addTime(outgoing.clip.sourceIn, outgoing.clip.duration)
      const inDelta = subTime(to, oldInStart)
      incoming.clip.start = to
      incoming.clip.sourceIn = addTime(incoming.clip.sourceIn, inDelta)
      incoming.clip.duration = subTime(inEnd, to)
      incoming.clip.sourceOut = addTime(incoming.clip.sourceIn, incoming.clip.duration)
      if (outgoing.clip.duration.ticks <= 0 || incoming.clip.duration.ticks <= 0) {
        return { project, ...fail('Roll would collapse a clip.') }
      }
      break
    }
    case 'slipClip': {
      const found = findClip(next, command.clipId)
      if (!found) return { project, ...fail('Clip not found.') }
      const asset = findAsset(next, found.clip.assetId)
      if (!asset) return { project, ...fail('Asset not found.') }
      const delta = parseMediaTime(command.delta, next.timeline.timescale)
      const srcDur = convertTime(asset.duration, next.timeline.timescale)
      let sourceIn = addTime(found.clip.sourceIn, delta)
      let sourceOut = addTime(found.clip.sourceOut, delta)
      if (sourceIn.ticks < 0) {
        const back = mediaTime(-sourceIn.ticks, sourceIn.timescale)
        sourceIn = addTime(sourceIn, back)
        sourceOut = addTime(sourceOut, back)
      }
      if (compareTime(sourceOut, srcDur) > 0) {
        const over = subTime(sourceOut, srcDur)
        sourceIn = subTime(sourceIn, over)
        sourceOut = subTime(sourceOut, over)
      }
      if (sourceIn.ticks < 0 || compareTime(sourceOut, srcDur) > 0) {
        return { project, ...fail('Slip exceeds available source media.') }
      }
      found.clip.sourceIn = sourceIn
      found.clip.sourceOut = sourceOut
      break
    }
    case 'slideClip': {
      const found = findClip(next, command.clipId)
      if (!found) return { project, ...fail('Clip not found.') }
      const { prev, next: later } = neighborClips(found.track, command.clipId)
      if (!prev || !later) return { project, ...fail('Slide requires a previous and next clip on the same track.') }
      const start = parseMediaTime(command.start, next.timeline.timescale)
      const duration = found.clip.duration
      const newEnd = addTime(start, duration)
      if (compareTime(start, prev.start) <= 0 || compareTime(newEnd, clipEnd(later)) >= 0) {
        return { project, ...fail('Slide would collapse a neighboring clip.') }
      }
      prev.duration = subTime(start, prev.start)
      prev.sourceOut = addTime(prev.sourceIn, prev.duration)
      const oldLaterEnd = clipEnd(later)
      const oldLaterStart = later.start
      found.clip.start = start
      later.start = newEnd
      const laterDelta = subTime(later.start, oldLaterStart)
      later.sourceIn = addTime(later.sourceIn, laterDelta)
      later.duration = subTime(oldLaterEnd, later.start)
      later.sourceOut = addTime(later.sourceIn, later.duration)
      if (prev.duration.ticks <= 0 || later.duration.ticks <= 0) {
        return { project, ...fail('Slide would collapse a neighboring clip.') }
      }
      break
    }
    case 'extendEdit': {
      const found = findClip(next, command.clipId)
      if (!found) return { project, ...fail('Clip not found.') }
      const asset = findAsset(next, found.clip.assetId)
      if (!asset) return { project, ...fail('Asset not found.') }
      const to = parseMediaTime(command.to, next.timeline.timescale)
      if (compareTime(to, found.clip.start) <= 0) return { project, ...fail('Extend out-point before in-point.') }
      const newDur = subTime(to, found.clip.start)
      const available = subTime(convertTime(asset.duration, next.timeline.timescale), found.clip.sourceIn)
      if (compareTime(newDur, available) > 0) return { project, ...fail('Extend exceeds available source media.') }
      found.clip.duration = newDur
      found.clip.sourceOut = addTime(found.clip.sourceIn, newDur)
      break
    }
    case 'duplicateClip': {
      const found = findClip(next, command.clipId)
      if (!found) return { project, ...fail('Clip not found.') }
      const copyStart = clipEnd(found.clip)
      const copy = makeClip({
        ...found.clip,
        id: newId('clip'),
        start: copyStart,
      })
      const colliding = found.track.clips.filter(existing => existing.id !== found.clip.id && overlaps(existing, copy))
      if (colliding.length) {
        const shift = subTime(clipEnd(copy), colliding[0].start)
        for (const existing of found.track.clips) {
          if (existing.id !== found.clip.id && compareTime(existing.start, copyStart) >= 0) {
            existing.start = addTime(existing.start, shift)
          }
        }
        warnings.push('Duplicate rippled later clips to keep tracks as source of truth.')
      }
      found.track.clips.push(copy)
      sortClips(found.track)
      break
    }
    case 'addMarker': {
      const time = parseMediaTime(command.time, next.timeline.timescale)
      if (time.ticks < 0) return { project, ...fail('Marker cannot precede zero.') }
      const duration = command.duration
        ? parseMediaTime(command.duration, next.timeline.timescale)
        : zeroTime(next.timeline.timescale)
      if (duration.ticks < 0) return { project, ...fail('Marker range cannot be negative.') }
      next.timeline.markers.push({
        id: newId('mkr'),
        time,
        duration,
        label: command.label?.trim() || (duration.ticks > 0 ? 'Range' : 'Marker'),
        color: command.color || '#fbbf24',
        kind: command.kindMarker ?? 'generic',
      })
      next.timeline.markers.sort((a, b) => a.time.ticks - b.time.ticks)
      break
    }
    case 'updateMarker': {
      const marker = next.timeline.markers.find(m => m.id === command.markerId)
      if (!marker) return { project, ...fail('Marker not found.') }
      if (command.time) {
        const time = parseMediaTime(command.time, next.timeline.timescale)
        if (time.ticks < 0) return { project, ...fail('Marker cannot precede zero.') }
        marker.time = time
      }
      if (command.duration) {
        const duration = parseMediaTime(command.duration, next.timeline.timescale)
        if (duration.ticks < 0) return { project, ...fail('Marker range cannot be negative.') }
        marker.duration = duration
      }
      if (command.label != null) marker.label = command.label.trim() || marker.label
      if (command.color) marker.color = command.color
      next.timeline.markers.sort((a, b) => a.time.ticks - b.time.ticks)
      break
    }
    case 'removeMarker': {
      const before = next.timeline.markers.length
      next.timeline.markers = next.timeline.markers.filter(m => m.id !== command.markerId)
      if (next.timeline.markers.length === before) return { project, ...fail('Marker not found.') }
      break
    }
    case 'moveClip': {
      const found = findClip(next, command.clipId)
      if (!found) return { project, ...fail('Clip not found.') }
      const dest = requireTrack(next, command.trackId)
      if (!dest) return { project, ...fail('Destination track not found.') }
      const start = parseMediaTime(command.start, next.timeline.timescale)
      if (start.ticks < 0) return { project, ...fail('Clip cannot start before zero.') }
      found.track.clips = found.track.clips.filter(c => c.id !== command.clipId)
      found.clip.trackId = dest.id
      found.clip.start = start
      dest.clips.push(found.clip)
      sortClips(dest)
      break
    }
    case 'splitClip': {
      const found = findClip(next, command.clipId)
      if (!found) return { project, ...fail('Clip not found.') }
      const at = parseMediaTime(command.at, next.timeline.timescale)
      if (compareTime(at, found.clip.start) <= 0 || compareTime(at, clipEnd(found.clip)) >= 0) {
        return { project, ...fail('Split point must be inside the clip.') }
      }
      const leftDur = subTime(at, found.clip.start)
      const rightDur = subTime(clipEnd(found.clip), at)
      const right = makeClip({
        ...found.clip,
        id: newId('clip'),
        start: at,
        duration: rightDur,
        sourceIn: addTime(found.clip.sourceIn, leftDur),
        sourceOut: found.clip.sourceOut,
      })
      found.clip.duration = leftDur
      found.clip.sourceOut = addTime(found.clip.sourceIn, leftDur)
      found.track.clips.push(right)
      sortClips(found.track)
      break
    }
    case 'trimClip': {
      const found = findClip(next, command.clipId)
      if (!found) return { project, ...fail('Clip not found.') }
      const to = parseMediaTime(command.to, next.timeline.timescale)
      if (command.edge === 'in') {
        if (compareTime(to, clipEnd(found.clip)) >= 0) return { project, ...fail('In-point past out-point.') }
        const delta = subTime(to, found.clip.start)
        found.clip.start = to
        found.clip.duration = subTime(found.clip.duration, delta)
        found.clip.sourceIn = addTime(found.clip.sourceIn, delta)
      } else {
        if (compareTime(to, found.clip.start) <= 0) return { project, ...fail('Out-point before in-point.') }
        found.clip.duration = subTime(to, found.clip.start)
        found.clip.sourceOut = addTime(found.clip.sourceIn, found.clip.duration)
      }
      break
    }
    case 'rippleDelete': {
      const found = findClip(next, command.clipId)
      if (!found) return { project, ...fail('Clip not found.') }
      const gap = found.clip.duration
      const start = found.clip.start
      found.track.clips = found.track.clips.filter(c => c.id !== command.clipId)
      for (const clip of found.track.clips) {
        if (compareTime(clip.start, start) >= 0) clip.start = subTime(clip.start, gap)
      }
      break
    }
    case 'setTransform': {
      const found = findClip(next, command.clipId)
      if (!found) return { project, ...fail('Clip not found.') }
      found.clip.transform = { ...found.clip.transform, ...command.transform }
      break
    }
    case 'setCrop': {
      const found = findClip(next, command.clipId)
      if (!found) return { project, ...fail('Clip not found.') }
      found.clip.crop = { ...found.clip.crop, ...command.crop }
      break
    }
    case 'setOpacity': {
      const found = findClip(next, command.clipId)
      if (!found) return { project, ...fail('Clip not found.') }
      found.clip.opacity = Math.max(0, Math.min(1, command.opacity))
      break
    }
    case 'setSpeed': {
      const found = findClip(next, command.clipId)
      if (!found) return { project, ...fail('Clip not found.') }
      if (command.speed.n <= 0 || command.speed.d <= 0) return { project, ...fail('Speed must be a positive rational.') }
      found.clip.speed = command.speed
      if (!found.clip.freeze) {
        const span = subTime(found.clip.sourceOut, found.clip.sourceIn)
        const ticks = Math.max(1, Math.round(span.ticks * command.speed.d / command.speed.n))
        found.clip.duration = { ticks, timescale: span.timescale }
        if (found.track.clips.some(c => c.id !== found.clip.id && overlaps(c, found.clip))) {
          warnings.push('Speed change overlaps a neighboring clip on the same track. No auto-ripple; tracks remain source of truth.')
        }
      }
      break
    }
    case 'reverseClip': {
      const found = findClip(next, command.clipId)
      if (!found) return { project, ...fail('Clip not found.') }
      found.clip.reversed = command.reversed
      break
    }
    case 'freezeFrame': {
      if (!command.clipId) return { project, ...fail('Clip not found.') }
      const found = findClip(next, command.clipId)
      if (!found) return { project, ...fail('Clip not found.') }
      found.clip.freeze = command.freeze !== false
      if (command.at) {
        const at = parseMediaTime(command.at, next.timeline.timescale)
        found.clip.sourceIn = at
        found.clip.sourceOut = addTime(at, mediaTime(Math.max(1, Math.round(next.timeline.timescale / 24)), next.timeline.timescale))
      }
      break
    }
    case 'createFreezeFrame': {
      const found = command.clipId ? findClip(next, command.clipId) : null
      const ts = next.timeline.timescale
      const track = found?.track ?? (command.trackId ? requireTrack(next, command.trackId) : requireTrack(next, 'V1'))
      if (!track) return { project, ...fail('Track not found.') }
      const at = command.at
        ? parseMediaTime(command.at, ts)
        : found?.clip.sourceIn ?? zeroTime(ts)
      const hold = command.duration ? parseMediaTime(command.duration, ts) : fromSeconds(2, ts)
      if (hold.ticks <= 0) return { project, ...fail('Freeze duration must be positive.') }
      const start = command.start ? parseMediaTime(command.start, ts) : found?.clip.start ?? zeroTime(ts)
      const assetId = command.assetId ?? found?.clip.assetId
      if (!assetId) return { project, ...fail('Freeze asset not found.') }
      const asset = findAsset(next, assetId)
      if (!asset) return { project, ...fail('Freeze asset not found.') }
      const freezeClip = makeClip({
        id: newId('clip'),
        trackId: track.id,
        assetId,
        name: `${found?.clip.name ?? asset.name} — freeze`,
        start,
        duration: hold,
        sourceIn: at,
        sourceOut: addTime(at, mediaTime(Math.max(1, Math.round(ts / 24)), ts)),
        freeze: true,
      })
      const colliding = track.clips.filter(existing => overlaps(existing, freezeClip))
      if (colliding.length) {
        const shift = subTime(clipEnd(freezeClip), colliding[0].start)
        for (const existing of track.clips) {
          if (compareTime(existing.start, start) >= 0) existing.start = addTime(existing.start, shift)
        }
        warnings.push('Magnetic ripple applied as EditOp UX; tracks remain source of truth.')
      }
      track.clips.push(freezeClip)
      sortClips(track)
      warnings.push('Freeze frame holds the selected source timestamp. Original media is unchanged.')
      break
    }
    case 'addTransition': {
      const out = findClip(next, command.outgoingClipId)
      const inn = findClip(next, command.incomingClipId)
      if (!out || !inn) return { project, ...fail('Transition clips not found.') }
      if (out.track.id !== inn.track.id) return { project, ...fail('Transition requires the same track.') }
      const duration = parseMediaTime(command.duration, next.timeline.timescale)
      const durErr = validateDissolveDuration(out.clip, inn.clip, duration)
      if (durErr) return { project, ...fail(durErr) }
      if (!clipsAdjacentOrOverlap(out.clip, inn.clip, next.timeline.timescale)) {
        return { project, ...fail('Transition requires adjacent or overlapping clips.') }
      }
      const kind = command.transitionKind || DISSOLVE_KIND
      const existing = out.track.transitions.find(t => t.outgoingClipId === out.clip.id && t.incomingClipId === inn.clip.id)
      if (existing) return { project, ...fail('A transition already exists on this cut.') }
      const want = toSeconds(duration)
      const overlap = toSeconds(trnClipEnd(out.clip)) - toSeconds(inn.clip.start)
      if (overlap < want - 1 / 24000) {
        const shiftTicks = Math.round((want - Math.max(0, overlap)) * next.timeline.timescale)
        for (const clip of out.track.clips) {
          if (compareTime(clip.start, inn.clip.start) >= 0) {
            clip.start = { ticks: clip.start.ticks - shiftTicks, timescale: clip.start.timescale }
          }
        }
        warnings.push(`Dissolve overlapped incoming by ${want.toFixed(2)}s. Sequence shortened; originals unchanged.`)
      }
      out.track.transitions.push({
        id: newId('trn'),
        kind,
        outgoingClipId: out.clip.id,
        incomingClipId: inn.clip.id,
        duration,
        params: { curve: 'linear', audioCrossfade: true },
      })
      break
    }
    case 'updateTransition': {
      const found = next.timeline.tracks.flatMap(t => t.transitions.map(tr => ({ track: t, tr }))).find(row => row.tr.id === command.transitionId)
      if (!found) return { project, ...fail('Transition not found.') }
      if (command.transitionKind) found.tr.kind = command.transitionKind
      if (command.duration) {
        const duration = parseMediaTime(command.duration, next.timeline.timescale)
        const out = found.track.clips.find(c => c.id === found.tr.outgoingClipId)
        const inn = found.track.clips.find(c => c.id === found.tr.incomingClipId)
        if (!out || !inn) return { project, ...fail('Transition clips not found.') }
        const durErr = validateDissolveDuration(out, inn, duration)
        if (durErr) return { project, ...fail(durErr) }
        found.tr.duration = duration
      }
      break
    }
    case 'removeTransition': {
      let removed = false
      for (const track of next.timeline.tracks) {
        const before = track.transitions.length
        track.transitions = track.transitions.filter(t => t.id !== command.transitionId)
        if (track.transitions.length !== before) removed = true
      }
      if (!removed) return { project, ...fail('Transition not found.') }
      break
    }
    case 'setPan': {
      const found = findClip(next, command.clipId)
      if (!found) return { project, ...fail('Clip not found.') }
      if (!Number.isFinite(command.pan)) return { project, ...fail('Pan must be a number in -1..+1.') }
      if (command.pan < -1 || command.pan > 1) return { project, ...fail('Pan must be in the range -1 (left) to +1 (right).') }
      found.clip.pan = clampPan(command.pan)
      break
    }
    case 'applyEffect': {
      const found = findClip(next, command.clipId)
      if (!found) return { project, ...fail('Clip not found.') }
      found.clip.effects.push({
        id: newId('fx'),
        effectId: command.effectId,
        enabled: true,
        params: command.params ?? {},
      })
      break
    }
    case 'applyFilter': {
      const found = findClip(next, command.clipId)
      if (!found) return { project, ...fail('Clip not found.') }
      found.clip.filters = found.clip.filters.filter(f => f.filterId !== command.filterId)
      found.clip.filters.push({
        id: newId('flt'),
        filterId: command.filterId,
        amount: Math.max(0, Math.min(1, command.amount)),
        enabled: true,
      })
      break
    }
    case 'applyTheme': {
      const theme = getThemeSpec(command.themeId)
      if (!theme) return { project, ...fail('ThemeSpec not found.') }
      next.timeline.themeId = theme.id
      const cap = next.timeline.captionTracks[0]
      if (cap) {
        cap.themeId = theme.id
        cap.fontFamily = theme.typography.captionFamily
        cap.fontSize = theme.typography.captionSize
        cap.position = theme.captionStyle.position
        cap.animationStyle = theme.captionStyle.animation
      }
      for (const track of next.timeline.tracks) {
        if (track.kind !== 'video') continue
        for (const clip of track.clips) {
          clip.color = {
            ...clip.color,
            exposure: theme.color.exposure,
            contrast: theme.color.contrast,
            saturation: theme.color.saturation,
            temperature: theme.color.temperature,
            lookId: theme.color.lookId,
          }
        }
        if (track.clips.length >= 2 && track.transitions.length === 0) {
          const a = track.clips[0]
          const b = track.clips[1]
          const duration = theme.transitions.defaultDuration
          const want = toSeconds(duration)
          const overlap = toSeconds(addTime(a.start, a.duration)) - toSeconds(b.start)
          if (overlap < want - 1 / 24000) {
            const shiftTicks = Math.round((want - Math.max(0, overlap)) * next.timeline.timescale)
            for (const clip of track.clips) {
              if (compareTime(clip.start, b.start) >= 0) {
                clip.start = { ticks: clip.start.ticks - shiftTicks, timescale: clip.start.timescale }
              }
            }
          }
          track.transitions.push({
            id: newId('trn'),
            kind: theme.transitions.defaultKind,
            outgoingClipId: a.id,
            incomingClipId: b.id,
            duration,
            params: { curve: 'linear', audioCrossfade: true },
          })
        }
      }
      break
    }
    case 'addCaption': {
      const track = next.timeline.captionTracks.find(t => t.id === (command.captionTrackId ?? t.id)) ?? next.timeline.captionTracks[0]
      if (!track) return { project, ...fail('Caption track not found.') }
      if (command.position) track.position = command.position
      if (command.fontFamily) track.fontFamily = command.fontFamily
      if (command.fontSize) track.fontSize = command.fontSize
      track.cues = uniqueCaptionCues(track.cues)
      const start = parseMediaTime(command.start, next.timeline.timescale)
      const end = parseMediaTime(command.end, next.timeline.timescale)
      if (compareTime(end, start) <= 0) return { project, ...fail('Caption OUT must be greater than IN.') }
      const text = command.text.trim()
      const duplicate = track.cues.find(cue => {
        if (cue.text.trim() !== text) return false
        const overlap = compareTime(start, cue.end) < 0 && compareTime(end, cue.start) > 0
        return overlap
      })
      if (duplicate) {
        warnings.push('Duplicate overlapping caption ignored — one cue remains.')
        break
      }
      const preset = command.positionPreset ?? (command.position === 'top' ? 'top-center' : command.position === 'center' ? 'center' : 'bottom-center')
      const baked = preset === 'custom' ? { x: command.x ?? 0.5, y: command.y ?? 0.88 } : POSITION_PRESETS[preset]
      track.cues.push({
        id: newId('cue'),
        start,
        end,
        text: command.text,
        speaker: command.speaker ?? null,
        words: [],
        positionPreset: preset,
        x: command.x ?? baked.x,
        y: command.y ?? baked.y,
        alignment: command.alignment ?? (preset === 'custom' ? 'center' : POSITION_PRESETS[preset].alignment),
        fontFamily: command.fontFamily,
        fontSize: command.fontSize,
        fontWeight: command.fontWeight,
        fontStyle: command.fontStyle,
        color: command.color,
        background: command.background,
        backgroundOpacity: command.backgroundOpacity,
        outlineColor: command.outlineColor,
        outlineWidth: command.outlineWidth,
        shadow: command.shadow,
        lineSpacing: command.lineSpacing,
        maxWidth: command.maxWidth,
        safeAreaLock: command.safeAreaLock,
      })
      track.cues.sort((a, b) => a.start.ticks - b.start.ticks)
      break
    }
    case 'updateCaption': {
      const track = next.timeline.captionTracks.find(t => t.id === (command.captionTrackId ?? t.id)) ?? next.timeline.captionTracks[0]
      if (!track) return { project, ...fail('Caption track not found.') }
      const cue = track.cues.find(c => c.id === command.cueId)
      if (!cue) return { project, ...fail('Caption cue not found.') }
      if (command.text !== undefined) cue.text = command.text
      if (command.start) cue.start = parseMediaTime(command.start, next.timeline.timescale)
      if (command.end) cue.end = parseMediaTime(command.end, next.timeline.timescale)
      if (command.duration) cue.end = addTime(cue.start, parseMediaTime(command.duration, next.timeline.timescale))
      if (compareTime(cue.end, cue.start) <= 0) return { project, ...fail('Caption OUT must be greater than IN.') }
      if (command.position) track.position = command.position
      if (command.positionPreset) {
        cue.positionPreset = command.positionPreset
        if (command.positionPreset !== 'custom') {
          const baked = POSITION_PRESETS[command.positionPreset]
          cue.x = baked.x
          cue.y = baked.y
          cue.alignment = baked.alignment
          track.position = command.positionPreset.startsWith('top') ? 'top' : command.positionPreset === 'center' ? 'center' : 'bottom'
        }
      }
      if (command.x !== undefined) { cue.x = command.x; cue.positionPreset = 'custom' }
      if (command.y !== undefined) { cue.y = command.y; cue.positionPreset = 'custom' }
      if (command.alignment) cue.alignment = command.alignment
      if (command.fontFamily) { cue.fontFamily = command.fontFamily; track.fontFamily = command.fontFamily }
      if (command.fontSize !== undefined) { cue.fontSize = command.fontSize; track.fontSize = command.fontSize }
      if (command.fontWeight !== undefined) cue.fontWeight = command.fontWeight
      if (command.fontStyle) cue.fontStyle = command.fontStyle
      if (command.color) cue.color = command.color
      if (command.background !== undefined) cue.background = command.background
      if (command.backgroundOpacity !== undefined) cue.backgroundOpacity = command.backgroundOpacity
      if (command.outlineColor) cue.outlineColor = command.outlineColor
      if (command.outlineWidth !== undefined) cue.outlineWidth = command.outlineWidth
      if (command.shadow !== undefined) cue.shadow = command.shadow
      if (command.lineSpacing !== undefined) cue.lineSpacing = command.lineSpacing
      if (command.maxWidth !== undefined) cue.maxWidth = command.maxWidth
      if (command.safeAreaLock !== undefined) cue.safeAreaLock = command.safeAreaLock
      if (command.clampToSafe) {
        const theme = next.timeline.themeId ? getThemeSpec(next.timeline.themeId) : null
        const dims = aspectDimensions(next.timeline.aspect)
        const style = resolveCaptionStyle(cue, track, theme)
        const clamped = clampStyleToTitleSafe(style, dims.width, dims.height)
        cue.x = clamped.x
        cue.y = clamped.y
        cue.positionPreset = 'custom'
      }
      track.cues = uniqueCaptionCues(track.cues)
      break
    }
    case 'addTitle': {
      const preset = command.stylePreset ? getTitlePreset(command.stylePreset) : null
      const positionPreset = command.positionPreset ?? preset?.positionPreset ?? 'top-center'
      const baked = positionPreset === 'custom' ? { x: 0.5, y: 0.18, alignment: 'center' as const } : POSITION_PRESETS[positionPreset]
      let overlay = {
        id: newId('ov'),
        kind: 'title' as const,
        titleKind: command.titleKind ?? preset?.titleKind ?? 'title',
        assetId: null,
        text: command.text,
        secondaryText: command.secondaryText ?? null,
        start: parseMediaTime(command.start, next.timeline.timescale),
        duration: parseMediaTime(command.duration, next.timeline.timescale),
        x: command.x ?? preset?.x ?? baked.x,
        y: command.y ?? preset?.y ?? baked.y,
        scale: command.scale ?? preset?.scale ?? 1,
        rotation: command.rotation ?? 0,
        opacity: command.opacity ?? 1,
        alignment: command.alignment ?? preset?.alignment ?? baked.alignment,
        fontFamily: command.fontFamily ?? preset?.fontFamily,
        fontSize: command.fontSize ?? preset?.fontSize,
        fontWeight: command.fontWeight ?? preset?.fontWeight,
        color: command.color ?? preset?.color,
        background: command.background ?? preset?.background ?? null,
        backgroundOpacity: preset?.backgroundOpacity,
        outlineColor: command.outlineColor ?? preset?.outlineColor,
        outlineWidth: preset?.outlineWidth,
        shadow: command.shadow ?? preset?.shadow,
        maxWidth: command.maxWidth ?? preset?.maxWidth,
        positionPreset,
        stylePreset: command.stylePreset ?? null,
        safeAreaLock: command.safeAreaLock ?? false,
        provenance: { preset: command.stylePreset ?? null, createdBy: command.actor, createdAt: command.createdAt },
      }
      if (preset) overlay = applyTitlePreset(overlay, preset)
      if (command.text) overlay.text = command.text
      next.timeline.overlays.push(overlay)
      break
    }
    case 'addLowerThird': {
      const preset = getTitlePreset(command.stylePreset ?? 'lower-third') ?? getTitlePreset('lower-third')
      if (!preset) return { project, ...fail('Lower-third preset missing.') }
      const overlay = applyTitlePreset({
        id: newId('ov'),
        kind: 'title',
        titleKind: 'lower-third',
        assetId: null,
        text: command.text,
        secondaryText: command.secondaryText ?? null,
        start: parseMediaTime(command.start, next.timeline.timescale),
        duration: parseMediaTime(command.duration, next.timeline.timescale),
        x: command.x ?? preset.x,
        y: command.y ?? preset.y,
        scale: 1,
        rotation: 0,
        opacity: 1,
        provenance: { preset: preset.id, createdBy: command.actor, createdAt: command.createdAt },
      }, preset)
      overlay.text = command.text
      overlay.secondaryText = command.secondaryText ?? null
      next.timeline.overlays.push(overlay)
      break
    }
    case 'updateTitle': {
      const overlay = next.timeline.overlays.find(o => o.id === command.overlayId)
      if (!overlay || overlay.kind === 'logo') return { project, ...fail('Title overlay not found.') }
      if (command.text !== undefined) overlay.text = command.text
      if (command.secondaryText !== undefined) overlay.secondaryText = command.secondaryText
      if (command.start) overlay.start = parseMediaTime(command.start, next.timeline.timescale)
      if (command.duration) overlay.duration = parseMediaTime(command.duration, next.timeline.timescale)
      if (command.positionPreset) {
        overlay.positionPreset = command.positionPreset
        if (command.positionPreset !== 'custom') {
          const baked = POSITION_PRESETS[command.positionPreset]
          overlay.x = baked.x
          overlay.y = baked.y
          overlay.alignment = baked.alignment
        }
      }
      if (command.x !== undefined) overlay.x = command.x
      if (command.y !== undefined) overlay.y = command.y
      if (command.scale !== undefined) overlay.scale = command.scale
      if (command.rotation !== undefined) overlay.rotation = command.rotation
      if (command.opacity !== undefined) overlay.opacity = Math.max(0, Math.min(1, command.opacity))
      if (command.alignment) overlay.alignment = command.alignment
      if (command.fontFamily) overlay.fontFamily = command.fontFamily
      if (command.fontSize !== undefined) overlay.fontSize = command.fontSize
      if (command.fontWeight !== undefined) overlay.fontWeight = command.fontWeight
      if (command.color) overlay.color = command.color
      if (command.background !== undefined) overlay.background = command.background
      if (command.backgroundOpacity !== undefined) overlay.backgroundOpacity = command.backgroundOpacity
      if (command.outlineColor) overlay.outlineColor = command.outlineColor
      if (command.outlineWidth !== undefined) overlay.outlineWidth = command.outlineWidth
      if (command.shadow !== undefined) overlay.shadow = command.shadow
      if (command.maxWidth !== undefined) overlay.maxWidth = command.maxWidth
      if (command.titleKind) overlay.titleKind = command.titleKind
      if (command.safeAreaLock !== undefined) overlay.safeAreaLock = command.safeAreaLock
      break
    }
    case 'moveTitle': {
      const overlay = next.timeline.overlays.find(o => o.id === command.overlayId)
      if (!overlay) return { project, ...fail('Overlay not found.') }
      overlay.x = command.x
      overlay.y = command.y
      overlay.positionPreset = 'custom'
      if (command.clampToSafe) {
        const theme = next.timeline.themeId ? getThemeSpec(next.timeline.themeId) : null
        const dims = aspectDimensions(next.timeline.aspect)
        if (overlay.kind === 'title') {
          const style = resolveOverlayStyle(overlay, theme)
          const clamped = clampStyleToTitleSafe(style, dims.width, dims.height)
          overlay.x = clamped.x
          overlay.y = clamped.y
        } else {
          overlay.x = Math.min(0.9, Math.max(0.1, overlay.x))
          overlay.y = Math.min(0.9, Math.max(0.1, overlay.y))
        }
      }
      break
    }
    case 'setTitleStyle': {
      const overlay = next.timeline.overlays.find(o => o.id === command.overlayId && o.kind === 'title')
      if (!overlay) return { project, ...fail('Title overlay not found.') }
      if (command.stylePreset) {
        const preset = getTitlePreset(command.stylePreset)
        if (!preset) return { project, ...fail('Unknown title preset.') }
        const nextOverlay = applyTitlePreset(overlay, preset)
        Object.assign(overlay, nextOverlay)
      }
      if (command.fontFamily) overlay.fontFamily = command.fontFamily
      if (command.fontSize !== undefined) overlay.fontSize = command.fontSize
      if (command.fontWeight !== undefined) overlay.fontWeight = command.fontWeight
      if (command.color) overlay.color = command.color
      if (command.background !== undefined) overlay.background = command.background
      if (command.alignment) overlay.alignment = command.alignment
      if (command.positionPreset) {
        overlay.positionPreset = command.positionPreset
        if (command.positionPreset !== 'custom') {
          const baked = POSITION_PRESETS[command.positionPreset]
          overlay.x = baked.x
          overlay.y = baked.y
          overlay.alignment = command.alignment ?? baked.alignment
        }
      }
      break
    }
    case 'removeTitle': {
      const before = next.timeline.overlays.length
      next.timeline.overlays = next.timeline.overlays.filter(o => o.id !== command.overlayId)
      if (next.timeline.overlays.length === before) return { project, ...fail('Title overlay not found.') }
      break
    }
    case 'addLogo': {
      const asset = findAsset(next, command.assetId)
      if (!asset) return { project, ...fail('Logo asset not found.') }
      const theme = next.timeline.themeId ? getThemeSpec(next.timeline.themeId) : getThemeSpec(LUXURY_BEAUTY_V1_ID)
      next.timeline.overlays.push({
        id: newId('ov'),
        kind: 'logo',
        assetId: asset.id,
        text: null,
        start: parseMediaTime(command.start, next.timeline.timescale),
        duration: parseMediaTime(command.duration, next.timeline.timescale),
        x: command.x ?? theme?.logoPlacement.x ?? 0.82,
        y: command.y ?? theme?.logoPlacement.y ?? 0.08,
        scale: command.scale ?? theme?.logoPlacement.scale ?? 0.18,
        opacity: 1,
      })
      break
    }
    case 'addMusic':
    case 'addVoice': {
      const asset = findAsset(next, command.assetId)
      if (!asset) return { project, ...fail('Audio asset not found.') }
      const trackId = command.trackId ?? (command.kind === 'addMusic' ? 'A2' : 'A1')
      const track = requireTrack(next, trackId)
      if (!track) return { project, ...fail('Audio track not found.') }
      const start = command.start ? parseMediaTime(command.start, next.timeline.timescale) : zeroTime(next.timeline.timescale)
      const duration = convertTime(asset.duration, next.timeline.timescale)
      track.clips.push(makeClip({
        id: newId('clip'),
        trackId: track.id,
        assetId: asset.id,
        name: asset.name,
        start,
        duration,
        sourceIn: zeroTime(next.timeline.timescale),
        sourceOut: duration,
      }))
      sortClips(track)
      break
    }
    case 'setVolume': {
      const found = findClip(next, command.clipId)
      if (!found) return { project, ...fail('Clip not found.') }
      found.clip.volume = Math.max(0, Math.min(2, command.volume))
      break
    }
    case 'duckMusic': {
      const track = requireTrack(next, command.musicTrackId ?? 'A2')
      if (!track) return { project, ...fail('Music track not found.') }
      const factor = Math.max(0.05, Math.min(1, 1 + command.duckDb / 20))
      for (const clip of track.clips) clip.volume = Math.max(0.05, Math.min(1, factor))
      warnings.push(`Simple ducking applied to ${track.name}.`)
      break
    }
    case 'applyColor': {
      const found = findClip(next, command.clipId)
      if (!found) return { project, ...fail('Clip not found.') }
      found.clip.color = { ...found.clip.color, ...command.color }
      break
    }
    case 'trackSubject': {
      const found = findClip(next, command.clipId)
      if (!found) return { project, ...fail('Clip not found.') }
      const seed = command.seedBox ?? { x: 0.35, y: 0.18, width: 0.3, height: 0.62 }
      const keyframes = command.keyframes?.length
        ? command.keyframes.map(kf => ({
            time: parseMediaTime(kf.time, next.timeline.timescale),
            x: kf.x,
            y: kf.y,
            width: kf.width,
            height: kf.height,
            confidence: kf.confidence,
          }))
        : [
            { time: found.clip.start, ...seed, confidence: command.confidence ?? 0.55 },
            { time: clipEnd(found.clip), x: seed.x, y: seed.y, width: seed.width, height: seed.height, confidence: command.confidence ?? 0.4 },
          ]
      next.timeline.subjects = next.timeline.subjects.filter(s => s.clipId !== found.clip.id)
      next.timeline.subjects.push({
        id: newId('sub'),
        clipId: found.clip.id,
        assetId: found.clip.assetId,
        label: command.label,
        kind: command.subjectKind ?? 'person',
        status: command.status ?? 'tracking',
        confidence: command.confidence ?? (keyframes.reduce((s, k) => s + k.confidence, 0) / keyframes.length),
        humanCorrected: false,
        keyframes,
      })
      break
    }
    case 'correctTrack': {
      const found = findClip(next, command.clipId)
      if (!found) return { project, ...fail('Clip not found.') }
      const existing = next.timeline.subjects.find(s => s.clipId === found.clip.id)
      if (!existing) return { project, ...fail('No TrackSubject on this clip to correct.') }
      const at = parseMediaTime(command.at, next.timeline.timescale)
      next.timeline.subjects = next.timeline.subjects.map(s => (
        s.id === existing.id
          ? correctSubject(s, command.box, at.ticks, at.timescale)
          : s
      ))
      break
    }
    case 'reacquireTrack': {
      const found = findClip(next, command.clipId)
      if (!found) return { project, ...fail('Clip not found.') }
      const existing = next.timeline.subjects.find(s => s.clipId === found.clip.id)
      if (!existing) return { project, ...fail('No TrackSubject on this clip to reacquire.') }
      const from = parseMediaTime(command.from, next.timeline.timescale)
      const incoming = (command.keyframes ?? []).map(kf => ({
        time: parseMediaTime(kf.time, next.timeline.timescale),
        x: kf.x,
        y: kf.y,
        width: kf.width,
        height: kf.height,
        confidence: kf.confidence,
      }))
      const prior = existing.keyframes.filter(kf => kf.time.ticks < from.ticks)
      const merged = [...prior, ...incoming.filter(kf => kf.time.ticks >= from.ticks)]
        .sort((a, b) => a.time.ticks - b.time.ticks)
      existing.keyframes = merged.length
        ? merged
        : [
            ...prior,
            {
              time: from,
              ...command.seedBox,
              confidence: 0.9,
            },
          ]
      existing.status = command.status ?? 'reacquired'
      existing.confidence = command.confidence ?? (
        existing.keyframes.reduce((sum, kf) => sum + kf.confidence, 0) / existing.keyframes.length
      )
      break
    }
    case 'clearTrack': {
      const found = findClip(next, command.clipId)
      if (!found) return { project, ...fail('Clip not found.') }
      const removed = next.timeline.subjects.filter(s => s.clipId === found.clip.id).map(s => s.id)
      next.timeline.subjects = next.timeline.subjects.filter(s => s.clipId !== found.clip.id)
      next.timeline.virtualCameras = next.timeline.virtualCameras.filter(c => !c.subjectId || !removed.includes(c.subjectId))
      break
    }
    case 'deriveVerticalVersion': {
      const parentId = next.currentVersionId
      const index = next.versions.length + 1
      const label = command.versionLabel ?? `${next.name.replace(/16:9 MASTER/i, '').trim() || next.name} — 9:16 VERTICAL`
      const version = {
        id: newId('ver'),
        projectId: next.id,
        index,
        label,
        createdAt: next.updatedAt,
        createdBy: command.actor,
        parentVersionId: parentId,
        snapshotPath: '',
        aspect: '9:16' as const,
        role: 'derived' as const,
        derivedFromVersionId: parentId,
      }
      next.versions.push(version)
      next.currentVersionId = version.id
      next.timeline.aspect = '9:16'
      next.timeline.width = 1080
      next.timeline.height = 1920
      next.timeline.name = label
      const mode = command.mode ?? 'FACE_LOCK'
      const subject = next.timeline.subjects[0] ?? null
      const dims = { width: 1080, height: 1920 }
      next.timeline.virtualCameras = next.timeline.virtualCameras.filter(c => c.outputAspect !== '9:16')
      next.timeline.virtualCameras.push({
        id: newId('vcam'),
        name: `9:16 ${mode}`,
        sourceAspect: projectSourceAspect(next),
        outputAspect: '9:16',
        mode,
        subjectId: subject?.id ?? null,
        outputWidth: dims.width,
        outputHeight: dims.height,
        keyframes: (subject?.keyframes ?? [{ time: zeroTime(next.timeline.timescale), x: 0.5, y: 0.5, width: 0.2, height: 0.4, confidence: 0.5 }]).map(kf => ({
          time: kf.time,
          crop: followFramingCrop(kf, mode, '9:16', projectSourceRatio(next)),
          transform: IDENTITY_TRANSFORM,
        })),
      })
      for (const cap of next.timeline.captionTracks) {
        cap.position = 'bottom'
        cap.fontSize = Math.round((cap.fontSize || 38) * 0.92)
      }
      for (const overlay of next.timeline.overlays) {
        if (overlay.kind === 'logo') {
          overlay.x = 0.5
          overlay.y = 0.12
        } else if (overlay.kind === 'title') {
          overlay.y = 0.16
        }
      }
      warnings.push('Derived 9:16 version retains provenance to master assets. VirtualCamera follows TrackSubject — not a static center crop.')
      break
    }
    case 'setFade': {
      const found = findClip(next, command.clipId)
      if (!found) return { project, ...fail('Clip not found.') }
      if (command.fadeIn) found.clip.fadeIn = parseMediaTime(command.fadeIn, next.timeline.timescale)
      if (command.fadeOut) found.clip.fadeOut = parseMediaTime(command.fadeOut, next.timeline.timescale)
      break
    }
    case 'setVirtualCamera':
    case 'autoReframe': {
      if (command.kind === 'setVirtualCamera' && command.reset) {
        next.timeline.virtualCameras = next.timeline.virtualCameras.filter(c => c.outputAspect !== command.outputAspect)
        break
      }
      const aspect = command.outputAspect
      const mode = command.kind === 'autoReframe' ? (command.mode ?? 'RULE_OF_THIRDS') : command.mode
      const subjectId = command.subjectId ?? next.timeline.subjects[0]?.id ?? null
      const subject = next.timeline.subjects.find(s => s.id === subjectId) ?? next.timeline.subjects[0] ?? null
      const dims = aspect === '9:16' ? { width: 1080, height: 1920 } : aspect === '1:1' ? { width: 1080, height: 1080 } : { width: 1920, height: 1080 }
      const cam = {
        id: newId('vcam'),
        name: `${aspect} ${mode}`,
        sourceAspect: projectSourceAspect(next),
        outputAspect: aspect,
        mode,
        subjectId: subject?.id ?? null,
        outputWidth: dims.width,
        outputHeight: dims.height,
        keyframes: (subject?.keyframes ?? [{ time: zeroTime(next.timeline.timescale), x: 0.5, y: 0.5, width: 0.2, height: 0.4, confidence: 0.5 }]).map(kf => ({
          time: kf.time,
          crop: followFramingCrop(kf, mode, aspect, projectSourceRatio(next)),
          transform: IDENTITY_TRANSFORM,
        })),
      }
      next.timeline.virtualCameras = next.timeline.virtualCameras.filter(c => c.outputAspect !== aspect)
      next.timeline.virtualCameras.push(cam)
      warnings.push(subject
        ? 'Virtual camera follows the tracked subject in this project.'
        : 'Uses geometric framing. This is not AI person tracking.')
      break
    }
    case 'replaceAsset': {
      const found = findClip(next, command.clipId)
      const asset = findAsset(next, command.assetId)
      if (!found || !asset) return { project, ...fail('Clip or asset not found.') }
      found.clip.assetId = asset.id
      found.clip.name = asset.name
      break
    }
    case 'generateVideo':
    case 'generateImage': {
      next.providerJobs.push({
        id: newId('pjob'),
        projectId: next.id,
        category: command.kind === 'generateVideo' ? 'VIDEO_GENERATOR' : 'IMAGE_GENERATOR',
        providerId: null,
        status: 'blocked_pending_approval',
        request: { prompt: command.prompt, insert: command.insert ?? false },
        assetId: null,
        error: 'Commander has not authorized provider spend. No remote request was sent.',
        createdAt: next.updatedAt,
        updatedAt: next.updatedAt,
      })
      warnings.push('Provider job blocked pending spend approval. Router does not submit unconfigured or paid backends.')
      break
    }
    case 'updateEffectGraph': {
      const graph = command.graph as unknown as HvsEffectGraph
      const check = validateEffectGraph(graph, {
        assetIds: new Set(next.assets.map(a => a.id)),
        subjectIds: new Set(next.timeline.subjects.map(s => s.id)),
      })
      if (!check.ok) return { project, ...fail(check.errors.join('; ')) }
      const idx = next.effectGraphs.findIndex(g => g.id === graph.id)
      if (idx >= 0) next.effectGraphs[idx] = graph
      else next.effectGraphs.push(graph)
      break
    }
    case 'addEffectNode': {
      const graph = (command.graphId ? next.effectGraphs.find(g => g.id === command.graphId) : null) ?? next.effectGraphs[0]
      if (!graph) return { project, ...fail('No EffectGraph on this project.') }
      const raw = command.node
      const kind = String(raw.kind ?? '') as HvsEffectNodeKind
      const node: HvsEffectNode = {
        id: String(raw.id ?? `n-${Date.now().toString(36)}`),
        kind,
        ...defaultPorts(kind),
        parameters: (raw.parameters as Record<string, unknown>) ?? {},
        enabled: raw.enabled !== false,
      }
      const proposed: HvsEffectGraph = { ...graph, nodes: [...graph.nodes, node] }
      const check = validateEffectGraph(proposed, { assetIds: new Set(next.assets.map(a => a.id)), subjectIds: new Set(next.timeline.subjects.map(s => s.id)) })
      if (!check.ok) return { project, ...fail(check.errors.join('; ')) }
      const idx = next.effectGraphs.findIndex(g => g.id === graph.id)
      next.effectGraphs[idx] = proposed
      break
    }
    case 'removeEffectNode': {
      const graph = (command.graphId ? next.effectGraphs.find(g => g.id === command.graphId) : null) ?? next.effectGraphs[0]
      if (!graph) return { project, ...fail('No EffectGraph on this project.') }
      const proposed: HvsEffectGraph = {
        ...graph,
        nodes: graph.nodes.filter(n => n.id !== command.nodeId),
        connections: graph.connections.filter(c => c.fromNode !== command.nodeId && c.toNode !== command.nodeId),
      }
      const check = validateEffectGraph(proposed, { assetIds: new Set(next.assets.map(a => a.id)) })
      if (!check.ok) return { project, ...fail(check.errors.join('; ')) }
      const idx = next.effectGraphs.findIndex(g => g.id === graph.id)
      next.effectGraphs[idx] = proposed
      break
    }
    case 'updateEffectNode': {
      const graph = (command.graphId ? next.effectGraphs.find(g => g.id === command.graphId) : null) ?? next.effectGraphs[0]
      if (!graph) return { project, ...fail('No EffectGraph on this project.') }
      const proposed: HvsEffectGraph = {
        ...graph,
        nodes: graph.nodes.map(n => n.id === command.nodeId ? {
          ...n,
          ...(command.enabled !== undefined ? { enabled: command.enabled } : {}),
          parameters: { ...n.parameters, ...command.parameters },
        } : n),
      }
      const check = validateEffectGraph(proposed, { assetIds: new Set(next.assets.map(a => a.id)), subjectIds: new Set(next.timeline.subjects.map(s => s.id)) })
      if (!check.ok) return { project, ...fail(check.errors.join('; ')) }
      const idx = next.effectGraphs.findIndex(g => g.id === graph.id)
      next.effectGraphs[idx] = proposed
      break
    }
    case 'connectEffectNodes': {
      const graph = (command.graphId ? next.effectGraphs.find(g => g.id === command.graphId) : null) ?? next.effectGraphs[0]
      if (!graph) return { project, ...fail('No EffectGraph on this project.') }
      const proposed: HvsEffectGraph = {
        ...graph,
        connections: [...graph.connections.filter(c => !(c.toNode === command.toNode && c.toPort === command.toPort)), {
          fromNode: command.fromNode, fromPort: command.fromPort, toNode: command.toNode, toPort: command.toPort,
        }],
      }
      const check = validateEffectGraph(proposed, { assetIds: new Set(next.assets.map(a => a.id)) })
      if (!check.ok) return { project, ...fail(check.errors.join('; ')) }
      const idx = next.effectGraphs.findIndex(g => g.id === graph.id)
      next.effectGraphs[idx] = proposed
      break
    }
    case 'disconnectEffectNodes': {
      const graph = (command.graphId ? next.effectGraphs.find(g => g.id === command.graphId) : null) ?? next.effectGraphs[0]
      if (!graph) return { project, ...fail('No EffectGraph on this project.') }
      const proposed: HvsEffectGraph = {
        ...graph,
        connections: graph.connections.filter(c => !(c.fromNode === command.fromNode && c.toNode === command.toNode && (command.toPort ? c.toPort === command.toPort : true))),
      }
      const check = validateEffectGraph(proposed, { assetIds: new Set(next.assets.map(a => a.id)) })
      if (!check.ok) return { project, ...fail(check.errors.join('; ')) }
      const idx = next.effectGraphs.findIndex(g => g.id === graph.id)
      next.effectGraphs[idx] = proposed
      break
    }
    case 'updateColorPipeline':
    case 'pasteColorPipeline': {
      const pipeline = identityColorPipelineOr(command.pipeline as unknown as ColorPipeline)
      const check = validateColorPipeline(pipeline, new Set(next.assets.map(a => a.id)))
      if (!check.ok) return { project, ...fail(check.errors.join('; ')) }
      next.colorPipeline = pipeline
      break
    }
    case 'copyColorPipeline':
      warnings.push('COPY GRADE copies structured ColorPipeline only. Paste via pasteColorPipeline. Media is not baked.')
      break
    case 'updateAudioGraph': {
      const graph = command.graph as unknown as AudioGraph
      const check = validateAudioGraph(graph, new Set(next.timeline.tracks.map(t => t.id)))
      if (!check.ok) return { project, ...fail(check.errors.join('; ')) }
      next.audioGraph = graph
      break
    }
    case 'createVersion': {
      const index = next.versions.length + 1
      const version = {
        id: newId('ver'),
        projectId: next.id,
        index,
        label: command.versionLabel,
        createdAt: next.updatedAt,
        createdBy: command.createdBy,
        parentVersionId: next.currentVersionId,
        snapshotPath: '',
        aspect: next.timeline.aspect,
        role: (next.timeline.aspect === '9:16' ? 'derived' : 'master') as 'master' | 'derived',
        derivedFromVersionId: next.currentVersionId,
        description: command.description ?? '',
      }
      next.versions.push(version)
      next.currentVersionId = version.id
      break
    }
    case 'restoreVersion':
      return { project, ...fail('restoreVersion is applied by the command store from a snapshot file, not as a direct timeline mutation.') }
    case 'createVersionFrom':
      return { project, ...fail('createVersionFrom is applied by the command store from a snapshot file, not as a direct timeline mutation.') }
    case 'undo':
      return { project, ...fail('Undo is applied by the command store from a snapshot, not as a direct timeline mutation.') }
    case 'redo':
      return { project, ...fail('Redo is applied by the command store from a snapshot, not as a direct timeline mutation.') }
    case 'render': {
      const dims = command.aspect === '9:16' ? { width: 1080, height: 1920 } : command.aspect === '1:1' ? { width: 1080, height: 1080 } : { width: 1920, height: 1080 }
      next.renderJobs.push({
        id: newId('rjob'),
        projectId: next.id,
        versionId: next.currentVersionId,
        status: 'queued',
        target: {
          aspect: command.aspect,
          width: dims.width,
          height: dims.height,
          format: 'mp4',
          videoCodec: 'h264',
          audioCodec: 'aac',
        },
        outputPath: null,
        outputAssetId: null,
        encoder: null,
        probe: null,
        error: null,
        createdAt: next.updatedAt,
        updatedAt: next.updatedAt,
        blockedReason: null,
        startedAt: null,
        completedAt: null,
        cancelRequested: false,
        laneProvenance: null,
      })
      break
    }
    default:
      return { project, ...fail(`Unhandled EditCommand.`, 'SCHEMA') }
  }

  next.undoStack = [...next.undoStack, command.id]
  next.redoStack = []
  return { ok: true, command, warnings, project: next }
}

export function invertibleKinds(): string[] {
  return ['moveClip', 'trimClip', 'setTransform', 'setCrop', 'setOpacity', 'setSpeed', 'setVolume', 'setPan', 'applyColor']
}

export function clipAtPlayhead(project: HvsProject, playhead: { ticks: number; timescale: number }, kind: Track['kind'] = 'video'): Clip | null {
  const t = mediaTime(playhead.ticks, playhead.timescale)
  for (const track of [...project.timeline.tracks].reverse()) {
    if (track.kind !== kind || track.muted) continue
    for (const clip of track.clips) {
      if (compareTime(t, clip.start) >= 0 && compareTime(t, clipEnd(clip)) < 0) return clip
    }
  }
  return null
}

export function secondsToPlayhead(seconds: number, timescale: number) {
  return fromSeconds(seconds, timescale)
}

export { toSeconds }
