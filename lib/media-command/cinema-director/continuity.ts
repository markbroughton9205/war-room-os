import type { HvsContinuityReport, HvsContinuityWarning, HvsScreenDirection, HvsShot } from './types'

function yawOf(shot: HvsShot): number {
  return shot.cameraAngleDegrees?.yaw ?? 0
}

function angleDeltaDeg(a: number, b: number): number {
  const d = Math.abs(((a - b) * 180) / Math.PI) % 360
  return d > 180 ? 360 - d : d
}

export function inferScreenDirection(shot: HvsShot, subjectId: string): HvsScreenDirection {
  if (shot.shotRole === 'OVER_THE_SHOULDER') {
    return shot.relativePlacement === 'LEFT_OF' || /ots a|person_1/i.test(subjectId)
      ? 'LEFT_TO_RIGHT'
      : 'RIGHT_TO_LEFT'
  }
  if (shot.relativePlacement === 'IN_FRONT_OF') return 'TOWARD_CAMERA'
  if (shot.relativePlacement === 'BEHIND' || shot.relativePlacement === 'FOLLOW_BEHIND') return 'AWAY_FROM_CAMERA'
  return shot.continuityOut ?? 'LEFT_TO_RIGHT'
}

export function evaluateContinuity(shots: HvsShot[], options?: { intentionalAxisBreak?: boolean }): HvsContinuityReport {
  const warnings: HvsContinuityWarning[] = []
  const screenDirections = shots.flatMap(shot =>
    shot.subjectRefs.map(subjectId => ({
      shotId: shot.id,
      subjectId,
      direction: inferScreenDirection(shot, subjectId),
    })),
  )
  const axisYaw = shots[0] ? yawOf(shots[0]) : 0
  let cameraSide: 'LEFT' | 'RIGHT' | 'ON_AXIS' = 'LEFT'
  for (let i = 1; i < shots.length; i++) {
    const prev = shots[i - 1]
    const next = shots[i]
    const delta = angleDeltaDeg(yawOf(prev), yawOf(next))
    const crossed = (yawOf(prev) >= 0) !== (yawOf(next) >= 0) && delta > 90 && prev.shotRole === 'OVER_THE_SHOULDER' && next.shotRole === 'OVER_THE_SHOULDER'
    if (crossed) {
      warnings.push({
        kind: 'CONTINUITY_WARNING',
        rule: 'AXIS_180',
        shotId: next.id,
        relatedShotId: prev.id,
        message: 'This cut crosses the line of action.',
        intentionalAxisBreak: Boolean(options?.intentionalAxisBreak),
      })
      cameraSide = cameraSide === 'LEFT' ? 'RIGHT' : 'LEFT'
    }
    if (delta > 0 && delta < 30 && prev.cameraMovement === 'STATIC' && next.cameraMovement === 'STATIC') {
      warnings.push({
        kind: 'CONTINUITY_WARNING',
        rule: 'JUMP_CUT_30',
        shotId: next.id,
        relatedShotId: prev.id,
        message: 'These camera angles are less than 30 degrees apart and may read as a jump cut.',
        intentionalAxisBreak: false,
      })
    }
  }
  return {
    lineOfAction: shots.length ? { axisYaw, cameraSide } : null,
    screenDirections,
    warnings,
  }
}

export function twoPersonOtsPair(): { a: Partial<HvsShot>; b: Partial<HvsShot> } {
  return {
    a: {
      name: 'OTS A',
      shotRole: 'OVER_THE_SHOULDER',
      relativePlacement: 'OVER_SHOULDER',
      continuityOut: 'LEFT_TO_RIGHT',
      cameraAngleDegrees: { pitch: 0.05, yaw: 0.38, roll: 0 },
    },
    b: {
      name: 'OTS B',
      shotRole: 'OVER_THE_SHOULDER',
      relativePlacement: 'OVER_SHOULDER',
      continuityOut: 'RIGHT_TO_LEFT',
      cameraAngleDegrees: { pitch: 0.05, yaw: 1.05, roll: 0 },
    },
  }
}
