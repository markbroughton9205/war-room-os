/**
 * HVS Cinema Director — provider-neutral movie-camera language.
 * CameraSpec remains the canonical shot camera description.
 * Three.js / Blender / generators are execution adapters only.
 */
import { DEFAULT_TIMESCALE, fromSeconds, type MediaTime } from '../time'
import type { CameraSpec } from '../types'
import type { Vec3 } from '../director3d/types'
import { nid } from '../director3d/types'

export const HVS_CINEMA_DIRECTOR_SLICE = 'HVS-CINEMA-DIRECTOR-FOUNDATION'
export const HVS_CINEMA_SCHEMA = 1 as const

export const HVS_CINEMA_SHOT_SIZES = [
  'EXTREME_WIDE',
  'WIDE',
  'FULL',
  'MEDIUM_WIDE',
  'MEDIUM',
  'MEDIUM_CLOSE',
  'CLOSE_UP',
  'EXTREME_CLOSE_UP',
  'INSERT',
] as const
export type HvsCinemaShotSize = (typeof HVS_CINEMA_SHOT_SIZES)[number]

export const HVS_CINEMA_SHOT_ROLES = [
  'ESTABLISHING',
  'MASTER',
  'TWO_SHOT',
  'OVER_THE_SHOULDER',
  'POV',
  'REACTION',
  'CUTAWAY',
  'DETAIL',
  'HERO',
  'PRODUCT',
] as const
export type HvsCinemaShotRole = (typeof HVS_CINEMA_SHOT_ROLES)[number]

export const HVS_CINEMA_ANGLES = [
  'EYE_LEVEL',
  'LOW_ANGLE',
  'HIGH_ANGLE',
  'BIRDS_EYE',
  'WORMS_EYE',
  'DUTCH',
  'OVERHEAD',
  'OBLIQUE',
] as const
export type HvsCinemaAngle = (typeof HVS_CINEMA_ANGLES)[number]

export const HVS_CINEMA_MOVEMENTS = [
  'STATIC',
  'PAN',
  'TILT',
  'DOLLY_IN',
  'DOLLY_OUT',
  'TRUCK_LEFT',
  'TRUCK_RIGHT',
  'PEDESTAL_UP',
  'PEDESTAL_DOWN',
  'CRANE',
  'JIB',
  'ARC',
  'ORBIT',
  'TRACK',
  'FOLLOW',
  'LEAD',
  'CHASE',
  'HANDHELD',
  'STEADICAM_STYLE',
  'DRONE_STYLE',
  'REVEAL',
  'WHIP_PAN',
  'ZOOM_IN',
  'ZOOM_OUT',
  'DOLLY_ZOOM',
  'CUSTOM_PATH',
] as const
export type HvsCinemaMovement = (typeof HVS_CINEMA_MOVEMENTS)[number]

export const HVS_CINEMA_FRAMING = [
  'CENTER_LOCK',
  'RULE_OF_THIRDS',
  'FACE_LOCK',
  'UPPER_BODY',
  'FULL_BODY',
  'DYNAMIC_FOLLOW',
  'CINEMATIC_FOLLOW',
  'LEFT_THIRD',
  'RIGHT_THIRD',
  'CENTER',
  'HEADROOM',
  'LEAD_ROOM',
  'NEGATIVE_SPACE',
  'SYMMETRICAL',
  'LOW_HEADROOM',
  'SILHOUETTE',
] as const
export type HvsCinemaFraming = (typeof HVS_CINEMA_FRAMING)[number]

export const HVS_LENS_MM = [14, 18, 24, 28, 35, 50, 65, 85, 100, 135, 200] as const
export type HvsLensMm = (typeof HVS_LENS_MM)[number]

export const HVS_LENS_FAMILIES = ['ULTRA_WIDE', 'WIDE', 'NORMAL', 'PORTRAIT', 'TELEPHOTO', 'MACRO'] as const
export type HvsLensFamily = (typeof HVS_LENS_FAMILIES)[number]

export const HVS_DOF_INTENTS = ['DEEP', 'MODERATE', 'SHALLOW', 'EXTREME_SHALLOW'] as const
export type HvsDofIntent = (typeof HVS_DOF_INTENTS)[number]

export const HVS_MOTION_SPEEDS = ['VERY_SLOW', 'SLOW', 'NORMAL', 'FAST', 'VERY_FAST'] as const
export type HvsMotionSpeed = (typeof HVS_MOTION_SPEEDS)[number]

export const HVS_SCREEN_DIRECTIONS = ['LEFT_TO_RIGHT', 'RIGHT_TO_LEFT', 'TOWARD_CAMERA', 'AWAY_FROM_CAMERA'] as const
export type HvsScreenDirection = (typeof HVS_SCREEN_DIRECTIONS)[number]

export const HVS_RELATIVE_PLACEMENTS = [
  'IN_FRONT_OF',
  'BEHIND',
  'LEFT_OF',
  'RIGHT_OF',
  'ABOVE',
  'BELOW',
  'OVER_SHOULDER',
  'FOLLOW_BEHIND',
] as const
export type HvsRelativePlacement = (typeof HVS_RELATIVE_PLACEMENTS)[number]

