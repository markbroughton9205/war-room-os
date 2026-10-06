import { toSeconds } from '../time'
import type { CameraSpec } from '../types'
import { vec3 } from '../director3d/types'
import {
  cinemaId,
  cinemaSeconds,
  type CameraTargetRef,
  type HvsCameraPath,
  type HvsCinemaIntent,
  type HvsCinemaPlan,
  type HvsCinemaShotSize,
  type HvsFocusTransition,
  type HvsShot,
  type HvsShotIntent,
} from './types'
import { defaultLensForSize, defaultSizeForLens, parseDofIntent, parseFocusTargets } from './parse'
import { applyPresetToIntent } from './presets'
import {
  applyHandheldLayer,
  buildCranePath,
  buildDollyPath,
  buildDollyZoomPath,
  buildLinearPath,
  buildOrbitPath,
  buildZoomPath,
  handheldParams,
  relativePoint,
} from './path'
import { angleDegrees, makeCameraSpec } from './spec'
import { evaluateContinuity, twoPersonOtsPair } from './continuity'

const CAR_POS = vec3(0, 0.45, 0)
const CAR_FORWARD = vec3(0, 0, -1)
const PERSON_POS = vec3(-1.35, 0, 0.15)
const PERSON_B_POS = vec3(1.35, 0, 0.15)
const BUILDING_POS = vec3(-6, 0, -10)

function allocateDurations(count: number, totalSec: number, intents: HvsShotIntent[]): number[] {
  const weights = intents.map(item => {
    if (item.movement === 'ORBIT' || item.movement === 'CRANE' || item.movement === 'DRONE_STYLE') return 1.6
    if (item.movement === 'DOLLY_IN' || item.shotSize === 'CLOSE_UP') return 1.1
    if (item.shotRole === 'ESTABLISHING') return 1.25
    return 1
  })
  const sum = weights.reduce((a, b) => a + b, 0) || count
  const raw = weights.map(w => (w / sum) * totalSec)
  const rounded = raw.map(n => Math.max(1.2, Math.round(n * 10) / 10))
  const drift = totalSec - rounded.reduce((a, b) => a + b, 0)
  if (rounded.length) rounded[rounded.length - 1] = Math.max(1.2, rounded[rounded.length - 1] + drift)
  return rounded
}

function commanderName(intent: HvsShotIntent, index: number): string {
  if (intent.shotRole === 'ESTABLISHING') return 'Establishing wide'
  if (intent.angle === 'LOW_ANGLE' && intent.relative === 'BEHIND') return 'Low car reveal'
  if (intent.movement === 'ORBIT') return intent.framing === 'LEFT_THIRD' ? 'Driver-side orbit' : 'Orbit'
  if (intent.shotSize === 'CLOSE_UP' || (intent.lensMm ?? 0) >= 85) return 'Close-up'
  if (intent.shotRole === 'OVER_THE_SHOULDER') return index === 0 ? 'OTS A' : 'OTS B'
  if (intent.movement === 'CRANE') return 'Crane'
  if (intent.movement === 'HANDHELD') return 'Handheld'
  return intent.text.slice(0, 42) || `Shot ${index + 1}`
}

function resolveSize(intent: HvsShotIntent): HvsCinemaShotSize {
  if (intent.shotSize) return intent.shotSize
  if (intent.lensMm) return defaultSizeForLens(intent.lensMm)
  if (intent.shotRole === 'ESTABLISHING') return 'WIDE'
  if (intent.shotRole === 'OVER_THE_SHOULDER') return 'MEDIUM_CLOSE'
  return 'MEDIUM'
}

function personTarget(id = 'PERSON_1', label = 'Person'): CameraTargetRef {
  return { kind: 'PERSON', id, label }
}
function carTarget(): CameraTargetRef {
  return { kind: 'OBJECT', id: 'CAR_1', label: 'Black car' }
}

