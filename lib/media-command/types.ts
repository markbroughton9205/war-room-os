/**
 * Higher Vision Studios project objects. .hvsproj is the authoritative current state.
 * Tracks are the timeline source of truth. Magnetic layout is UX-only (EditOps), never storage.
 */
import { DEFAULT_TIMESCALE, type MediaTime, type Rational, zeroTime } from './time'
import type { HvsEffectGraph } from './effect-graph'
import type { ColorPipeline } from './color-pipeline'
import type { AudioGraph } from './audio-graph'
import { emptyDirector3DStore, type HvsDirector3DStore } from './director3d/types'
import { emptyDestructionStore, type HvsDestructionStore } from './destruction/types'
import { emptyCinemaDirectorStore, type HvsCinemaDirectorStore } from './cinema-director/types'
import { emptyDigitalHumanStore, type HvsDigitalHumanStore } from './digital-human/types'
import { emptyDirectorOrchestrationStore, type HvsDirectorOrchestrationStore } from './director/types'
import type { HvsUnrealTruthBinding } from './unreal/types'

export const HVSPROJ_VERSION = 0 as const
/** Forward-compatible kernel schema. Independent of formatVersion so existing .hvsproj files still parse. */
export const HVS_KERNEL_SCHEMA_VERSION = 1 as const

export const ASSET_ROLES = ['ORIGINAL', 'PROXY', 'MASTER', 'RENDER'] as const
export type AssetRole = (typeof ASSET_ROLES)[number]

export const HVS_RIGHTS_STATES = [
  'OWNABLE',
  'STREAM_ONLY',
  'REQUIRE_AUTH',
  'REFUSE',
  'AI_GENERATED',
  'UNKNOWN',
] as const
export type HvsRightsState = (typeof HVS_RIGHTS_STATES)[number]

export type AssetRights = {
  state: HvsRightsState
  commercialOk: boolean
  source?: string | null
  notes?: string | null
}

export type HvsSequence = {
  id: string
  name: string
  timelineId: string
}

export const PRODUCTION_MODES = [
  'COMMERCIAL',
  'SOCIAL',
  'YOUTUBE',
  'MUSIC_VIDEO',
  'GAMING',
  'SHORT_FILM',
  'FILM_SHOW',
  'CUSTOM',
] as const

export type ProductionMode = (typeof PRODUCTION_MODES)[number]

export const TRACK_KINDS = ['video', 'audio', 'caption', 'graphics'] as const
export type TrackKind = (typeof TRACK_KINDS)[number]

export const ASSET_KINDS = ['video', 'audio', 'image', 'graphic', 'logo', 'generated'] as const
export type AssetKind = (typeof ASSET_KINDS)[number]

export const OUTPUT_ASPECTS = ['16:9', '9:16', '1:1'] as const
export type OutputAspect = (typeof OUTPUT_ASPECTS)[number]

export type Transform = {
  x: number
  y: number
  scaleX: number
  scaleY: number
  rotation: number
  anchorX: number
  anchorY: number
}

export type Crop = {
  left: number
  top: number
  right: number
  bottom: number
}

export type ColorGrade = {
  exposure: number
  contrast: number
  saturation: number
  temperature: number
  lookId: string | null
}

export const IDENTITY_COLOR: ColorGrade = {
  exposure: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  lookId: null,
}

export const IDENTITY_TRANSFORM: Transform = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  anchorX: 0.5,
  anchorY: 0.5,
}

export const IDENTITY_CROP: Crop = { left: 0, top: 0, right: 0, bottom: 0 }

export type AssetProvenance = {
  provider: string | null
  model: string | null
  prompt: string | null
  promptHash?: string | null
  parameters: Record<string, unknown>
  seed: string | number | null
  referenceAssetIds: string[]
  sourceAssetIds: string[]
  createdAt: string
  commercialUse: 'unknown' | 'allowed' | 'restricted' | 'forbidden'
  parentAssetId: string | null
  parentAssetIds?: string[]
  providerJobId?: string | null
  origin?: 'captured' | 'generated' | 'derived' | 'upload' | 'render' | 'unknown'
  license?: string | null
  externalTransfer?: { provider: string; transferred: boolean; reason: string } | null
  projectId: string
}

