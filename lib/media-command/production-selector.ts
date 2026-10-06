/**
 * HVS SELECTOR — deterministic first-pass ranking from existing Video Intelligence evidence.
 * Not artistic AGI. Scores motion, audio activity, shot completeness, and duration fit.
 */
import { toSeconds } from './time'
import { findAsset, type AssetRecord, type HvsProject } from './types'
import { loadObservationsSync } from './video-analysis'
import type { ObservationDocument, VideoObservation } from './video-intelligence'
import type {
  HvsMomentCandidate,
  HvsProductionIntent,
  HvsSelectorResult,
  HvsShotRole,
} from './production-ai-types'
import { HVS_SELECTOR_ENGINE } from './production-ai-types'

const MIN_FRAGMENT_SEC = 0.55
const DEFAULT_WINDOW_SEC = 2.8
const MAX_SHOT_SEC = 8

export function durationTolerance(targetSec: number, exact: boolean): { min: number; max: number; exact: boolean } {
  if (exact) return { min: targetSec, max: targetSec, exact: true }
  const pad = Math.max(2, targetSec * 0.08)
  return { min: Math.max(0.8, targetSec - pad), max: targetSec + pad, exact: false }
}

export function wantsExactDuration(prompt: string): boolean {
  return /\bexact(ly)?\b|\bon the (dot|nose)\b/i.test(prompt)
}

function yavgFrom(row: VideoObservation): number {
  const ev = row.evidence?.find(item => item.kind === 'ffmpeg-motion')
  const parsed = Number(ev?.note.match(/YAVG=([0-9.]+)/)?.[1])
  if (Number.isFinite(parsed)) return parsed
  const label = row.actions.find(action => /motion/i.test(action.label))?.label ?? ''
  if (label.includes('HIGH')) return 7
  if (label.includes('MEDIUM')) return 3
  if (label.includes('LOW')) return 1
  return 0
}

function audioScore(row: VideoObservation): number {
  const label = (row.audio_event ?? row.audioEvents?.[0] ?? '').toUpperCase()
  if (label.includes('SILENCE')) return 0
  if (label.includes('LOW ENERGY')) return 0.35
  if (label.includes('AUDIO ACTIVE')) return 1
  return 0.45
}

function videoSources(project: HvsProject, intent: HvsProductionIntent): AssetRecord[] {
  const wanted = intent.sourceAssetIds.length ? intent.sourceAssetIds : null
  return project.assets.filter(asset => {
    if (asset.kind !== 'video' && asset.kind !== 'image') return false
    if (wanted) return wanted.includes(asset.id)
    return true
  })
}

function splitAtBoundaries(duration: number, cuts: number[]): Array<{ start: number; end: number }> {
  const points = [0, ...cuts.filter(t => t > 0.2 && t < duration - 0.2).sort((a, b) => a - b), duration]
  const unique = points.filter((t, i) => i === 0 || t - points[i - 1] > 0.35)
  const ranges: Array<{ start: number; end: number }> = []
  for (let i = 0; i < unique.length - 1; i++) {
    ranges.push({ start: unique[i], end: unique[i + 1] })
  }
  return ranges.length ? ranges : [{ start: 0, end: duration }]
}

function motionWindows(duration: number, rows: VideoObservation[]): Array<{ start: number; end: number }> {
  if (duration <= DEFAULT_WINDOW_SEC + 0.4) return [{ start: 0, end: duration }]
  const peaks = rows
    .map(row => ({ t: toSeconds(row.timestamp), y: yavgFrom(row) }))
    .filter(row => row.y >= 2)
    .sort((a, b) => b.y - a.y)
  const windows: Array<{ start: number; end: number }> = []
  for (const peak of peaks.slice(0, 8)) {
    const start = Math.max(0, peak.t - 0.6)
    const end = Math.min(duration, Math.max(start + 1.1, peak.t + DEFAULT_WINDOW_SEC - 0.6))
    if (windows.some(existing => Math.min(existing.end, end) - Math.max(existing.start, start) > 0.8)) continue
    windows.push({ start, end })
  }
  if (!windows.length) {
    const step = Math.min(MAX_SHOT_SEC, Math.max(DEFAULT_WINDOW_SEC, duration / 3))
    for (let t = 0; t < duration - 0.4; t += step) {
      windows.push({ start: t, end: Math.min(duration, t + step) })
    }
  }
  return windows.sort((a, b) => a.start - b.start)
}

