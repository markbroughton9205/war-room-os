/**
 * Project versions live inside one .hvsproj. Snapshots are immutable .hvsproj files.
 * This is not Git and not a second project store.
 *
 * Undo/redo policy B: restore writes a PRE-RESTORE safety snapshot, restores
 * historical authoring state into the live project, then resets command history
 * so Undo cannot cross incompatible snapshots. Return via the safety version.
 */
import { cloneProject, timelineDuration, type HvsProject, type ProjectVersion, type Timeline } from './types'
import { toSeconds } from './time'

export const HVS_VERSION_RESTORE_POLICY =
  'Policy B: restore writes a PRE-RESTORE safety snapshot of the live committed project, restores the selected historical snapshot into live authoring fields, sets currentVersionId to the restored version, and resets undo/redo so history does not cross incompatible snapshots. Commander returns to the pre-restore state by restoring the safety version.'

export const VERSION_NAME_PRESETS = ['AI FIRST CUT', 'VERTICAL CUT', 'ALTERNATE CUT', 'REVIEW COPY'] as const

export function safetyRestoreLabel(at = new Date()): string {
  return `PRE-RESTORE — ${at.toISOString().replace('T', ' ').slice(0, 19)} UTC`
}

export type VersionSummary = {
  id: string
  index: number
  name: string
  createdAt: string
  createdBy: ProjectVersion['createdBy']
  parentVersionId: string | null
  description: string
  durationSec: number
  aspect: string
  clipCount: number
  trackCount: number
  captionCount: number
  titleCount: number
  logoCount: number
  transitionCount: number
  renderCount: number
  assetCount: number
  thumbnailPath: string | null
  hasSnapshot: boolean
  isCurrent: boolean
  restoredFromVersionId: string | null
}

export type TimelineStats = {
  durationSec: number
  aspect: string
  clipCount: number
  trackCount: number
  captionCount: number
  titleCount: number
  logoCount: number
  transitionCount: number
  assetCount: number
  thumbnailPath: string | null
}

export type VersionCompare = {
  a: VersionSummary
  b: VersionSummary
  addedClipIds: string[]
  removedClipIds: string[]
  movedClipIds: string[]
  changedClipIds: string[]
  durationDeltaSec: number
  clipCountDelta: number
}

export type VersionLineageNode = {
  id: string
  index: number
  name: string
  depth: number
  parentVersionId: string | null
  isCurrent: boolean
}

export function countClips(timeline: Timeline): number {
  return timeline.tracks.reduce((n, track) => n + track.clips.length, 0)
}

export function timelineStats(project: HvsProject): TimelineStats {
  const timeline = project.timeline
  const firstVideo = timeline.tracks.find(t => t.kind === 'video')?.clips[0]
  const thumbAsset = firstVideo ? project.assets.find(a => a.id === firstVideo.assetId) : project.assets.find(a => a.thumbPath)
  return {
    durationSec: toSeconds(timelineDuration(timeline)),
    aspect: timeline.aspect,
    clipCount: countClips(timeline),
    trackCount: timeline.tracks.length,
    captionCount: timeline.captionTracks.reduce((n, track) => n + track.cues.length, 0),
    titleCount: timeline.overlays.filter(o => o.kind === 'title').length,
    logoCount: timeline.overlays.filter(o => o.kind === 'logo').length,
    transitionCount: timeline.tracks.reduce((n, track) => n + track.transitions.length, 0),
    assetCount: project.assets.length,
    thumbnailPath: thumbAsset?.thumbPath ?? null,
  }
}

export function summarizeVersion(
  project: HvsProject,
  version: ProjectVersion,
  source: HvsProject | null,
  options?: { live?: HvsProject },
): VersionSummary {
  const stats = source ? timelineStats(source) : {
    durationSec: version.durationSec ?? 0,
    aspect: version.aspect ?? project.timeline.aspect,
    clipCount: version.clipCount ?? 0,
    trackCount: 0,
    captionCount: 0,
    titleCount: 0,
    logoCount: 0,
    transitionCount: 0,
    assetCount: 0,
    thumbnailPath: version.thumbnailPath ?? null,
  }
  const live = options?.live
  const renderCount = (live ?? project).renderJobs.filter(job => job.versionId === version.id).length
  return {
    id: version.id,
    index: version.index,
    name: version.label,
    createdAt: version.createdAt,
    createdBy: version.createdBy,
    parentVersionId: version.parentVersionId,
    description: version.description ?? '',
    durationSec: stats.durationSec,
    aspect: version.aspect ?? stats.aspect,
    clipCount: stats.clipCount,
    trackCount: stats.trackCount,
    captionCount: stats.captionCount,
    titleCount: stats.titleCount,
    logoCount: stats.logoCount,
    transitionCount: stats.transitionCount,
    renderCount,
    assetCount: stats.assetCount,
    thumbnailPath: version.thumbnailPath ?? stats.thumbnailPath,
    hasSnapshot: Boolean(version.snapshotPath),
    isCurrent: version.id === project.currentVersionId,
    restoredFromVersionId: version.restoredFromVersionId ?? null,
  }
}

export function findVersion(project: HvsProject, versionId: string): ProjectVersion | null {
  return project.versions.find(v => v.id === versionId) ?? null
}

