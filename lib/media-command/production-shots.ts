/**
 * Human-friendly shot references for HVS revision chat.
 * Commander sees "Opening shot" / "Shot 2" / "Closing shot", never clip IDs.
 */
import { toSeconds } from './time'
import type { Clip, HvsProject } from './types'
import type { HvsShotReference, HvsShotRole } from './production-ai-types'

export function videoClips(project: HvsProject): Clip[] {
  return project.timeline.tracks.find(track => track.kind === 'video')?.clips ?? []
}

export function shotLabel(index: number, total: number): string {
  if (total <= 1) return 'Opening shot'
  if (index === 0) return 'Opening shot'
  if (index === total - 1) return 'Closing shot'
  return `Shot ${index + 1}`
}

export function shotRole(index: number, total: number): HvsShotRole {
  if (index === 0) return 'open'
  if (index === total - 1) return 'close'
  return 'body'
}

export function shotReferences(project: HvsProject): HvsShotReference[] {
  const clips = videoClips(project)
  return clips.map((clip, index) => ({
    label: shotLabel(index, clips.length),
    index,
    clipId: clip.id,
    sourceAssetId: clip.assetId,
    sourceStartSec: toSeconds(clip.sourceIn),
    sourceEndSec: toSeconds(clip.sourceOut),
    timelineStartSec: toSeconds(clip.start),
    timelineEndSec: toSeconds(clip.start) + toSeconds(clip.duration),
    role: shotRole(index, clips.length),
  }))
}

export function parseShotMention(utterance: string, refs: HvsShotReference[]): HvsShotReference | null {
  const lower = utterance.toLowerCase()
  if (!refs.length) return null
  if (/\bopening\b|\bfirst shot\b|\bthe first clip\b|\bshot 1\b/.test(lower)) {
    return refs[0]
  }
  if (/\bclosing\b|\bending\b|\blast shot\b|\bfinal shot\b|\blast clip\b/.test(lower)) {
    return refs[refs.length - 1]
  }
  const ordinals: Array<[RegExp, number]> = [
    [/\bsecond clip\b|\bsecond shot\b|\bshot 2\b|\bthe second\b/, 1],
    [/\bthird clip\b|\bthird shot\b|\bshot 3\b|\bthe third\b/, 2],
    [/\bfourth clip\b|\bfourth shot\b|\bshot 4\b/, 3],
    [/\bfifth clip\b|\bfifth shot\b|\bshot 5\b/, 4],
    [/\bsixth clip\b|\bsixth shot\b|\bshot 6\b/, 5],
  ]
  for (const [pattern, index] of ordinals) {
    if (pattern.test(lower) && refs[index]) return refs[index]
  }
  const numbered = lower.match(/\bshot\s+(\d+)\b/)
  if (numbered) {
    const index = Number(numbered[1]) - 1
    if (refs[index]) return refs[index]
  }
  return null
}

export function describeShot(ref: HvsShotReference | null, fallback = 'that shot'): string {
  return ref?.label ?? fallback
}
