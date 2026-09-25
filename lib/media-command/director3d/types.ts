/**
 * HVS 3D Director — canonical scene truth.
 * Three.js objects are a viewport, never project truth.
 *
 * World: meters, +Y up, -Z forward, +X right, Euler XYZ radians.
 */
import { DEFAULT_TIMESCALE, type MediaTime, type Rational, fromSeconds } from '../time'
import type { CameraSpec, VirtualCamera } from '../types'

export const HVS_3D_DIRECTOR_SLICE = 'HVS-3D-DIRECTOR-FOUNDATION'
export const HVS_3D_SCENE_SCHEMA = 1 as const

export const HVS_3D_WORLD = {
  units: 'meters',
  up: '+Y',
  forward: '-Z',
  right: '+X',
  rotationOrder: 'XYZ',
} as const

export type Vec3 = { x: number; y: number; z: number }

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z })
export const VEC3_ZERO: Vec3 = { x: 0, y: 0, z: 0 }
export const VEC3_ONE: Vec3 = { x: 1, y: 1, z: 1 }

export type HvsTransform3D = {
  position: Vec3
  rotation: Vec3
  scale: Vec3
}

export const identityTransform3D = (): HvsTransform3D => ({
  position: { ...VEC3_ZERO },
  rotation: { ...VEC3_ZERO },
  scale: { ...VEC3_ONE },
})

export type HvsSceneNodeType =
  | 'GROUP'
  | 'MODEL'
  | 'CHARACTER'
  | 'PROP'
  | 'CAMERA'
  | 'LIGHT'
  | 'ENVIRONMENT'
  | 'EMPTY'
  | 'PATH'
  | 'VOLUME'

export type HvsPlaceholderKind = 'person' | 'car' | 'box' | 'sphere' | 'plane' | 'building'

export type HvsSceneNode = {
  id: string
  type: HvsSceneNodeType
  name: string
  parentId: string | null
  transform: HvsTransform3D
  visible: boolean
  placeholder: HvsPlaceholderKind | null
  assetId: string | null
  bounds: { min: Vec3; max: Vec3 }
  color: string | null
  label: string
}

export type Hvs3DCharacterState = 'PLACEHOLDER' | 'RIGGED' | 'ANIMATED'

export type Hvs3DCharacter = {
  id: string
  nodeId: string
  assetId: string | null
  label: string
  transform: HvsTransform3D
  pose: string | null
  rigRef: string | null
  motionPathId: string | null
  state: Hvs3DCharacterState
  motionHonesty: 'POSITIONAL_MOTION' | 'CHARACTER_ANIMATION'
  /** Canonical character record id. Same identity across shots; never a second body. */
  identityRef?: string | null
  /** Same id as HvsDigitalHuman. Not a second identity. */
  digitalHumanId?: string | null
  lod?: 'HIGH' | 'MEDIUM' | 'LOW'
  role?: 'HERO' | 'BACKGROUND'
  /** Existing HvsPerformanceTake id. Not a second motion record. */
  performanceTakeId?: string | null
  /** Scene-clock time when this take begins. Default 0. Not a second timeline. */
  performanceStartTime?: MediaTime | null
  /** Default HOLD_LAST (once through, then hold). Loop is never implied. */
  performancePlayback?: 'ONCE' | 'HOLD_LAST' | 'LOOP' | null
}

export type Hvs3DProp = {
  id: string
  nodeId: string
  assetId: string | null
  label: string
  kind: string
  transform: HvsTransform3D
  placeholder: HvsPlaceholderKind | null
}

export type HvsLightKind = 'AMBIENT' | 'DIRECTIONAL' | 'POINT' | 'SPOT' | 'AREA'

export type Hvs3DLight = {
  id: string
  nodeId: string
  kind: HvsLightKind
  color: string
  intensity: number
  targetNodeId: string | null
  angle: number | null
  distance: number | null
}

export type Hvs3DEnvironment = {
  background: string
  ground: 'city-street' | 'studio' | 'none'
  sky: 'night' | 'day' | 'dusk' | 'overcast'
  timeOfDay: 'night' | 'day' | 'dawn' | 'dusk'
  weatherIntent: 'clear' | 'wet' | 'fog' | 'rain' | null
  fog: number
  ambientLight: number
}

export type HvsPathInterpolation = 'LINEAR' | 'BEZIER' | 'CATMULL_ROM'

export type HvsMotionPathPoint = {
  time: MediaTime
  position: Vec3
  rotation: Vec3 | null
  speed: number | null
  easing: HvsKeyframeInterpolation
}