export type AudioStreamInfo = {
  codec: string | null
  sampleRate: number | null
  channels: number | null
}

export type AssetRecord = {
  id: string
  kind: AssetKind
  name: string
  originalPath: string
  proxyPath: string | null
  thumbPath: string | null
  waveformPath: string | null
  checksumSha256: string
  mimeType: string
  duration: MediaTime
  width: number | null
  height: number | null
  frameRate: Rational | null
  variableFrameRate: boolean
  sampleRate: number | null
  channels: number | null
  codec: string | null
  container: string | null
  pixelFormat: string | null
  rotation: number | null
  audioStreams: AudioStreamInfo[]
  immutableOriginal: true
  generated: boolean
  provenance: AssetProvenance | null
  createdAt: string
  outputOfRenderJobId?: string | null
  /** Kernel AssetRef role. Missing on legacy assets → ORIGINAL. PROXY can never become master. */
  role?: AssetRole
  derivedFromAssetId?: string | null
  rights?: AssetRights | null
}

export type AppliedEffect = {
  id: string
  effectId: string
  enabled: boolean
  params: Record<string, number | string | boolean>
}

export type AppliedFilter = {
  id: string
  filterId: string
  amount: number
  enabled: boolean
}

export type Clip = {
  id: string
  trackId: string
  assetId: string
  name: string
  start: MediaTime
  duration: MediaTime
  sourceIn: MediaTime
  sourceOut: MediaTime
  speed: Rational
  reversed: boolean
  freeze: boolean
  transform: Transform
  crop: Crop
  opacity: number
  volume: number
  fadeIn: MediaTime
  fadeOut: MediaTime
  pan: number
  color: ColorGrade
  effects: AppliedEffect[]
  filters: AppliedFilter[]
  enabled: boolean
}

export type Transition = {
  id: string
  kind: string
  outgoingClipId: string
  incomingClipId: string
  duration: MediaTime
  params: Record<string, number | string | boolean>
}

export type Track = {
  id: string
  kind: TrackKind
  name: string
  index: number
  muted: boolean
  locked: boolean
  solo: boolean
  clips: Clip[]
  transitions: Transition[]
}

export type CaptionPositionPreset = 'bottom-center' | 'bottom-left' | 'bottom-right' | 'center' | 'top-center' | 'custom'
export type TextAlignment = 'left' | 'center' | 'right'

export type CaptionCue = {
  id: string
  start: MediaTime
  end: MediaTime
  text: string
  speaker: string | null
  words: Array<{ text: string; start: MediaTime; end: MediaTime }>
  positionPreset?: CaptionPositionPreset
  x?: number
  y?: number
  alignment?: TextAlignment
  fontFamily?: string
  fontSize?: number
  fontWeight?: number
  fontStyle?: 'normal' | 'italic'
  color?: string
  background?: string | null
  backgroundOpacity?: number
  outlineColor?: string
  outlineWidth?: number
  shadow?: boolean
  lineSpacing?: number
  maxWidth?: number
  safeAreaLock?: boolean
}

export type CaptionTrack = {
  id: string
  name: string
  language: string
  cues: CaptionCue[]
  themeId: string | null
  position: 'bottom' | 'top' | 'center'
  fontFamily: string
  fontSize: number
  animationStyle: string
  alignment?: TextAlignment
  fontWeight?: number
  color?: string
  background?: string | null
  backgroundOpacity?: number
  outlineColor?: string
  outlineWidth?: number
  shadow?: boolean
  lineSpacing?: number
  maxWidth?: number
  safeAreaLock?: boolean
}

export type Marker = {
  id: string
  time: MediaTime
  duration: MediaTime
  label: string
  color: string
  kind: 'generic' | 'beat' | 'chapter' | 'ai'
}