function rowsInRange(rows: VideoObservation[], start: number, end: number): VideoObservation[] {
  return rows.filter(row => {
    const t = toSeconds(row.timeRange?.start ?? row.timestamp)
    return t >= start - 0.05 && t <= end + 0.05
  })
}

function scoreRange(
  asset: AssetRecord,
  start: number,
  end: number,
  rows: VideoObservation[],
  used: HvsMomentCandidate[],
): HvsMomentCandidate {
  const duration = Math.max(0.05, end - start)
  const slice = rowsInRange(rows, start, end)
  const motionValues = slice.map(yavgFrom)
  const motionScore = motionValues.length
    ? Math.min(1, motionValues.reduce((sum, v) => sum + v, 0) / motionValues.length / 8)
    : 0.15
  const audioActivity = slice.length
    ? slice.reduce((sum, row) => sum + audioScore(row), 0) / slice.length
    : 0.4
  const silencePenalty = slice.filter(row => (row.audio_event ?? '').toUpperCase().includes('SILENCE')).length / Math.max(1, slice.length)
  const shortPenalty = duration < MIN_FRAGMENT_SEC ? 0.85 : duration < 1 ? 0.25 : 0
  const staticPenalty = motionScore < 0.08 ? 0.35 : 0
  const completeness = duration >= 1.2 ? 1 : duration / 1.2
  const visualChange = motionValues.length > 1
    ? Math.min(1, Math.abs(Math.max(...motionValues) - Math.min(...motionValues)) / 8)
    : motionScore
  const overlap = used
    .filter(item => item.assetId === asset.id)
    .reduce((best, item) => {
      const shared = Math.min(item.end, end) - Math.max(item.start, start)
      return Math.max(best, shared > 0 ? shared / duration : 0)
    }, 0)
  const duplicatePenalty = overlap > 0.45 ? overlap : 0
  const score = Number((
    0.34 * motionScore
    + 0.18 * audioActivity
    + 0.16 * completeness
    + 0.14 * visualChange
    - 0.22 * silencePenalty
    - 0.18 * staticPenalty
    - 0.3 * shortPenalty
    - 0.4 * duplicatePenalty
  ).toFixed(4))
  const evidence: string[] = []
  if (motionScore >= 0.35) evidence.push('meaningful motion')
  if (audioActivity >= 0.7) evidence.push('active audio')
  if (completeness >= 0.9) evidence.push('complete shot')
  if (visualChange >= 0.25) evidence.push('visual change')
  if (silencePenalty >= 0.5) evidence.push('quiet section')
  if (staticPenalty > 0) evidence.push('mostly still')
  if (duplicatePenalty > 0) evidence.push('overlaps another selected range')
  const reason = evidence[0]
    ? `HVS SELECTOR: ${evidence.slice(0, 3).join(', ')}`
    : 'HVS SELECTOR: usable section after edge trim'
  return {
    assetId: asset.id,
    start: Number(start.toFixed(3)),
    end: Number(end.toFixed(3)),
    duration: Number(duration.toFixed(3)),
    score,
    evidence,
    reason,
    shotId: `${asset.id}:${start.toFixed(2)}-${end.toFixed(2)}`,
    motionScore: Number(motionScore.toFixed(3)),
    audioActivity: Number(audioActivity.toFixed(3)),
    silencePenalty: Number(silencePenalty.toFixed(3)),
    duplicatePenalty: Number(duplicatePenalty.toFixed(3)),
  }
}

function assignRoles(selected: HvsMomentCandidate[]): HvsMomentCandidate[] {
  if (!selected.length) return selected
  return selected.map((item, index) => {
    let role: HvsShotRole = 'body'
    if (index === 0) role = 'open'
    if (index === selected.length - 1) role = 'close'
    if (selected.length === 1) role = 'open'
    return { ...item, role }
  })
}

function sortChronological(items: HvsMomentCandidate[], sources: AssetRecord[]): HvsMomentCandidate[] {
  const byAssetIndex = new Map(sources.map((asset, index) => [asset.id, index]))
  return [...items].sort((a, b) => {
    const ai = byAssetIndex.get(a.assetId) ?? 0
    const bi = byAssetIndex.get(b.assetId) ?? 0
    if (ai !== bi) return ai - bi
    return a.start - b.start
  })
}