export const HVS_PATH_INTERPOLATIONS = ['LINEAR', 'BEZIER', 'CATMULL_ROM', 'EASE_IN_OUT'] as const
export type HvsCinemaPathInterpolation = (typeof HVS_PATH_INTERPOLATIONS)[number]

export const HVS_HANDHELD_STYLES = ['SUBTLE', 'DOCUMENTARY', 'URGENT', 'CHAOTIC'] as const
export type HvsHandheldStyle = (typeof HVS_HANDHELD_STYLES)[number]

export const HVS_CINEMA_SKILLS = [
  'ACTION',
  'COMMERCIAL',
  'DIALOGUE',
  'DOCUMENTARY',
  'HORROR',
  'MUSIC_VIDEO',
  'LUXURY',
  'SPORTS',
  'CAR_COMMERCIAL',
] as const
export type HvsCinemaSkill = (typeof HVS_CINEMA_SKILLS)[number]

export const HVS_MOVIE_PRESETS = [
  'HERO_LOW_WIDE',
  'SLOW_PUSH_CLOSEUP',
  'OTS_DIALOGUE',
  'ESTABLISHING_CRANE',
  'CAR_COMMERCIAL_ORBIT',
  'ACTION_FOLLOW',
  'DOCUMENTARY_HANDHELD',
  'DRONE_REVEAL',
  'HORROR_DUTCH_PUSH',
  'MACRO_INSERT',
  'PRODUCT_TURNTABLE',
] as const
export type HvsMovieCameraPreset = (typeof HVS_MOVIE_PRESETS)[number]

export const HVS_CAMERA_PATCH_KINDS = [
  'CHANGE_POSITION',
  'CHANGE_HEIGHT',
  'CHANGE_ANGLE',
  'CHANGE_LENS',
  'CHANGE_FRAMING',
  'CHANGE_TARGET',
  'CHANGE_PATH',
  'CHANGE_SPEED',
  'CHANGE_ORBIT',
  'CHANGE_FOCUS',
  'CHANGE_DOF',
  'ADD_SHAKE',
  'REMOVE_SHAKE',
  'CHANGE_SHOT_DURATION',
  'REORDER_SHOTS',
] as const
export type HvsCameraPlanPatchKind = (typeof HVS_CAMERA_PATCH_KINDS)[number]

export const HVS_CAMERA_CONTROL_CAPABILITIES = [
  'PROMPT_ONLY',
  'FIRST_LAST_FRAME',
  'KEYFRAME',
  'MOTION_REFERENCE',
  'TRAJECTORY',
  'DEPTH',
  'POSE',
  'FULL_3D_CAMERA',
] as const
export type CameraControlCapability = (typeof HVS_CAMERA_CONTROL_CAPABILITIES)[number]

export type CameraHonesty = 'PROMPT_APPROXIMATION' | 'GEOMETRIC' | 'REFERENCE_DRIVEN'

export type CameraTargetRef =
  | { kind: 'PERSON'; id: string; label: string }
  | { kind: 'OBJECT'; id: string; label: string }
  | { kind: 'GROUP'; id: string; label: string }
  | { kind: 'WORLD_POINT'; id: string; label: string; point: Vec3 }

export type HvsCinemaSubjectRef = {
  id: string
  label: string
  kind: 'person' | 'group'
  screenDirection?: HvsScreenDirection | null
}

export type HvsCinemaPropRef = {
  id: string
  label: string
  kind: string
  color?: string | null
}

export type HvsCinemaLocationRef = {
  id: string
  label: string
  kind: string
}

export type HvsFocusTransition = {
  id: string
  shotId: string
  fromTarget: CameraTargetRef
  toTarget: CameraTargetRef
  startTime: MediaTime
  endTime: MediaTime
  curve: HvsCinemaPathInterpolation
}

export type HvsCameraPathPoint = {
  time: MediaTime
  position: Vec3
  rotation: Vec3 | null
  target: Vec3 | null
  focalLength: number | null
  focusDistance: number | null
  interpolation: HvsCinemaPathInterpolation
}

export type HvsCameraPath = {
  id: string
  shotId: string
  interpolation: HvsCinemaPathInterpolation
  points: HvsCameraPathPoint[]
}

export type HvsOrbitParams = {
  targetId: string
  radius: number
  height: number
  startAngle: number
  endAngle: number
  direction: 'CLOCKWISE' | 'COUNTERCLOCKWISE'
  duration: MediaTime
  framing: HvsCinemaFraming
}

export type HvsHandheldLayer = {
  style: HvsHandheldStyle
  amplitude: number
  frequency: number
  translationNoise: number
  rotationNoise: number
}

export type HvsCameraShakeLayer = {
  id: string
  shotId: string | null
  event: string
  intensity: number
  duration: MediaTime
  frequency: number
}

export type HvsContinuityWarning = {
  kind: 'CONTINUITY_WARNING'
  rule: 'AXIS_180' | 'JUMP_CUT_30'
  shotId: string
  relatedShotId: string | null
  message: string
  intentionalAxisBreak: boolean
}