export type OverlaySpec = {
  id: string
  kind: 'logo' | 'title' | 'graphic'
  titleKind?: 'title' | 'lower-third'
  assetId: string | null
  text: string | null
  secondaryText?: string | null
  start: MediaTime
  duration: MediaTime
  x: number
  y: number
  scale: number
  rotation?: number
  opacity: number
  alignment?: TextAlignment
  fontFamily?: string
  fontSize?: number
  fontWeight?: number
  color?: string
  background?: string | null
  backgroundOpacity?: number
  outlineColor?: string
  outlineWidth?: number
  shadow?: boolean
  lineSpacing?: number
  maxWidth?: number
  positionPreset?: CaptionPositionPreset
  stylePreset?: string | null
  safeAreaLock?: boolean
  provenance?: {
    preset?: string | null
    createdBy?: string
    createdAt?: string
  }
}

/**
 * FACE LOCK boundary (shot-local, not identity):
 * TrackSubject follows one selected real person inside one continuous clip.
 * It is not biometric identification, not cross-scene identity, not cross-video
 * identity, not multi-person re-identification, and not general face recognition.
 */
export type TrackSubject = {
  id: string
  clipId: string
  assetId: string
  label: string
  kind: 'person' | 'face' | 'body' | 'object'
  status: 'tracking' | 'lost' | 'reacquired' | 'corrected'
  confidence: number
  keyframes: Array<{
    time: MediaTime
    x: number
    y: number
    width: number
    height: number
    confidence: number
  }>
  humanCorrected: boolean
}

export type VirtualCamera = {
  id: string
  name: string
  sourceAspect: OutputAspect
  outputAspect: OutputAspect
  mode:
    | 'CENTER_LOCK'
    | 'RULE_OF_THIRDS'
    | 'FACE_LOCK'
    | 'UPPER_BODY'
    | 'FULL_BODY'
    | 'DYNAMIC_FOLLOW'
    | 'CINEMATIC_FOLLOW'
  subjectId: string | null
  outputWidth: number
  outputHeight: number
  keyframes: Array<{
    time: MediaTime
    crop: Crop
    transform: Transform
  }>
}

export type CameraSpec = {
  id: string
  name: string
  shotSize: 'ECU' | 'CU' | 'MCU' | 'MS' | 'MLS' | 'WS' | 'EWS' | 'custom'
  angle: 'eye' | 'high' | 'low' | 'dutch' | 'overhead'
  movement: 'static' | 'pan' | 'tilt' | 'dolly' | 'orbit' | 'handheld' | 'follow'
  framing: string
  subjectTargetId: string | null
  lensIntent: string
  depthOfField: 'shallow' | 'medium' | 'deep'
  trackingBehavior: string | null
  trajectory: string | null
  /** Provider-neutral cinema extensions. Optional; never vendor magic strings. */
  cameraId?: string
  position?: { x: number; y: number; z: number }
  rotation?: { x: number; y: number; z: number }
  target?: { x: number; y: number; z: number }
  focalLengthMm?: number
  sensorWidthMm?: number
  sensorHeightMm?: number
  aperture?: number
  focusDistance?: number
  shutterAngle?: number
  isoIntent?: string
  aspect?: string
  movementType?: string
  movementPathId?: string
  framingMode?: string
  lookAtTargetId?: string
  stabilizationStyle?: string
  lensEffects?: string
  cinemaShotSize?: string
  cinemaAngle?: string
  cinemaMovement?: string
  relativePlacement?: string
  honesty?: 'GEOMETRIC' | 'PROMPT_APPROXIMATION' | 'REFERENCE_DRIVEN'
}

export type MulticamGroup = {
  id: string
  name: string
  cameraAssetIds: string[]
  syncOffset: MediaTime[]
}