function totalDuration(items: HvsMomentCandidate[]): number {
  return items.reduce((sum, row) => sum + row.duration, 0)
}

function overlapsUsed(item: HvsMomentCandidate, used: HvsMomentCandidate[], threshold = 0.45): boolean {
  return used.some(existing => {
    if (existing.assetId !== item.assetId) return false
    const shared = Math.min(existing.end, item.end) - Math.max(existing.start, item.start)
    return shared > 0 && shared / item.duration > threshold
  })
}

function qualityOk(item: HvsMomentCandidate, selected: HvsMomentCandidate[]): boolean {
  if ((item.duplicatePenalty ?? 0) > 0.45) return false
  if ((item.silencePenalty ?? 0) >= 0.7 && (item.motionScore ?? 0) < 0.1) return false
  if ((item.motionScore ?? 0) < 0.06 && (item.audioActivity ?? 0) < 0.2) return false
  const selectedMin = selected.length ? Math.min(...selected.map(row => row.score)) : 0.12
  const floor = Math.min(0.16, Math.max(0.05, selectedMin * 0.4))
  return item.score >= floor
}

function trimToFit(
  items: HvsMomentCandidate[],
  target: number,
  tolerance: { min: number; max: number; exact: boolean },
): HvsMomentCandidate[] {
  const next = items.map(item => ({ ...item }))
  let total = totalDuration(next)
  const ceiling = tolerance.exact ? target : tolerance.max
  if (total > ceiling && next.length) {
    const last = next[next.length - 1]
    const overflow = total - (tolerance.exact ? target : Math.max(target, tolerance.min))
    const keep = Math.max(MIN_FRAGMENT_SEC, last.duration - overflow)
    last.end = Number((last.start + keep).toFixed(3))
    last.duration = Number(keep.toFixed(3))
  }
  return next
}

function takePrefix(item: HvsMomentCandidate, keepSec: number): HvsMomentCandidate | null {
  const keep = Number(Math.max(MIN_FRAGMENT_SEC, Math.min(item.duration, keepSec)).toFixed(3))
  if (keep < MIN_FRAGMENT_SEC) return null
  return {
    ...item,
    end: Number((item.start + keep).toFixed(3)),
    duration: keep,
    evidence: item.duration - keep > 0.2 ? [...item.evidence, 'fitted to duration window'] : item.evidence,
  }
}

function uncoveredRanges(duration: number, taken: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  const sorted = [...taken].sort((a, b) => a.start - b.start)
  const gaps: Array<{ start: number; end: number }> = []
  let cursor = 0
  for (const item of sorted) {
    if (item.start - cursor >= MIN_FRAGMENT_SEC) gaps.push({ start: cursor, end: item.start })
    cursor = Math.max(cursor, item.end)
  }
  if (duration - cursor >= MIN_FRAGMENT_SEC) gaps.push({ start: cursor, end: duration })
  return gaps
}

function splitCompleteShots(gap: { start: number; end: number }): Array<{ start: number; end: number }> {
  const span = gap.end - gap.start
  if (span <= MAX_SHOT_SEC + 0.05) return [gap]
  const shots: Array<{ start: number; end: number }> = []
  for (let t = gap.start; t < gap.end - 0.4; t += MAX_SHOT_SEC) {
    shots.push({ start: t, end: Math.min(gap.end, t + MAX_SHOT_SEC) })
  }
  return shots.filter(shot => shot.end - shot.start >= MIN_FRAGMENT_SEC)
}

function harvestUnusedCandidates(
  sources: AssetRecord[],
  existing: HvsMomentCandidate[],
  rowsByAsset: Map<string, VideoObservation[]>,
): HvsMomentCandidate[] {
  const extra: HvsMomentCandidate[] = []
  for (const asset of sources) {
    const duration = Math.max(0.2, toSeconds(asset.duration) || 0.2)
    const taken = existing.filter(item => item.assetId === asset.id)
    const rows = rowsByAsset.get(asset.id) ?? []
    for (const gap of uncoveredRanges(duration, taken)) {
      for (const shot of splitCompleteShots(gap)) {
        const candidate = scoreRange(asset, shot.start, shot.end, rows, [...existing, ...extra])
        if (existing.some(item => item.shotId === candidate.shotId)) continue
        extra.push(candidate)
      }
    }
  }
  return extra
}

