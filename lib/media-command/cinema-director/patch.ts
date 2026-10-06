import { toSeconds, fromSeconds } from '../time'
import type { HvsCameraPlanPatch, HvsCameraPlanPatchKind, HvsCinemaPlan, HvsShot } from './types'
import { cinemaId } from './types'
import { offsetPathHeight, scalePathDuration } from './path'
import { evaluateContinuity } from './continuity'

export function parseCameraPlanPatch(plan: HvsCinemaPlan, prompt: string): HvsCameraPlanPatch {
  const lower = prompt.toLowerCase()
  const kinds: HvsCameraPlanPatchKind[] = []
  const summaryLines: string[] = []
  const orbitShot = plan.shots.find(item => item.cameraMovement === 'ORBIT') ?? null
  if (/\bslow|slower\b/.test(lower) && /\borbit\b/.test(lower)) {
    kinds.push('CHANGE_SPEED', 'CHANGE_ORBIT', 'CHANGE_SHOT_DURATION')
    summaryLines.push('Make the orbit slower.')
  }
  if (/\blower the camera|camera is too high|lower\b/.test(lower)) {
    kinds.push('CHANGE_HEIGHT', 'CHANGE_POSITION')
    summaryLines.push('Lower the camera.')
  }
  if (/\blonger lens|tighter|85\b/.test(lower)) {
    kinds.push('CHANGE_LENS')
    summaryLines.push('Use a longer lens.')
  }
  if (/\bwider|more of the building|24\b/.test(lower) && /\blens|building|frame\b/.test(lower)) {
    kinds.push('CHANGE_LENS', 'CHANGE_FRAMING')
    summaryLines.push('Keep more of the building in frame.')
  }
  if (/\bright (?:side|third)|put her on the right\b/.test(lower)) {
    kinds.push('CHANGE_FRAMING')
    summaryLines.push('Put her on the right side.')
  }
  if (/\bleft (?:side|third)\b/.test(lower)) {
    kinds.push('CHANGE_FRAMING')
    summaryLines.push('Keep her on the left third.')
  }
  if (/\bclockwise\b/.test(lower) && /\borbit\b/.test(lower)) {
    kinds.push('CHANGE_ORBIT', 'CHANGE_PATH')
    summaryLines.push('Make the orbit clockwise.')
  }
  if (/\bpull focus|rack focus|focus\b/.test(lower)) {
    kinds.push('CHANGE_FOCUS', 'CHANGE_DOF')
    summaryLines.push('Change focus.')
  }
  if (/\bshake\b/.test(lower) && /\bremove|no \b/.test(lower)) kinds.push('REMOVE_SHAKE')
  else if (/\bshake\b/.test(lower)) kinds.push('ADD_SHAKE')
  if (/\breorder|swap shots|close-up first\b/.test(lower)) kinds.push('REORDER_SHOTS')
  if (!kinds.length) {
    kinds.push('CHANGE_PATH')
    summaryLines.push('Adjust the camera plan from that note.')
  }
  return {
    id: cinemaId('cpatch'),
    planId: plan.id,
    prompt,
    kinds,
    shotId: orbitShot?.id ?? plan.shots[0]?.id ?? null,
    summaryLines,
    status: 'proposed',
    approvalRequired: true,
    createdAt: new Date().toISOString(),
  }
}

function retimeline(shots: HvsShot[]): HvsShot[] {
  let cursor = 0
  return shots.map(shot => {
    const dur = toSeconds(shot.duration)
    const start = fromSeconds(cursor, shot.start.timescale)
    const end = fromSeconds(cursor + dur, shot.end.timescale)
    cursor += dur
    return { ...shot, start, end }
  })
}

export function applyCameraPlanPatch(plan: HvsCinemaPlan, patch: HvsCameraPlanPatch): HvsCinemaPlan {
  const next: HvsCinemaPlan = {
    ...plan,
    shots: plan.shots.map(item => ({ ...item })),
    paths: plan.paths.map(item => ({ ...item, points: item.points.map(point => ({ ...point, position: { ...point.position } })) })),
    specs: plan.specs.map(item => ({ ...item })),
  }
  const shotId = patch.shotId ?? next.shots.find(item => item.cameraMovement === 'ORBIT')?.id ?? next.shots[0]?.id
  const shot = next.shots.find(item => item.id === shotId)
  const path = next.paths.find(item => item.shotId === shotId)
  if (shot && path && (patch.kinds.includes('CHANGE_SPEED') || patch.kinds.includes('CHANGE_ORBIT') || patch.kinds.includes('CHANGE_SHOT_DURATION'))) {
    const factor = 1.5
    shot.duration = fromSeconds(toSeconds(shot.duration) * factor, shot.duration.timescale)
    shot.speed = 'SLOW'
    if (shot.orbit) shot.orbit = { ...shot.orbit, duration: shot.duration }
    const scaled = scalePathDuration(path, factor)
    path.points = scaled.points
  }
  if (shot && path && (patch.kinds.includes('CHANGE_HEIGHT') || patch.kinds.includes('CHANGE_POSITION'))) {
    const lowered = offsetPathHeight(path, -0.42)
    path.points = lowered.points
    if (shot.orbit) shot.orbit = { ...shot.orbit, height: Math.max(0.28, shot.orbit.height - 0.42) }
    if (shot.cameraSpec.position) {
      shot.cameraSpec.position = { ...shot.cameraSpec.position, y: Math.max(0.12, shot.cameraSpec.position.y - 0.42) }
    }
  }
  if (shot && patch.kinds.includes('CHANGE_LENS')) {
    const longer = /\blonger|tighter|85/.test(patch.prompt.toLowerCase())
    const mm = longer ? 85 : 24
    shot.cameraSpec = { ...shot.cameraSpec, focalLengthMm: mm, lensIntent: `${mm}mm` }
    if (path) path.points = path.points.map(item => ({ ...item, focalLength: mm }))
  }
  if (shot && patch.kinds.includes('CHANGE_FRAMING')) {
    shot.framing = /right/.test(patch.prompt.toLowerCase()) ? 'RIGHT_THIRD' : 'LEFT_THIRD'
    shot.cameraSpec = { ...shot.cameraSpec, framing: shot.framing, framingMode: shot.framing }
  }
  if (shot && shot.orbit && patch.kinds.includes('CHANGE_ORBIT') && /clockwise/.test(patch.prompt.toLowerCase()) && !/counter/.test(patch.prompt.toLowerCase())) {
    shot.orbit = { ...shot.orbit, direction: 'CLOCKWISE' }
  }
  next.shots = retimeline(next.shots)
  next.duration = next.shots.length
    ? fromSeconds(toSeconds(next.shots[next.shots.length - 1].end), next.duration.timescale)
    : next.duration
  next.commanderShotList = next.shots.map((item, index) => ({
    index: index + 1,
    name: item.name,
    durationLabel: `${Math.round(toSeconds(item.duration))} sec`,
    shotId: item.id,
  }))
  next.continuity = evaluateContinuity(next.shots)
  next.specs = next.shots.map(item => item.cameraSpec)
  return next
}