export type ThemeSpec = {
  id: string
  version: string
  name: string
  typography: {
    titleFamily: string
    bodyFamily: string
    captionFamily: string
    titleSize: number
    captionSize: number
    letterSpacing: string
    color: string
  }
  captionStyle: {
    fill: string
    stroke: string
    background: string
    position: 'bottom' | 'top' | 'center'
    animation: string
  }
  color: ColorGrade & { palette: string[] }
  transitions: { defaultKind: string; defaultDuration: MediaTime }
  effects: string[]
  pacingHints: { cutDensity: 'slow' | 'medium' | 'fast'; holdMin: MediaTime }
  musicBehavior: { duckDb: number; introPad: MediaTime; outroPad: MediaTime }
  logoPlacement: { x: number; y: number; scale: number; endCard: boolean }
  overlays: string[]
  motionGraphics: string[]
  cameraBehavior: { preferredFollow: VirtualCamera['mode'] }
}

export type Timeline = {
  id: string
  name: string
  timescale: number
  frameRate: Rational
  sampleRate: number
  width: number
  height: number
  aspect: OutputAspect
  tracks: Track[]
  captionTracks: CaptionTrack[]
  markers: Marker[]
  overlays: OverlaySpec[]
  themeId: string | null
  subjects: TrackSubject[]
  virtualCameras: VirtualCamera[]
  cameraSpecs: CameraSpec[]
  multicam: MulticamGroup[]
}

export type ProjectVersion = {
  id: string
  projectId: string
  index: number
  label: string
  createdAt: string
  createdBy: 'human' | 'ai-director' | 'system'
  parentVersionId: string | null
  snapshotPath: string
  aspect?: OutputAspect
  role?: 'master' | 'derived'
  derivedFromVersionId?: string | null
  description?: string
  durationSec?: number
  clipCount?: number
  thumbnailPath?: string | null
  restoredFromVersionId?: string | null
}

export type EditTransaction = {
  id: string
  projectId: string
  versionId: string
  createdAt: string
  actor: 'human' | 'ai-director' | 'system'
  label: string
  commandIds: string[]
  committed: boolean
  previewOnly: boolean
}

export type RenderTarget = {
  aspect: OutputAspect
  width: number
  height: number
  format: 'mp4'
  videoCodec: 'h264'
  audioCodec: 'aac'
}

export type RenderLaneProvenance = {
  backend: 'ffmpeg-unified'
  effectGraphIds: string[]
  colorPipelineNodeIds: string[]
  audioGraphChannelIds: string[]
  audioGraphBusIds: string[]
  structuralHash: string
  cacheKey: string
  cacheHit: boolean
  planCompileMs: number | null
  vfxActive: boolean
  colorActive: boolean
  audioActive: boolean
}

export type RenderJob = {
  id: string
  projectId: string
  versionId: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'blocked' | 'cancelled'
  target: RenderTarget
  outputPath: string | null
  outputAssetId: string | null
  encoder: 'h264_nvenc' | 'libx264' | null
  probe: {
    width: number | null
    height: number | null
    durationSec: number | null
    hasVideo: boolean
    hasAudio: boolean
  } | null
  error: string | null
  createdAt: string
  updatedAt: string
  blockedReason: string | null
  startedAt?: string | null
  completedAt?: string | null
  cancelRequested?: boolean
  laneProvenance?: RenderLaneProvenance | null
}

export type ProviderJob = {
  id: string
  projectId: string
  category:
    | 'VIDEO_GENERATOR'
    | 'IMAGE_GENERATOR'
    | 'IMAGE_EDITOR'
    | 'TTS'
    | 'VOICE'
    | 'MUSIC'
    | 'SFX'
    | 'LIP_SYNC'
    | 'UPSCALE'
    | 'INTERPOLATION'
    | 'TRANSCRIPTION'
    | 'TRANSLATION'
  providerId: string | null
  status: 'queued' | 'running' | 'completed' | 'failed' | 'blocked' | 'cancelled' | 'blocked_pending_approval'
  request: Record<string, unknown>
  assetId: string | null
  error: string | null
  createdAt: string
  updatedAt: string
}

