/**
 * HVS Director Orchestration — planning / previs layer.
 * Compiles into existing Hvs3DScene. Does not duplicate Director, Scene, or Timeline types.
 */
import { type MediaTime } from '../time'
import type { CameraSpec } from '../types'
import type { HvsCameraMotionPreset } from '../director3d/types'
import type { HvsDestructionIntent, HvsDestructionPlan } from '../destruction/types'
import { RAEL_CHARACTER_ID } from '../digital-human/types'

export type { HvsDestructionIntent, HvsDestructionPlan }

export const HVS_DIRECTOR_ORCHESTRATION_SLICE = 'HVS-DIRECTOR-ORCHESTRATION'
export const HVS_DIRECTOR_PLAN_SCHEMA = 1 as const

/** Canonical Ra'el identity from the digital-human foundation. Do not mint a second Ra'el. */
export const HVS_RAEL_CHARACTER_ID = RAEL_CHARACTER_ID
export const HVS_RAEL_NODE_ID = 'node-person'

export type HvsShotPurpose =
  | 'ESTABLISH_GEOGRAPHY'
  | 'INTRODUCE_SUBJECT'
  | 'REVEAL_INFORMATION'
  | 'TRACK_ACTION'
  | 'BUILD_TENSION'
  | 'SHOW_IMPACT'
  | 'REACTION'
  | 'DETAIL'
  | 'TRANSITION'
  | 'RESOLUTION'

export type HvsSpatialRelationKind =
  | 'LEFT_OF'
  | 'RIGHT_OF'
  | 'IN_FRONT_OF'
  | 'BEHIND'
  | 'BESIDE'
  | 'ABOVE'
  | 'BELOW'
  | 'NEAR'
  | 'FAR'
  | 'INSIDE'
  | 'OUTSIDE'
  | 'FACING'
  | 'MOVING_TOWARD'
  | 'MOVING_AWAY_FROM'

export type HvsSpatialRelation = {
  subjectRef: string
  relation: HvsSpatialRelationKind
  objectRef: string
  distanceIntent: number | null
  direction: string | null
  confidence: number
}

export type HvsStoryBeat = {
  id: string
  order: number
  description: string
  purpose: string
  start: MediaTime
  end: MediaTime
  subjectActions: string[]
  environmentActions: string[]
  cameraIntent: string | null
  vfxIntent: string | null
  audioIntent: string | null
}

export type HvsDirectorConstraintKind =
  | 'KEEP_RAEL_VISIBLE'
  | 'KEEP_CAR_VISIBLE'
  | 'BUILDING_INTACT_UNTIL_BEAT'
  | 'END_ON_RAEL'
  | 'DO_NOT_CROSS_AXIS'
  | 'PROTECT_HERO_REGION'
  | 'KEEP_BACKGROUND_DESTRUCTION_VISIBLE'

export type HvsDirectorShot = {
  id: string
  order: number
  beatId: string
  name: string
  purpose: HvsShotPurpose
  directorReason: string
  start: MediaTime
  end: MediaTime
  cameraSpec: CameraSpec
  motionPreset: HvsCameraMotionPreset
  targetLock: 'PERSON' | 'CAR' | 'DOORWAY' | 'NONE'
  transitionIn: 'CUT' | 'DISSOLVE' | 'MATCH_CUT' | 'WHIP_TRANSITION' | 'FADE'
  commanderLabel: string
  sceneNodeCameraId: string | null
  constraints: string[]
}

export type HvsDirectorCharacter = {
  id: string
  ref: string
  label: string
  state: 'PLACEHOLDER CHARACTER'
  startRef: string
  endRef: string
  identityRef: string
  canonicalName: string
}

export type HvsDirectorElement = {
  id: string
  ref: string
  kind: 'car' | 'building' | 'doorway' | 'ground' | 'dust' | 'other'
  label: string
  color: string | null
}

export type HvsBlockingActionKind = 'STAND' | 'WALK' | 'ARRIVE' | 'LOOK_BACK' | 'TURN_TO_CAMERA' | 'HOLD'

export type HvsBlockingPlan = {
  id: string
  subjectRef: string
  identityRef: string
  pathId: string
  actions: Array<{
    id: string
    atSec: number
    kind: HvsBlockingActionKind
    description: string
  }>
}

export type HvsCrowdRole = 'WALKING' | 'STOREFRONT'
export type HvsCrowdBehavior = 'WALK' | 'IDLE' | 'REACT' | 'MOVE_AWAY' | 'FLEE'

export type HvsBackgroundActor = {
  id: string
  ref: string
  role: HvsCrowdRole
  start: { x: number; y: number; z: number }
  nearestToEvent: boolean
  reactStartSec: number
  fleeStartSec: number
}