function pathForShot(shot: HvsShot, intent: HvsShotIntent, durationSec: number, look: { x: number; y: number; z: number }): HvsCameraPath {
  const lens = shot.cameraSpec.focalLengthMm ?? 35
  const height = shot.cameraAngle === 'LOW_ANGLE' || shot.cameraAngle === 'WORMS_EYE'
    ? 0.38
    : shot.cameraAngle === 'OVERHEAD' || shot.cameraAngle === 'BIRDS_EYE'
      ? 9.5
      : shot.cameraAngle === 'HIGH_ANGLE'
        ? 3.6
        : 1.45
  const subject = shot.relativePlacement === 'BEHIND' || shot.targetRef?.kind === 'OBJECT' ? CAR_POS : PERSON_POS
  const start = relativePoint(
    subject,
    CAR_FORWARD,
    shot.relativePlacement ?? 'BEHIND',
    shot.shotSize === 'WIDE' || shot.shotSize === 'EXTREME_WIDE' ? 14 : shot.cameraMovement === 'ORBIT' ? 4.4 : 5.2,
    height,
  )
  if (shot.cameraMovement === 'ORBIT') {
    const clockwise = !/counter|anti-?clockwise/.test(intent.text.toLowerCase())
    const startAngle = 0.15
    const sweep = Math.PI
    const endAngle = clockwise ? startAngle + sweep : startAngle - sweep
    const orbitLook = { x: PERSON_POS.x, y: 1.35, z: PERSON_POS.z }
    const framingOffset = shot.framing === 'LEFT_THIRD' ? 0.55 : shot.framing === 'RIGHT_THIRD' ? -0.55 : 0
    return buildOrbitPath({
      shotId: shot.id,
      center: { ...orbitLook, x: orbitLook.x + framingOffset },
      radius: 4.6,
      height: Math.max(0.85, height),
      startAngle,
      endAngle,
      durationSec,
      focalLength: lens,
    })
  }
  if (shot.cameraMovement === 'DOLLY_IN' || shot.cameraMovement === 'REVEAL') {
    const from = start
    const to = vec3(
      look.x + (from.x - look.x) * 0.42,
      Math.max(1.15, look.y),
      look.z + (from.z - look.z) * 0.42,
    )
    return buildDollyPath({ shotId: shot.id, from, to, durationSec, focalLength: lens, target: look })
  }
  if (shot.cameraMovement === 'DOLLY_OUT') {
    const to = vec3(start.x * 1.35, start.y, start.z * 1.35)
    return buildDollyPath({ shotId: shot.id, from: start, to, durationSec, focalLength: lens, target: look })
  }
  if (shot.cameraMovement === 'ZOOM_IN') {
    return buildZoomPath({ shotId: shot.id, position: start, durationSec, fromMm: lens, toMm: Math.min(200, lens + 40), target: look })
  }
  if (shot.cameraMovement === 'ZOOM_OUT') {
    return buildZoomPath({ shotId: shot.id, position: start, durationSec, fromMm: lens, toMm: Math.max(14, lens - 20), target: look })
  }
  if (shot.cameraMovement === 'DOLLY_ZOOM') {
    const to = vec3(look.x + (start.x - look.x) * 0.45, start.y, look.z + (start.z - look.z) * 0.45)
    return buildDollyZoomPath({ shotId: shot.id, from: start, to, durationSec, fromMm: lens, toMm: Math.max(14, lens - 30), target: look })
  }
  if (shot.cameraMovement === 'CRANE' || shot.cameraMovement === 'JIB' || shot.cameraMovement === 'DRONE_STYLE') {
    const overhead = vec3(look.x, 11, look.z + 2.5)
    const down = vec3(start.x, Math.max(1.2, height), start.z)
    return buildCranePath({ shotId: shot.id, start: overhead, end: down, durationSec, focalLength: lens, target: look })
  }
  let path = buildLinearPath(shot.id, start, start, durationSec, { startFocal: lens, endFocal: lens, target: look })
  if (shot.cameraMovement === 'HANDHELD' || shot.handheld) {
    path = applyHandheldLayer(path, shot.handheld ?? handheldParams('DOCUMENTARY'))
  }
  return path
}