export type ScriptDocument = {
  id: string
  title: string
  body: string
  updatedAt: string
}

export type StoryboardFrame = {
  id: string
  index: number
  title: string
  description: string
  assetId: string | null
  duration: MediaTime
  castRoleIds?: string[]
  backgroundPopulationId?: string | null
  performanceIntentId?: string | null
  wardrobeSetId?: string | null
  poseId?: string | null
  gazePlanId?: string | null
  shotId?: string | null
}

export type CharacterRecord = {
  id: string
  name: string
  role: string
  notes: string
  referenceAssetIds: string[]
  identityMorphing: 'off' | 'authorized'
}

export type HvsProject = {
  format: 'hvsproj'
  formatVersion: typeof HVSPROJ_VERSION
  kernelSchemaVersion?: typeof HVS_KERNEL_SCHEMA_VERSION | number
  id: string
  name: string
  productionMode: ProductionMode
  createdAt: string
  updatedAt: string
  currentVersionId: string
  versions: ProjectVersion[]
  sequences?: HvsSequence[]
  assets: AssetRecord[]
  timeline: Timeline
  scripts: ScriptDocument[]
  storyboard: StoryboardFrame[]
  characters: CharacterRecord[]
  renderJobs: RenderJob[]
  providerJobs: ProviderJob[]
  effectGraphs: HvsEffectGraph[]
  colorPipeline: ColorPipeline
  audioGraph: AudioGraph
  transactions: EditTransaction[]
  undoStack: string[]
  redoStack: string[]
  beautyIdentityMorphing: 'off' | 'authorized'
  starrdom: boolean
  notes: string
  /** Optional nested 3D Director store. Does not replace timeline truth or HVSPROJ_VERSION. */
  director3d?: HvsDirector3DStore
  /** Cinema Director shot/camera plan. Canonical camera language; 3D scene is previs execution. */
  cinemaDirector?: HvsCinemaDirectorStore
  /** Director orchestration plans. Compiles into director3d; does not replace 3D scene truth. */
  directorOrchestration?: HvsDirectorOrchestrationStore
  /** Optional destruction previs records. Cache bytes stay outside this document. */
  destruction?: HvsDestructionStore
  /** Digital humans, cast, crowd, and performance capture. Raw media stays in AssetRecord. */
  digitalHumans?: HvsDigitalHumanStore
  /** Lightweight Unreal execution binding. Scene packages stay under media-command/unreal. */
  unrealExecution?: HvsUnrealTruthBinding
}

export function defaultTimeline(aspect: OutputAspect = '16:9'): Timeline {
  const timescale = DEFAULT_TIMESCALE
  const dims = aspect === '9:16' ? { width: 1080, height: 1920 } : aspect === '1:1' ? { width: 1080, height: 1080 } : { width: 1920, height: 1080 }
  return {
    id: 'timeline-main',
    name: 'Program',
    timescale,
    frameRate: { n: 24, d: 1 },
    sampleRate: 48000,
    width: dims.width,
    height: dims.height,
    aspect,
    tracks: [
      { id: 'V1', kind: 'video', name: 'V1', index: 0, muted: false, locked: false, solo: false, clips: [], transitions: [] },
      { id: 'V2', kind: 'video', name: 'V2 Graphics', index: 1, muted: false, locked: false, solo: false, clips: [], transitions: [] },
      { id: 'A1', kind: 'audio', name: 'A1 Dialogue', index: 2, muted: false, locked: false, solo: false, clips: [], transitions: [] },
      { id: 'A2', kind: 'audio', name: 'A2 Music', index: 3, muted: false, locked: false, solo: false, clips: [], transitions: [] },
      { id: 'G1', kind: 'graphics', name: 'G1 Overlays', index: 4, muted: false, locked: false, solo: false, clips: [], transitions: [] },
    ],
    captionTracks: [
      {
        id: 'C1',
        name: 'Captions',
        language: 'en',
        cues: [],
        themeId: null,
        position: 'bottom',
        fontFamily: 'Cinzel, "Times New Roman", serif',
        fontSize: 42,
        animationStyle: 'fade',
        alignment: 'center',
        fontWeight: 400,
        color: '#F6E7C1',
        background: 'rgba(8,4,0,0.35)',
        backgroundOpacity: 0.35,
        outlineColor: '#140C04',
        outlineWidth: 2,
        shadow: true,
        lineSpacing: 1.15,
        maxWidth: 0.8,
        safeAreaLock: false,
      },
    ],
    markers: [],
    overlays: [],
    themeId: null,
    subjects: [],
    virtualCameras: [],
    cameraSpecs: [],
    multicam: [],
  }
}