export type HvsBackgroundPopulation = {
  id: string
  count: number
  honesty: 'PLACEHOLDER PEOPLE'
  actors: HvsBackgroundActor[]
  reactionCue: 'MAJOR_COLLAPSE'
}

export type HvsActingPlan = {
  lookBack: boolean
  lookBackSec: number
  turnToCameraSec: number
  gazeTargetRef: string | null
}

export type HvsLightingPlan = {
  timeOfDay: 'night' | 'day' | 'dawn' | 'dusk'
  keyDirection: string
  fillIntent: string
  backlightIntent: string
  environment: string
  contrast: 'low' | 'medium' | 'high'
  colorTemperatureIntent: string
  summary: string
  shotOverrides: Array<{ shotId: string; note: string }>
}

export type HvsFocusPlan = {
  defaultTarget: string
  visualDof: 'PARTIAL'
  honesty: 'METADATA_PASS_VISUAL_PARTIAL'
  shots: Array<{
    shotId: string
    target: string
    focalLengthMm: number
    depthOfField: 'shallow' | 'medium' | 'deep'
    rackFrom: string | null
  }>
}

export type HvsDestructionState = 'INTACT' | 'CRACKING' | 'COLLAPSING' | 'COLLAPSED'

export type HvsVfxCueKind =
  | 'DUST'
  | 'SMOKE'
  | 'SPARKS'
  | 'DEBRIS'
  | 'GLASS'
  | 'LIGHT_FLASH'
  | 'CAMERA_SHAKE'
  | 'HAZE'

export type HvsVfxCue = {
  id: string
  kind: HvsVfxCueKind
  time: MediaTime
  linkedEvent: 'collapse' | 'impact' | 'retreat' | 'closeup' | null
  execution: 'INTENT_ONLY' | 'PREVIS_PLACEHOLDER'
  label: string
}

export type HvsProtectedSubjectRegion = {
  subjectRef: string
  radiusMeters: number
}

export type HvsContinuityState = {
  subjectScreenPosition: 'left' | 'center' | 'right'
  movementDirection: string
  cameraSide: string
  axisOfAction: string
  propPlacement: Array<{ ref: string; note: string }>
  characterPlacement: Array<{ ref: string; note: string }>
  lightingState: string
  destructionStateByTime: Array<{ time: MediaTime; state: HvsDestructionState }>
  wardrobe: string
  crowdState: string
}

export type HvsDirectorTiming = {
  durationSec: number
  walkArriveSec: number
  collapseSec: number
  retreatSec: number
  impactSec: number
  dustSec: number
  closeupStartSec: number
  orbitStartSec: number
  orbitEndSec: number
  closeupHeight: number
  closeupDistance: number
  closeupFocalMm: number
  establishFocalMm: number
  revealFocalMm: number
  orbitFocalMm: number
  retreatFocalMm: number
  crowdReactSec: number
  crowdFleeSec: number
  crowdCount: number
  lookBack: boolean
  lookBackSec: number
  turnToCameraSec: number
}

export type HvsDirectorPlan = {
  schemaVersion: typeof HVS_DIRECTOR_PLAN_SCHEMA
  id: string
  projectId: string
  sceneId: string | null
  prompt: string
  creativeGoal: string
  tone: string
  duration: MediaTime
  aspect: '16:9'
  storyBeats: HvsStoryBeat[]
  shots: HvsDirectorShot[]
  characters: HvsDirectorCharacter[]
  elements: HvsDirectorElement[]
  locations: string[]
  spatialRelations: HvsSpatialRelation[]
  castRefs: string[]
  backgroundPopulationRefs: string[]
  elementRefs: string[]
  locationRefs: string[]
  cameraPlanRefs: string[]
  blockingRefs: string[]
  cameraPlan: string
  movementPlan: string
  blockingPlan: HvsBlockingPlan
  backgroundPopulation: HvsBackgroundPopulation
  acting: HvsActingPlan
  destructionIntent: HvsDestructionIntent | null
  destructionPlan: HvsDestructionPlan | null
  destructionPlanRefs: string[]
  protectedSubjectRegion: HvsProtectedSubjectRegion
  destructionHonesty: 'GEOMETRIC_PROXY_NOT_SIMULATION'
  vfxCues: HvsVfxCue[]
  lightingPlan: HvsLightingPlan
  focusPlan: HvsFocusPlan
  audioIntent: string | null
  continuityState: HvsContinuityState
  constraints: Array<HvsDirectorConstraintKind | string>
  timing: HvsDirectorTiming
  approvalRequired: true
  approvalAction: 'BUILD_PREVIS'
  status: 'proposed' | 'previs' | 'approved' | 'rejected'
  mutated: false
  createdAt: string
  updatedAt: string
}