export function findVersionByLabel(project: HvsProject, text: string): ProjectVersion | null {
  const needle = text.trim().toLowerCase()
  if (!needle) return null
  const numbered = needle.match(/version\s*(\d+)/i)
  if (numbered) {
    const index = Number(numbered[1])
    const byIndex = project.versions.find(v => v.index === index)
    if (byIndex) return byIndex
  }
  return project.versions.find(v => v.label.toLowerCase() === needle)
    ?? project.versions.find(v => v.label.toLowerCase().includes(needle))
    ?? null
}

export function versionLineage(project: HvsProject): VersionLineageNode[] {
  const byParent = new Map<string | null, ProjectVersion[]>()
  for (const version of project.versions) {
    const key = version.parentVersionId
    const list = byParent.get(key) ?? []
    list.push(version)
    byParent.set(key, list)
  }
  const nodes: VersionLineageNode[] = []
  const walk = (parentId: string | null, depth: number) => {
    const children = (byParent.get(parentId) ?? []).slice().sort((a, b) => a.index - b.index)
    for (const child of children) {
      nodes.push({
        id: child.id,
        index: child.index,
        name: child.label,
        depth,
        parentVersionId: child.parentVersionId,
        isCurrent: child.id === project.currentVersionId,
      })
      walk(child.id, depth + 1)
    }
  }
  walk(null, 0)
  const seen = new Set(nodes.map(n => n.id))
  for (const version of project.versions) {
    if (seen.has(version.id)) continue
    nodes.push({
      id: version.id,
      index: version.index,
      name: version.label,
      depth: 0,
      parentVersionId: version.parentVersionId,
      isCurrent: version.id === project.currentVersionId,
    })
  }
  return nodes
}

function clipIndex(project: HvsProject): Map<string, { start: number; duration: number; assetId: string; pan: number; speedN: number; reversed: boolean }> {
  const map = new Map<string, { start: number; duration: number; assetId: string; pan: number; speedN: number; reversed: boolean }>()
  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      map.set(clip.id, {
        start: toSeconds(clip.start),
        duration: toSeconds(clip.duration),
        assetId: clip.assetId,
        pan: clip.pan ?? 0,
        speedN: clip.speed?.n ?? 1,
        reversed: Boolean(clip.reversed),
      })
    }
  }
  return map
}

export function compareVersionProjects(
  live: HvsProject,
  aProject: HvsProject,
  aVersion: ProjectVersion,
  bProject: HvsProject,
  bVersion: ProjectVersion,
): VersionCompare {
  const a = summarizeVersion(live, aVersion, aProject, { live })
  const b = summarizeVersion(live, bVersion, bProject, { live })
  const aClips = clipIndex(aProject)
  const bClips = clipIndex(bProject)
  const addedClipIds: string[] = []
  const removedClipIds: string[] = []
  const movedClipIds: string[] = []
  const changedClipIds: string[] = []
  for (const id of aClips.keys()) {
    if (!bClips.has(id)) removedClipIds.push(id)
  }
  for (const [id, right] of bClips) {
    const left = aClips.get(id)
    if (!left) {
      addedClipIds.push(id)
      continue
    }
    if (Math.abs(left.start - right.start) > 1 / 24000) movedClipIds.push(id)
    if (
      left.assetId !== right.assetId
      || Math.abs(left.duration - right.duration) > 1 / 24000
      || Math.abs(left.pan - right.pan) > 0.001
      || left.speedN !== right.speedN
      || left.reversed !== right.reversed
    ) {
      changedClipIds.push(id)
    }
  }
  return {
    a,
    b,
    addedClipIds,
    removedClipIds,
    movedClipIds,
    changedClipIds,
    durationDeltaSec: b.durationSec - a.durationSec,
    clipCountDelta: b.clipCount - a.clipCount,
  }
}

export function mergeAssetsPreserve(live: HvsProject, snapshot: HvsProject): HvsProject['assets'] {
  const byId = new Map(live.assets.map(asset => [asset.id, asset]))
  for (const asset of snapshot.assets) {
    if (!byId.has(asset.id)) byId.set(asset.id, asset)
  }
  return [...byId.values()]
}

/** Live authoring fields that a version snapshot owns. Assets/renders/versions stay on the live project. */
export function applySnapshotAuthoring(live: HvsProject, snapshot: HvsProject): HvsProject {
  const next = cloneProject(live)
  next.timeline = cloneProject(snapshot).timeline
  next.scripts = cloneProject(snapshot).scripts
  next.storyboard = cloneProject(snapshot).storyboard
  next.characters = cloneProject(snapshot).characters
  next.assets = mergeAssetsPreserve(live, snapshot)
  next.beautyIdentityMorphing = snapshot.beautyIdentityMorphing
  next.effectGraphs = cloneProject(snapshot).effectGraphs
  next.colorPipeline = cloneProject(snapshot).colorPipeline
  next.audioGraph = cloneProject(snapshot).audioGraph
  return next
}

export function populateVersionFacts(version: ProjectVersion, frozen: HvsProject): ProjectVersion {
  const stats = timelineStats(frozen)
  return {
    ...version,
    aspect: frozen.timeline.aspect,
    durationSec: stats.durationSec,
    clipCount: stats.clipCount,
    thumbnailPath: stats.thumbnailPath,
  }
}

export function rendersForVersion(project: HvsProject, versionId: string) {
  return project.renderJobs.filter(job => job.versionId === versionId)
}