export type HvsMotionPath3D = {
  id: string
  name: string
  kind: 'SUBJECT' | 'CAMERA'
  interpolation: HvsPathInterpolation
  points: HvsMotionPathPoint[]
  assignedNodeId: string | null
}

export type HvsKeyframeInterpolation = 'LINEAR' | 'EASE_IN' | 'EASE_OUT' | 'EASE_IN_OUT' | 'SPLINE'

export type Hvs3DKeyframeProperty = 'position' | 'rotation' | 'scale' | 'focalLength' | 'lightIntensity'

export type Hvs3DKeyframe = {
  id: string
  targetNodeId: string
  property: Hvs3DKeyframeProperty
  time: MediaTime
  value: number | Vec3
  interpolation: HvsKeyframeInterpolation
}

export type HvsCameraMotionPreset =
  | 'STATIC'
  | 'PAN'
  | 'TILT'
  | 'PUSH_IN'
  | 'PULL_OUT'
  | 'DOLLY'
  | 'TRUCK'
  | 'PEDESTAL'
  | 'ORBIT'
  | 'CRANE'
  | 'ARC'
  | 'HANDHELD_STYLE'
  | 'FOLLOW'
  | 'REVEAL'
  | 'CUSTOM_PATH'

export type HvsCameraTarget =
  | { kind: 'NODE'; nodeId: string }
  | { kind: 'CHARACTER'; characterId: string }
  | { kind: 'WORLD'; point: Vec3 }

export type Hvs3DCamera = {
  id: string
  nodeId: string
  name: string
  cameraSpecId: string | null
  virtualCameraMode: VirtualCamera['mode']
  shotSize: CameraSpec['shotSize']
  angle: CameraSpec['angle']
  movement: HvsCameraMotionPreset
  focalLength: number
  focusDistance: number
  apertureIntent: 'closed' | 'medium' | 'open'
  sensorAspect: '16:9' | '9:16' | '1:1'
  target: HvsCameraTarget | null
  pathId: string | null
}

export type Hvs3DShot = {
  id: string
  name: string
  start: MediaTime
  end: MediaTime
  cameraId: string
  motionPreset: HvsCameraMotionPreset
  notes: string
  commanderLabel: string
}

export type Hvs3DTimeline = {
  timescale: number
  frameRate: Rational
  duration: MediaTime
}

export type Hvs3DScene = {
  schemaVersion: typeof HVS_3D_SCENE_SCHEMA
  id: string
  projectId: string
  name: string
  duration: MediaTime
  frameRate: Rational
  world: typeof HVS_3D_WORLD
  rootId: string
  objects: HvsSceneNode[]
  characters: Hvs3DCharacter[]
  props: Hvs3DProp[]
  cameras: Hvs3DCamera[]
  lights: Hvs3DLight[]
  paths: HvsMotionPath3D[]
  shots: Hvs3DShot[]
  keyframes: Hvs3DKeyframe[]
  timeline: Hvs3DTimeline
  environment: Hvs3DEnvironment
  version: number
  createdAt: string
  updatedAt: string
}

export type HvsDirector3DStore = {
  activeSceneId: string | null
  scenes: Hvs3DScene[]
  revisions: Array<{ id: string; sceneId: string; label: string; createdAt: string; snapshot: Hvs3DScene }>
  approvedBlueprintId: string | null
}

export const emptyDirector3DStore = (): HvsDirector3DStore => ({
  activeSceneId: null,
  scenes: [],
  revisions: [],
  approvedBlueprintId: null,
})

export type Hvs3DIntent = {
  id: string
  projectId: string
  prompt: string
  sceneType: 'city-night' | 'studio' | 'generic' | null
  duration: MediaTime
  style: string | null
  environment: Hvs3DEnvironment['sky'] | null
  timeOfDay: Hvs3DEnvironment['timeOfDay'] | null
  subjects: Array<{ kind: 'person' | 'crowd'; label: string }>
  props: Array<{ kind: string; label: string; color?: string | null }>
  cameraIntent: HvsCameraMotionPreset[]
  subjectMotion: string | null
  cameraMotion: string | null
  lightingIntent: string | null
  framingIntent: VirtualCamera['mode'] | null
  constraints: string[]
  createdAt: string
}

export type HvsScenePlanStep = {
  id: string
  label: string
  doneIntent: string
}

export type HvsScenePlan = {
  id: string
  intentId: string
  projectId: string
  title: string
  durationLabel: string
  environmentLabel: string
  shotCount: number
  shots: Array<{ id: string; order: number; label: string; durationLabel: string }>
  steps: HvsScenePlanStep[]
  status: 'proposed' | 'approved' | 'built' | 'rejected'
  approvalRequired: true
  approvalAction: 'BUILD_SCENE'
  mutated: false
  createdAt: string
}