function firstPassStrongest(
  ranked: HvsMomentCandidate[],
  sources: AssetRecord[],
): HvsMomentCandidate[] {
  if (!ranked.length) return []
  const chronological = sortChronological(ranked, sources)
  const thirds = chronological.length >= 3
    ? {
        open: chronological.slice(0, Math.max(1, Math.floor(chronological.length / 3))),
        close: chronological.slice(-Math.max(1, Math.floor(chronological.length / 3))),
      }
    : { open: chronological.slice(0, 1), close: chronological.slice(-1) }
  const used: HvsMomentCandidate[] = []
  const takeBest = (pool: HvsMomentCandidate[]) => {
    const next = [...pool]
      .sort((a, b) => b.score - a.score)
      .find(item => !used.some(row => row.shotId === item.shotId) && qualityOk(item, used.length ? used : ranked.slice(0, 1)))
    if (next) used.push(next)
  }
  takeBest(thirds.open)
  takeBest(thirds.close)
  const rest = chronological
    .filter(item => !used.some(row => row.shotId === item.shotId))
    .sort((a, b) => b.score - a.score)
  const bodyBudget = Math.max(1, Math.min(3, rest.filter(item => qualityOk(item, used)).length))
  let bodyTaken = 0
  for (const item of rest) {
    if (bodyTaken >= bodyBudget && used.length >= 2) break
    if (used.some(row => row.shotId === item.shotId)) continue
    if (!qualityOk(item, used)) continue
    if (overlapsUsed(item, used)) continue
    used.push(item)
    bodyTaken += 1
    if (used.length >= 4) break
  }
  if (!used.length) used.push(ranked[0])
  return assignRoles(sortChronological(used, sources))
}

function secondPassFill(
  pass1: HvsMomentCandidate[],
  ranked: HvsMomentCandidate[],
  sources: AssetRecord[],
  target: number,
  tolerance: { min: number; max: number; exact: boolean },
): { selected: HvsMomentCandidate[]; fillPass: 1 | 2; underfilled: boolean; underfillReason: string | null } {
  let used = pass1.map(item => ({ ...item }))
  let total = totalDuration(used)
  if (total >= tolerance.min) {
    used = trimToFit(sortChronological(used, sources), target, tolerance)
    used = assignRoles(used)
    total = totalDuration(used)
    return {
      selected: used,
      fillPass: 1,
      underfilled: total < tolerance.min,
      underfillReason: total < tolerance.min
        ? 'Not enough usable footage to reach the requested length without using weak or repeated sections.'
        : null,
    }
  }

  const remaining = ranked
    .filter(item => !used.some(row => row.shotId === item.shotId))
    .filter(item => qualityOk(item, used))
    .filter(item => !overlapsUsed(item, used))
    .sort((a, b) => b.score - a.score)

  for (const item of remaining) {
    total = totalDuration(used)
    if (total >= tolerance.min) break
    const room = (tolerance.exact ? target : tolerance.max) - total
    if (room < MIN_FRAGMENT_SEC) break
    const completeFits = item.duration <= room + 0.05
    const take = completeFits ? item : takePrefix(item, room)
    if (!take) continue
    if (overlapsUsed(take, used)) continue
    used.push(take)
  }

  used = assignRoles(sortChronological(used, sources))
  used = trimToFit(used, target, tolerance)
  used = assignRoles(used)
  total = totalDuration(used)
  const underfilled = total < tolerance.min
  return {
    selected: used,
    fillPass: 2,
    underfilled,
    underfillReason: underfilled
      ? 'Not enough usable footage to reach the requested length without using weak or repeated sections.'
      : null,
  }
}

