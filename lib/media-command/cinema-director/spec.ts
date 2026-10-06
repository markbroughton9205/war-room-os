import type { CameraSpec, VirtualCamera } from '../types'
import type {
  CameraHonesty,
  HvsCinemaAngle,
  HvsCinemaFraming,
  HvsCinemaMovement,
  HvsCinemaShotSize,
  HvsDofIntent,
} from './types'

export function cinemaSizeToSpec(size: HvsCinemaShotSize): CameraSpec['shotSize'] {
  if (size === 'EXTREME_CLOSE_UP') return 'ECU'
  if (size === 'CLOSE_UP') return 'CU'
  if (size === 'MEDIUM_CLOSE') return 'MCU'
  if (size === 'MEDIUM') return 'MS'
  if (size === 'MEDIUM_WIDE' || size === 'FULL') return 'MLS'
  if (size === 'WIDE') return 'WS'
  if (size === 'EXTREME_WIDE') return 'EWS'
  return 'custom'
}

export function cinemaAngleToSpec(angle: HvsCinemaAngle): CameraSpec['angle'] {
  if (angle === 'LOW_ANGLE' || angle === 'WORMS_EYE') return 'low'
  if (angle === 'HIGH_ANGLE' || angle === 'BIRDS_EYE') return 'high'
  if (angle === 'OVERHEAD') return 'overhead'
  if (angle === 'DUTCH' || angle === 'OBLIQUE') return 'dutch'
  return 'eye'
}

export function cinemaMovementToSpec(movement: HvsCinemaMovement): CameraSpec['movement'] {
  if (movement === 'PAN' || movement === 'WHIP_PAN') return 'pan'
  if (movement === 'TILT') return 'tilt'
  if (
    movement === 'DOLLY_IN'
    || movement === 'DOLLY_OUT'
    || movement === 'DOLLY_ZOOM'
    || movement === 'CRANE'
    || movement === 'JIB'
    || movement === 'PEDESTAL_UP'
    || movement === 'PEDESTAL_DOWN'
    || movement === 'TRUCK_LEFT'
    || movement === 'TRUCK_RIGHT'
    || movement === 'REVEAL'
    || movement === 'ZOOM_IN'
    || movement === 'ZOOM_OUT'
  ) return 'dolly'
  if (movement === 'ORBIT' || movement === 'ARC' || movement === 'DRONE_STYLE') return 'orbit'
  if (movement === 'HANDHELD') return 'handheld'
  if (movement === 'FOLLOW' || movement === 'LEAD' || movement === 'CHASE' || movement === 'TRACK' || movement === 'STEADICAM_STYLE') return 'follow'
  return 'static'
}

export function cinemaFramingToVirtual(framing: HvsCinemaFraming): VirtualCamera['mode'] {
  if (framing === 'FACE_LOCK') return 'FACE_LOCK'
  if (framing === 'UPPER_BODY') return 'UPPER_BODY'
  if (framing === 'FULL_BODY') return 'FULL_BODY'
  if (framing === 'DYNAMIC_FOLLOW') return 'DYNAMIC_FOLLOW'
  if (framing === 'CINEMATIC_FOLLOW' || framing === 'LEAD_ROOM' || framing === 'NEGATIVE_SPACE') return 'CINEMATIC_FOLLOW'
  if (framing === 'LEFT_THIRD' || framing === 'RIGHT_THIRD' || framing === 'RULE_OF_THIRDS') return 'RULE_OF_THIRDS'
  return 'CENTER_LOCK'
}

export function dofToSpec(intent: HvsDofIntent): CameraSpec['depthOfField'] {
  if (intent === 'DEEP') return 'deep'
  if (intent === 'EXTREME_SHALLOW' || intent === 'SHALLOW') return 'shallow'
  return 'medium'
}

export function apertureForDof(intent: HvsDofIntent): number {
  if (intent === 'DEEP') return 8
  if (intent === 'MODERATE') return 4
  if (intent === 'SHALLOW') return 2
  return 1.4
}

export function angleDegrees(angle: HvsCinemaAngle): { pitch: number; yaw: number; roll: number } {
  if (angle === 'LOW_ANGLE') return { pitch: 0.38, yaw: 0, roll: 0 }
  if (angle === 'WORMS_EYE') return { pitch: 0.72, yaw: 0, roll: 0 }
  if (angle === 'HIGH_ANGLE') return { pitch: -0.42, yaw: 0, roll: 0 }
  if (angle === 'BIRDS_EYE' || angle === 'OVERHEAD') return { pitch: -1.2, yaw: 0, roll: 0 }
  if (angle === 'DUTCH') return { pitch: 0.08, yaw: 0, roll: 0.28 }
  if (angle === 'OBLIQUE') return { pitch: 0.12, yaw: 0.2, roll: 0.12 }
  return { pitch: 0, yaw: 0, roll: 0 }
}

export function makeCameraSpec(input: {
  id: string
  name: string
  shotSize: HvsCinemaShotSize
  angle: HvsCinemaAngle
  movement: HvsCinemaMovement
  framing: HvsCinemaFraming
  lensMm: number
  dof: HvsDofIntent
  targetId: string | null
  pathId: string | null
  position?: { x: number; y: number; z: number }
  target?: { x: number; y: number; z: number }
  relativePlacement?: string
  honesty?: CameraHonesty
}): CameraSpec {
  return {
    id: input.id,
    name: input.name,
    shotSize: cinemaSizeToSpec(input.shotSize),
    angle: cinemaAngleToSpec(input.angle),
    movement: cinemaMovementToSpec(input.movement),
    framing: input.framing,
    subjectTargetId: input.targetId,
    lensIntent: `${input.lensMm}mm`,
    depthOfField: dofToSpec(input.dof),
    trackingBehavior: input.targetId ? 'FOLLOW SUBJECT' : null,
    trajectory: input.pathId,
    cameraId: input.id,
    position: input.position,
    target: input.target,
    focalLengthMm: input.lensMm,
    aperture: apertureForDof(input.dof),
    aspect: '16:9',
    movementType: input.movement,
    movementPathId: input.pathId ?? undefined,
    framingMode: input.framing,
    lookAtTargetId: input.targetId ?? undefined,
    cinemaShotSize: input.shotSize,
    cinemaAngle: input.angle,
    cinemaMovement: input.movement,
    relativePlacement: input.relativePlacement,
    honesty: input.honesty ?? 'GEOMETRIC',
  }
}
