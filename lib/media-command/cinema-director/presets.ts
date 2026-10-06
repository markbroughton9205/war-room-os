import type { HvsCinemaFraming, HvsCinemaMovement, HvsCinemaShotSize, HvsMovieCameraPreset, HvsShotIntent } from './types'

export type MoviePresetRecipe = {
  id: HvsMovieCameraPreset
  name: string
  shotSize: HvsCinemaShotSize
  movement: HvsCinemaMovement
  framing: HvsCinemaFraming
  lensMm: number
  angle: HvsShotIntent['angle']
}

export const MOVIE_CAMERA_PRESETS: Record<HvsMovieCameraPreset, MoviePresetRecipe> = {
  HERO_LOW_WIDE: { id: 'HERO_LOW_WIDE', name: 'Hero low wide', shotSize: 'WIDE', movement: 'STATIC', framing: 'CENTER', lensMm: 24, angle: 'LOW_ANGLE' },
  SLOW_PUSH_CLOSEUP: { id: 'SLOW_PUSH_CLOSEUP', name: 'Slow push close-up', shotSize: 'CLOSE_UP', movement: 'DOLLY_IN', framing: 'FACE_LOCK', lensMm: 85, angle: 'EYE_LEVEL' },
  OTS_DIALOGUE: { id: 'OTS_DIALOGUE', name: 'OTS dialogue', shotSize: 'MEDIUM_CLOSE', movement: 'STATIC', framing: 'LEAD_ROOM', lensMm: 50, angle: 'EYE_LEVEL' },
  ESTABLISHING_CRANE: { id: 'ESTABLISHING_CRANE', name: 'Establishing crane', shotSize: 'EXTREME_WIDE', movement: 'CRANE', framing: 'CENTER', lensMm: 24, angle: 'HIGH_ANGLE' },
  CAR_COMMERCIAL_ORBIT: { id: 'CAR_COMMERCIAL_ORBIT', name: 'Car commercial orbit', shotSize: 'FULL', movement: 'ORBIT', framing: 'LEFT_THIRD', lensMm: 35, angle: 'EYE_LEVEL' },
  ACTION_FOLLOW: { id: 'ACTION_FOLLOW', name: 'Action follow', shotSize: 'MEDIUM', movement: 'FOLLOW', framing: 'LEAD_ROOM', lensMm: 35, angle: 'LOW_ANGLE' },
  DOCUMENTARY_HANDHELD: { id: 'DOCUMENTARY_HANDHELD', name: 'Documentary handheld', shotSize: 'MEDIUM', movement: 'HANDHELD', framing: 'DYNAMIC_FOLLOW', lensMm: 35, angle: 'EYE_LEVEL' },
  DRONE_REVEAL: { id: 'DRONE_REVEAL', name: 'Drone reveal', shotSize: 'EXTREME_WIDE', movement: 'DRONE_STYLE', framing: 'CENTER', lensMm: 24, angle: 'BIRDS_EYE' },
  HORROR_DUTCH_PUSH: { id: 'HORROR_DUTCH_PUSH', name: 'Horror Dutch push', shotSize: 'MEDIUM_CLOSE', movement: 'DOLLY_IN', framing: 'LOW_HEADROOM', lensMm: 35, angle: 'DUTCH' },
  MACRO_INSERT: { id: 'MACRO_INSERT', name: 'Macro insert', shotSize: 'INSERT', movement: 'STATIC', framing: 'CENTER', lensMm: 100, angle: 'EYE_LEVEL' },
  PRODUCT_TURNTABLE: { id: 'PRODUCT_TURNTABLE', name: 'Product turntable', shotSize: 'INSERT', movement: 'ORBIT', framing: 'CENTER', lensMm: 65, angle: 'EYE_LEVEL' },
}

export function applyPresetToIntent(intent: HvsShotIntent, preset: HvsMovieCameraPreset): HvsShotIntent {
  const recipe = MOVIE_CAMERA_PRESETS[preset]
  return {
    ...intent,
    preset,
    shotSize: intent.shotSize ?? recipe.shotSize,
    movement: intent.movement ?? recipe.movement,
    framing: intent.framing ?? recipe.framing,
    lensMm: intent.lensMm ?? recipe.lensMm,
    angle: intent.angle ?? recipe.angle,
  }
}