export type Hvs3DPlanPatchKind =
  | 'MOVE_SUBJECT'
  | 'MOVE_PROP'
  | 'CHANGE_SCALE'
  | 'CHANGE_ENVIRONMENT'
  | 'CHANGE_CAMERA_START'
  | 'CHANGE_CAMERA_END'
  | 'CHANGE_CAMERA_PATH'
  | 'CHANGE_FRAMING'
  | 'CHANGE_FOCAL_LENGTH'
  | 'CHANGE_MOTION_PATH'
  | 'CHANGE_SPEED'
  | 'CHANGE_LIGHTING'
  | 'CHANGE_SHOT_DURATION'
  | 'REORDER_SHOTS'

export type Hvs3DPlanPatch = {
  id: string
  sceneId: string
  prompt: string
  kinds: Hvs3DPlanPatchKind[]
  summaryLines: string[]
  status: 'proposed' | 'applied' | 'rejected'
  approvalRequired: true
  createdAt: string
}

export type Hvs3DPrevisResult = {
  sceneId: string
  duration: MediaTime
  frameRate: Rational
  shots: Array<{ id: string; name: string; startSec: number; endSec: number }>
  cameraData: Array<{ id: string; name: string; movement: HvsCameraMotionPreset; target: HvsCameraTarget | null }>
  sceneHash: string
  previewVideoPath: string | null
  playback: 'realtime-viewport'
}

export type HvsProductionBlueprint3D = {
  id: string
  sceneId: string
  projectId: string
  providerNeutral: true
  duration: MediaTime
  frameRate: Rational
  environment: Hvs3DEnvironment
  lightingIntent: string
  shots: Array<{
    id: string
    name: string
    start: MediaTime
    end: MediaTime
    cameraId: string
    motionPreset: HvsCameraMotionPreset
    framing: VirtualCamera['mode']
    cameraTrack: Array<{ time: MediaTime; position: Vec3; lookAt: Vec3 }>
    subjectTracks: Array<{ nodeId: string; label: string; samples: Array<{ time: MediaTime; position: Vec3 }> }>
  }>
  objectPlacement: Array<{ id: string; label: string; type: HvsSceneNodeType; position: Vec3; placeholder: HvsPlaceholderKind | null }>
  referenceRequirements: Array<
    'previs-mp4' | 'depth' | 'normals' | 'segmentation' | 'camera-trajectory' | 'pose-guides' | 'object-masks' | 'first-last-frame'
  >
  createdAt: string
}

export function nid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function seconds(n: number, timescale = DEFAULT_TIMESCALE): MediaTime {
  return fromSeconds(n, timescale)
}

export function emptyTimeline3D(durationSec = 8, fps: Rational = { n: 24, d: 1 }): Hvs3DTimeline {
  const duration = fromSeconds(durationSec)
  return { timescale: DEFAULT_TIMESCALE, frameRate: fps, duration }
}

export function emptyScene(projectId: string, name = 'Untitled 3D scene', durationSec = 8): Hvs3DScene {
  const now = new Date().toISOString()
  const rootId = nid('root')
  const duration = fromSeconds(durationSec)
  return {
    schemaVersion: HVS_3D_SCENE_SCHEMA,
    id: nid('hvs3d'),
    projectId,
    name,
    duration,
    frameRate: { n: 24, d: 1 },
    world: HVS_3D_WORLD,
    rootId,
    objects: [{
      id: rootId,
      type: 'GROUP',
      name: 'World',
      parentId: null,
      transform: identityTransform3D(),
      visible: true,
      placeholder: null,
      assetId: null,
      bounds: { min: vec3(-50, 0, -50), max: vec3(50, 40, 50) },
      color: null,
      label: 'World',
    }],
    characters: [],
    props: [],
    cameras: [],
    lights: [],
    paths: [],
    shots: [],
    keyframes: [],
    timeline: emptyTimeline3D(durationSec),
    environment: {
      background: '#05070c',
      ground: 'city-street',
      sky: 'night',
      timeOfDay: 'night',
      weatherIntent: null,
      fog: 0.08,
      ambientLight: 0.18,
    },
    version: 1,
    createdAt: now,
    updatedAt: now,
  }
}

export function cloneScene(scene: Hvs3DScene): Hvs3DScene {
  return JSON.parse(JSON.stringify(scene)) as Hvs3DScene
}

export function findNode(scene: Hvs3DScene, id: string): HvsSceneNode | null {
  return scene.objects.find(node => node.id === id) ?? null
}