export type HvsDirectorOrchestrationStore = {
  schemaVersion: 1
  activePlanId: string | null
  plans: HvsDirectorPlan[]
}

export const emptyDirectorOrchestrationStore = (): HvsDirectorOrchestrationStore => ({
  schemaVersion: 1,
  activePlanId: null,
  plans: [],
})

export type HvsDirectorPlanPatchKind =
  | 'CHANGE_SHOT'
  | 'CHANGE_CAMERA'
  | 'CHANGE_LENS'
  | 'CHANGE_FRAMING'
  | 'CHANGE_SHOT_DURATION'
  | 'REORDER_SHOT'
  | 'CHANGE_SUBJECT_PATH'
  | 'CHANGE_PROP_POSITION'
  | 'CHANGE_DESTRUCTION_TIMING'
  | 'CHANGE_DESTRUCTION_SEVERITY'
  | 'CHANGE_LIGHTING'
  | 'CHANGE_FOCUS'
  | 'CHANGE_TRANSITION'
  | 'CHANGE_TOTAL_DURATION'
  | 'CHANGE_ACTING'
  | 'CHANGE_GAZE'
  | 'CHANGE_CROWD'

export type HvsDirectorPlanPatch = {
  id: string
  planId: string
  prompt: string
  kinds: HvsDirectorPlanPatchKind[]
  summary: string
  directorChoice: string | null
  timingDelta: Partial<HvsDirectorTiming>
  linkedUpdates: string[]
  status: 'proposed' | 'applied' | 'rejected'
  approvalRequired: true
  createdAt: string
}

export type HvsDirectorQcIssue = {
  code:
    | 'SUBJECT_LEAVES_FRAME'
    | 'CAMERA_CLIPS_GEOMETRY'
    | 'CAMERA_INSIDE_OBJECT'
    | 'TARGET_LOST'
    | 'CONTINUITY_AXIS'
    | 'SHOT_TOO_SHORT'
    | 'SHOT_OVERLAP'
    | 'DESTRUCTION_TOO_EARLY'
    | 'OBJECT_CONTINUITY'
    | 'FRAMING_WARNING'
    | 'CROWD_REACT_BEFORE_EVENT'
    | 'ACTOR_CAMERA_DESYNC'
    | 'RAEL_DUPLICATION'
    | 'BUILDING_STATE_MISMATCH'
  severity: 'info' | 'warning' | 'error'
  shotId: string | null
  message: string
}

export type HvsDirectorQcReport = {
  ok: boolean
  issues: HvsDirectorQcIssue[]
}

export type HvsDirectorStoryboardFrame = {
  id: string
  shotId: string
  index: number
  title: string
  description: string
  derivedFrom: '3D_CAMERA_EVAL'
  svg: string
  time: MediaTime
  derivedAssetId: string | null
}

export type HvsTrackSample = { t: number; x: number; y: number; z: number }

export type HvsDirectorPrevis = {
  id: string
  planId: string
  sceneId: string
  duration: MediaTime
  shots: Array<{ id: string; name: string; startSec: number; endSec: number; purpose: HvsShotPurpose }>
  sceneHash: string
  cameraTracks: Array<{ shotId: string; samples: HvsTrackSample[] }>
  subjectTracks: Array<{ ref: string; samples: HvsTrackSample[] }>
  actorTracks: Array<{ ref: string; samples: HvsTrackSample[] }>
  crowdTracks: Array<{ ref: string; samples: HvsTrackSample[] }>
  destructionRefs: string[]
  lightingState: string
  artifactRefs: string[]
  storyboard: HvsDirectorStoryboardFrame[]
  status: 'ready' | 'placeholder'
  playback: 'realtime-viewport'
}

export type HvsProductionBlueprint = {
  id: string
  planId: string
  sceneId: string
  projectId: string
  providerNeutral: true
  generatorAuthorized: false
  duration: MediaTime
  storyBeats: HvsStoryBeat[]
  shots: HvsDirectorShot[]
  cameraSpecs: CameraSpec[]
  cameraTrajectories: HvsDirectorPrevis['cameraTracks']
  subjectTrajectories: HvsDirectorPrevis['subjectTracks']
  actorTrajectories: HvsDirectorPrevis['actorTracks']
  crowdBehavior: HvsBackgroundPopulation
  characterRefs: string[]
  sceneState: HvsContinuityState
  elementRefs: HvsDirectorElement[]
  lighting: HvsLightingPlan
  focus: HvsFocusPlan
  destructionTiming: { startSec: number; impactSec: number; endSec: number } | null
  vfxCues: HvsVfxCue[]
  continuity: HvsContinuityState
  storyboardFrameRefs: string[]
  createdAt: string
}

export function did(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