export function emptyProject(input: {
  id: string
  name: string
  productionMode?: ProductionMode
  now?: string
  starrdom?: boolean
}): HvsProject {
  const now = input.now ?? new Date().toISOString()
  const versionId = `ver-${input.id}-1`
  return {
    format: 'hvsproj',
    formatVersion: HVSPROJ_VERSION,
    kernelSchemaVersion: HVS_KERNEL_SCHEMA_VERSION,
    id: input.id,
    name: input.name,
    productionMode: input.productionMode ?? 'CUSTOM',
    createdAt: now,
    updatedAt: now,
    currentVersionId: versionId,
    versions: [
      {
        id: versionId,
        projectId: input.id,
        index: 1,
        label: 'Version 1 — original human timeline',
        createdAt: now,
        createdBy: 'human',
        parentVersionId: null,
        snapshotPath: '',
        aspect: '16:9',
        role: 'master',
        derivedFromVersionId: null,
      },
    ],
    sequences: [{ id: 'seq-main', name: 'Sequence 1', timelineId: 'timeline-main' }],
    assets: [],
    timeline: defaultTimeline('16:9'),
    scripts: [],
    storyboard: [],
    characters: [],
    renderJobs: [],
    providerJobs: [],
    effectGraphs: [],
    colorPipeline: { schemaVersion: 1, nodes: [], outputColorSpace: 'unspecified' },
    audioGraph: {
      schemaVersion: 1,
      channels: [],
      buses: [{ id: 'bus-master', kind: 'master', inputs: [], volume: 1, pan: 0, mute: false, solo: false, inserts: [] }],
      automation: [],
    },
    transactions: [],
    undoStack: [],
    redoStack: [],
    beautyIdentityMorphing: 'off',
    starrdom: Boolean(input.starrdom),
    notes: '',
    director3d: emptyDirector3DStore(),
    cinemaDirector: emptyCinemaDirectorStore(),
    directorOrchestration: emptyDirectorOrchestrationStore(),
    destruction: emptyDestructionStore(),
    digitalHumans: emptyDigitalHumanStore(),
  }
}

export function timelineDuration(timeline: Timeline): MediaTime {
  let max = 0
  const ts = timeline.timescale || DEFAULT_TIMESCALE
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      const end = clip.start.ticks + clip.duration.ticks
      if (end > max) max = end
    }
  }
  for (const overlay of timeline.overlays) {
    const end = overlay.start.ticks + overlay.duration.ticks
    if (end > max) max = end
  }
  for (const cap of timeline.captionTracks) {
    for (const cue of cap.cues) {
      if (cue.end.ticks > max) max = cue.end.ticks
    }
  }
  return max > 0 ? { ticks: max, timescale: ts } : zeroTime(ts)
}

export function findClip(project: HvsProject, clipId: string): { track: Track; clip: Clip } | null {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find(c => c.id === clipId)
    if (clip) return { track, clip }
  }
  return null
}

export function findAsset(project: HvsProject, assetId: string): AssetRecord | null {
  return project.assets.find(a => a.id === assetId) ?? null
}

export function cloneProject(project: HvsProject): HvsProject {
  return JSON.parse(JSON.stringify(project)) as HvsProject
}