export function buildCinemaPlan(intent: HvsCinemaIntent): HvsCinemaPlan {
  const sceneId = intent.sceneId ?? `cscene-${intent.projectId ?? 'local'}`
  const totalSec = Math.max(4, toSeconds(intent.duration ?? cinemaSeconds(8)))
  let intents = intent.shotIntent.length ? [...intent.shotIntent] : [{
    order: 1,
    text: intent.prompt,
    shotSize: null,
    shotRole: null,
    angle: null,
    movement: null,
    lensMm: null,
    lensFamily: null,
    framing: null,
    relative: null,
    speed: null,
    preset: null,
  }]
  if (intent.skill === 'DIALOGUE' && intents.length < 2) {
    intents = [
      { ...intents[0], shotRole: 'OVER_THE_SHOULDER', framing: 'LEAD_ROOM', movement: 'STATIC' },
      { ...intents[0], order: 2, text: 'OTS B', shotRole: 'OVER_THE_SHOULDER', framing: 'LEAD_ROOM', movement: 'STATIC' },
    ]
  }
  intents = intents.map(item => item.preset ? applyPresetToIntent(item, item.preset) : item)
  const durations = allocateDurations(intents.length, totalSec, intents)
  const person = personTarget(intent.subjectRefs[0]?.id ?? 'PERSON_1', intent.subjectRefs[0]?.label ?? 'Person')
  const car = intent.propRefs.some(item => item.kind === 'car') ? carTarget() : null
  const shots: HvsShot[] = []
  const paths: HvsCameraPath[] = []
  const specs: CameraSpec[] = []
  const focusTransitions: HvsFocusTransition[] = []
  const ots = twoPersonOtsPair()
  let cursor = 0
  for (let i = 0; i < intents.length; i++) {
    const clause = intents[i]
    const durationSec = durations[i] ?? 2
    const shotId = `cshot-${i + 1}`
    const size = resolveSize(clause)
    const lens = clause.lensMm ?? defaultLensForSize(size)
    const angle = clause.angle ?? (size === 'WIDE' && clause.shotRole === 'ESTABLISHING' ? 'HIGH_ANGLE' : 'EYE_LEVEL')
    const movement = clause.movement ?? 'STATIC'
    const framing = clause.framing ?? (movement === 'DOLLY_IN' ? 'FACE_LOCK' : 'CENTER')
    const relative = clause.relative ?? (angle === 'LOW_ANGLE' ? 'BEHIND' : null)
    const dof = parseDofIntent(intent.prompt) ?? (size === 'CLOSE_UP' || size === 'EXTREME_CLOSE_UP' ? 'SHALLOW' : 'MODERATE')
    const target = size === 'CLOSE_UP' || framing === 'LEFT_THIRD' || framing === 'FACE_LOCK' ? person : car ?? person
    const look = target.kind === 'OBJECT' ? { x: CAR_POS.x, y: 0.7, z: CAR_POS.z } : { x: PERSON_POS.x, y: 1.45, z: PERSON_POS.z }
    const start = cinemaSeconds(cursor)
    const end = cinemaSeconds(cursor + durationSec)
    const pathId = `cpath-${shotId}`
    const spec = makeCameraSpec({
      id: `cspec-${shotId}`,
      name: commanderName(clause, i),
      shotSize: size,
      angle,
      movement,
      framing,
      lensMm: lens,
      dof,
      targetId: target.id,
      pathId,
      relativePlacement: relative ?? undefined,
      honesty: 'GEOMETRIC',
    })
    const extras = clause.shotRole === 'OVER_THE_SHOULDER' ? (i === 0 ? ots.a : ots.b) : {}
    const shot: HvsShot = {
      id: shotId,
      sceneId,
      name: extras.name ?? commanderName(clause, i),
      description: clause.text,
      start,
      end,
      duration: cinemaSeconds(durationSec),
      shotSize: size,
      shotRole: extras.shotRole ?? clause.shotRole,
      cameraAngle: angle,
      cameraAngleDegrees: extras.cameraAngleDegrees ?? angleDegrees(angle),
      cameraMovement: movement,
      cameraSpec: spec,
      subjectRefs: intent.subjectRefs.map(item => item.id),
      targetRef: target,
      framing,
      focus: {
        target,
        distance: target.kind === 'OBJECT' ? 5.2 : 3.4,
        dofIntent: dof,
        aperture: spec.aperture ?? null,
      },
      continuityIn: extras.continuityOut ?? null,
      continuityOut: extras.continuityOut ?? null,
      relativePlacement: extras.relativePlacement ?? relative,
      orbit: movement === 'ORBIT'
        ? {
            targetId: target.id,
            radius: 4.6,
            height: angle === 'LOW_ANGLE' ? 0.9 : 1.35,
            startAngle: 0.15,
            endAngle: 0.15 + Math.PI,
            direction: /counter|anti-?clockwise/.test(clause.text.toLowerCase()) ? 'COUNTERCLOCKWISE' : 'CLOCKWISE',
            duration: cinemaSeconds(durationSec),
            framing,
          }
        : null,
      handheld: movement === 'HANDHELD' ? handheldParams(/urgent/.test(clause.text.toLowerCase()) ? 'URGENT' : /subtle/.test(clause.text.toLowerCase()) ? 'SUBTLE' : 'DOCUMENTARY') : null,
      speed: clause.speed ?? (movement === 'DOLLY_IN' ? 'SLOW' : 'NORMAL'),
      pathId,
      preset: clause.preset,
      status: 'proposed',
    }
    const path = pathForShot(shot, clause, durationSec, look)
    path.id = pathId
    path.shotId = shotId
    spec.position = path.points[0]?.position
    spec.target = look
    spec.movementPathId = pathId
    shots.push(shot)
    paths.push(path)
    specs.push(spec)
    cursor += durationSec
  }

  if (/cross the axis|break the (?:line|axis)/.test(intent.prompt.toLowerCase())) {
    const b = shots.find(item => item.name === 'OTS B')
    if (b) b.cameraAngleDegrees = { pitch: 0.05, yaw: -2.2, roll: 0 }
  }

  const focusPair = parseFocusTargets(
    intent.prompt,
    [person, ...(intent.subjectRefs[1] ? [personTarget(intent.subjectRefs[1].id, intent.subjectRefs[1].label)] : [])],
    car ? [car] : [],
  )
  if (focusPair.from && focusPair.to && shots[0]) {
    const host = shots.find(item => item.cameraMovement !== 'ORBIT') ?? shots[0]
    focusTransitions.push({
      id: cinemaId('focus'),
      shotId: host.id,
      fromTarget: focusPair.from,
      toTarget: focusPair.to,
      startTime: host.start,
      endTime: host.end,
      curve: 'EASE_IN_OUT',
    })
    host.focus.target = focusPair.to
  }

  const destructionCues = /collapse|destruction|explode/.test(intent.prompt.toLowerCase())
    ? [{ eventKind: 'MAJOR_COLLAPSE', shotId: shots[0]?.id ?? 'cshot-1', cameraResponse: 'SHAKE' as const, start: cinemaSeconds(0) }]
    : []

  const duration = cinemaSeconds(cursor)
  return {
    id: cinemaId('cplan'),
    intentId: intent.id,
    projectId: intent.projectId ?? 'local',
    sceneId,
    title: shots[0]?.name ?? 'Cinema plan',
    duration,
    shots,
    paths,
    specs,
    focusTransitions,
    shakeLayers: destructionCues.map(cue => ({
      id: cinemaId('shake'),
      shotId: cue.shotId,
      event: cue.eventKind,
      intensity: 0.12,
      duration: cinemaSeconds(1.4),
      frequency: 11,
    })),
    continuity: evaluateContinuity(shots, { intentionalAxisBreak: /break the (?:line|axis)|cross the axis/.test(intent.prompt.toLowerCase()) }),
    storyboardLinks: shots.map(shot => ({ shotId: shot.id, frameId: null, beatId: null })),
    destructionCues,
    skill: intent.skill ?? null,
    commanderShotList: shots.map((shot, index) => ({
      index: index + 1,
      name: shot.name,
      durationLabel: `${Math.round(toSeconds(shot.duration))} sec`,
      shotId: shot.id,
    })),
    status: 'proposed',
    approvalRequired: true,
    approvalAction: 'PREVIEW',
    mutated: false,
    createdAt: new Date().toISOString(),
  }
}

export const CINEMA_LAYOUT = { CAR_POS, PERSON_POS, PERSON_B_POS, BUILDING_POS, CAR_FORWARD }