export type HvsContinuityReport = {
  lineOfAction: { axisYaw: number; cameraSide: 'LEFT' | 'RIGHT' | 'ON_AXIS' } | null
  screenDirections: Array<{ shotId: string; subjectId: string; direction: HvsScreenDirection }>
  warnings: HvsContinuityWarning[]
}

export type HvsStoryboardShotLink = {
  shotId: string
  frameId: string | null
  beatId: string | null
}

export type HvsCinemaDestructionCue = {
  eventKind: string
  shotId: string
  cameraResponse: 'SHAKE' | 'PULL_BACK' | 'HOLD' | 'HAZE'
  start: MediaTime
}

export type HvsShotIntent = {
  order: number
  text: string
  shotSize: HvsCinemaShotSize | null
  shotRole: HvsCinemaShotRole | null
  angle: HvsCinemaAngle | null
  movement: HvsCinemaMovement | null
  lensMm: number | null
  lensFamily: HvsLensFamily | null
  framing: HvsCinemaFraming | null
  relative: HvsRelativePlacement | null
  speed: HvsMotionSpeed | null
  preset: HvsMovieCameraPreset | null
}

export type HvsCinemaIntent = {
  id: string
  projectId?: string
  sceneId?: string
  prompt: string
  duration?: MediaTime
  style?: string
  tone?: string
  shotIntent: HvsShotIntent[]
  subjectRefs: HvsCinemaSubjectRef[]
  locationRefs: HvsCinemaLocationRef[]
  propRefs: HvsCinemaPropRef[]
  cameraLanguage?: string
  lightingIntent?: string
  continuityRequirements?: string[]
  skill?: HvsCinemaSkill | null
  createdAt: string
}

export type HvsShot = {
  id: string
  sceneId: string
  name: string
  description: string
  start: MediaTime
  end: MediaTime
  duration: MediaTime
  shotSize: HvsCinemaShotSize
  shotRole: HvsCinemaShotRole | null
  cameraAngle: HvsCinemaAngle
  cameraAngleDegrees?: { pitch: number; yaw: number; roll: number }
  cameraMovement: HvsCinemaMovement
  cameraSpec: CameraSpec
  subjectRefs: string[]
  targetRef: CameraTargetRef | null
  framing: HvsCinemaFraming
  focus: {
    target: CameraTargetRef | null
    distance: number | null
    dofIntent: HvsDofIntent
    aperture: number | null
  }
  lightingIntent?: string
  transitionIntent?: string
  continuityIn?: HvsScreenDirection | null
  continuityOut?: HvsScreenDirection | null
  relativePlacement?: HvsRelativePlacement | null
  orbit?: HvsOrbitParams | null
  handheld?: HvsHandheldLayer | null
  speed: HvsMotionSpeed
  pathId: string
  preset?: HvsMovieCameraPreset | null
  status: 'proposed' | 'approved' | 'built'
  characterIds?: string[]
  actingIntentIds?: string[]
  blockingPlanId?: string | null
  gazePlanIds?: string[]
  wardrobeSetId?: string | null
}

export type HvsCinemaPlan = {
  id: string
  intentId: string
  projectId: string
  sceneId: string
  title: string
  duration: MediaTime
  shots: HvsShot[]
  paths: HvsCameraPath[]
  specs: CameraSpec[]
  focusTransitions: HvsFocusTransition[]
  shakeLayers: HvsCameraShakeLayer[]
  continuity: HvsContinuityReport
  storyboardLinks: HvsStoryboardShotLink[]
  destructionCues: HvsCinemaDestructionCue[]
  skill: HvsCinemaSkill | null
  commanderShotList: Array<{ index: number; name: string; durationLabel: string; shotId: string }>
  status: 'proposed' | 'approved' | 'built' | 'rejected'
  approvalRequired: true
  approvalAction: 'PREVIEW'
  mutated: false
  createdAt: string
}

export type HvsCameraPlanPatch = {
  id: string
  planId: string
  prompt: string
  kinds: HvsCameraPlanPatchKind[]
  shotId: string | null
  summaryLines: string[]
  status: 'proposed' | 'applied' | 'rejected'
  approvalRequired: true
  createdAt: string
}

export type HvsCinemaDirectorStore = {
  schemaVersion: typeof HVS_CINEMA_SCHEMA
  activePlanId: string | null
  plans: HvsCinemaPlan[]
}

export const emptyCinemaDirectorStore = (): HvsCinemaDirectorStore => ({
  schemaVersion: HVS_CINEMA_SCHEMA,
  activePlanId: null,
  plans: [],
})

export type CompiledCameraBackend = {
  backend: string
  honesty: CameraHonesty
  capabilities: CameraControlCapability[]
  payload: Record<string, unknown>
  promptTokens?: string[]
}

export function cinemaId(prefix: string): string {
  return nid(prefix)
}

export function cinemaSeconds(n: number, timescale = DEFAULT_TIMESCALE): MediaTime {
  return fromSeconds(n, timescale)
}