function explanationFor(selected: HvsMomentCandidate[], candidates: HvsMomentCandidate[]): HvsSelectorResult['explanation'] {
  const using: string[] = []
  const open = selected.find(item => item.role === 'open')
  const close = selected.find(item => item.role === 'close')
  const body = selected.filter(item => item.role === 'body')
  if (open) using.push('your strongest opening')
  if (body.length) using.push(body.length === 1 ? 'the most active middle section' : `${body.length} active middle sections`)
  if (close && close.shotId !== open?.shotId) using.push('a cleaner closing shot')
  const leavingOut: string[] = []
  if (candidates.some(item => (item.silencePenalty ?? 0) >= 0.45 && !selected.some(s => s.shotId === item.shotId))) {
    leavingOut.push('long quiet sections')
  }
  if (candidates.some(item => (item.duplicatePenalty ?? 0) > 0 || item.evidence.includes('overlaps another selected range'))) {
    leavingOut.push('repeated footage')
  }
  if (candidates.some(item => (item.motionScore ?? 0) < 0.08 && !selected.some(s => s.shotId === item.shotId))) {
    leavingOut.push('long still stretches')
  }
  if (!using.length && selected.length) using.push('the usable parts of your clips')
  return { foundCount: candidates.length, using, leavingOut }
}

export function runHvsSelector(
  project: HvsProject,
  intent: HvsProductionIntent,
  docs?: Map<string, ObservationDocument | null>,
): HvsSelectorResult {
  const sources = videoSources(project, intent)
  const target = Math.max(3, intent.durationSec ?? 15)
  const exact = wantsExactDuration(intent.prompt)
  const tolerance = durationTolerance(target, exact)
  const candidates: HvsMomentCandidate[] = []
  const used: HvsMomentCandidate[] = []
  const rowsByAsset = new Map<string, VideoObservation[]>()

  for (const asset of sources) {
    const duration = Math.max(0.2, toSeconds(asset.duration) || 0.2)
    const doc = docs ? (docs.get(asset.id) ?? null) : loadObservationsSync(project.id, asset.id)
    const rows = doc?.observations ?? []
    rowsByAsset.set(asset.id, rows)
    const cuts = rows
      .filter(row => row.scene === 'SCENE_BOUNDARY' || row.transition === 'cut')
      .map(row => toSeconds(row.timestamp))
    let ranges: Array<{ start: number; end: number }>
    const singleTake = sources.length === 1 && duration <= target + 0.35
    if (singleTake) {
      const head = duration > 2.2 ? 0.3 : 0
      const tail = duration > 2.2 ? Math.max(head + 0.6, duration - 0.3) : duration
      ranges = [{ start: head, end: tail }]
    } else {
      ranges = cuts.length > 1 ? splitAtBoundaries(duration, cuts) : motionWindows(duration, rows)
    }
    for (const range of ranges) {
      const start = Math.max(0, range.start)
      const end = Math.min(duration, range.end)
      if (end - start < MIN_FRAGMENT_SEC && duration > MIN_FRAGMENT_SEC + 0.2) continue
      const candidate = scoreRange(asset, start, end, rows, used)
      candidates.push(candidate)
    }
    if (!candidates.some(item => item.assetId === asset.id)) {
      const head = duration > 2 ? 0.35 : 0
      const tail = duration > 2 ? Math.max(head + 0.5, duration - 0.35) : duration
      candidates.push(scoreRange(asset, head, tail, rows, used))
    }
  }

  candidates.push(...harvestUnusedCandidates(sources, candidates, rowsByAsset))
  const ranked = [...candidates].sort((a, b) => b.score - a.score)
  const pass1 = firstPassStrongest(ranked, sources)
  const packed = secondPassFill(pass1, ranked, sources, target, tolerance)
  const actualSec = Number(totalDuration(packed.selected).toFixed(3))
  const withinWindow = actualSec >= tolerance.min && actualSec <= tolerance.max
  return {
    engine: HVS_SELECTOR_ENGINE,
    candidates,
    selected: packed.selected,
    targetSec: target,
    actualSec,
    tolerance,
    fillPass: packed.fillPass,
    durationReport: {
      requestedSec: target,
      createdSec: actualSec,
      exact,
      withinWindow,
      underfilled: packed.underfilled,
      underfillReason: packed.underfillReason,
    },
    explanation: explanationFor(packed.selected, candidates),
  }
}

export function selectMoments(project: HvsProject, intent: HvsProductionIntent) {
  return runHvsSelector(project, intent).selected
}

export function findAssetName(project: HvsProject, assetId: string): string {
  return findAsset(project, assetId)?.name ?? 'clip'
}
