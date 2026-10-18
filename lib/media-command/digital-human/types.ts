/**
 * HVS digital-human / actor foundation.
 * HvsDigitalHuman is character truth. Provider ids, rigs, and 3D nodes point back here.
 * Fictional consistency and real-person identity stay separate.
 */
import type { MediaTime } from '../time'

export const HVS_DIGITAL_HUMAN_SLICE = 'HVS-DIGITAL-HUMAN-FOUNDATION'
export const HVS_DIGITAL_HUMAN_SCHEMA = 1 as const
export const PERFORMANCE_CAPTURE_MODEL_APPROVAL_REQUIRED = 'PERFORMANCE_CAPTURE_MODEL_APPROVAL_REQUIRED' as const
export const RAEL_CHARACTER_ID = 'rael-commander'
export const MATRIX_EXTENSION_REQUIRED = 'MATRIX_EXTENSION_REQUIRED' as const
export const HVS_HUMANOID_RIG_V1 = 'HVS_HUMANOID_RIG_V1' as const
export const HVS_HUMANOID = 'HVS_HUMANOID' as const
export const HVS_HUMANOID_RIG_ID = 'hvs-humanoid-rig-v1' as const
export const HVS_NEUTRAL_HUMANOID = 'HVS_NEUTRAL_HUMANOID' as const
export const HVS_PRODUCTION_BODY_PREVIEW = 'PRODUCTION BODY PREVIEW' as const
export const HVS_PREVIEW_WARDROBE_NOTE = 'PREVIEW WARDROBE REPRESENTATION' as const

export const HVS_HUMAN_CHARACTER_CLASSES = [
  'COMMANDER_DIGITAL_HUMAN',
  'FICTIONAL_HERO',
  'AUTHORIZED_REAL_PERSON',
  'BACKGROUND_SYNTHETIC',
  'BACKGROUND_AUTHORIZED_REAL_PERSON',
  'PLACEHOLDER',
] as const
export type HvsHumanCharacterClass = (typeof HVS_HUMAN_CHARACTER_CLASSES)[number]

export const HVS_IDENTITY_CLASSES = ['FICTIONAL', 'AUTHORIZED_REAL_PERSON', 'COMMANDER'] as const
export type HvsIdentityClass = (typeof HVS_IDENTITY_CLASSES)[number]

export type HvsVec3 = { x: number; y: number; z: number }

export type HvsConsentState =
  | 'COMMANDER_SELF_AUTHORIZED'
  | 'EXPLICIT_AUTHORITY_REQUIRED'
  | 'AUTHORIZED'
  | 'NOT_APPLICABLE_FICTIONAL'
  | 'NOT_ENROLLED'

export type HvsAuthorityActor = 'commander' | 'director'

export type HvsIdentityAuthorityAction =
  | 'NEW_IDENTITY_REFERENCE'
  | 'VOICE_ENROLLMENT'
  | 'BODY_REFERENCE_ENROLLMENT'
  | 'FACE_REFERENCE_ENROLLMENT'
  | 'MAJOR_APPEARANCE_CHANGE'
  | 'IDENTITY_REPLACEMENT'
  | 'PROVIDER_IDENTITY_TRAINING'
  | 'VOICE_CLONING'
  | 'EXPORT_IDENTITY_TRAINING_PACK'

export type HvsAppearanceProfile = {
  apparentAgeRange: string | null
  skinToneDescriptor: string | null
  faceShape: string | null
  hairStyle: string | null
  hairColor: string | null
  facialHair: string | null
  eyeColor: string | null
  heightClass: string | null
  buildClass: string | null
  distinctiveFeatures: string[]
  styleNotes: string[]
  suppliedByCommander: boolean
}

export type HvsBodyProfile = {
  heightMeters: number | null
  bodyScale: number
  shoulderWidthClass: string | null
  torsoClass: string | null
  limbProportionClass: string | null
  stance: string | null
  posture: string | null
  movementStyle: string | null
  suppliedMeasurements: boolean
}

export type HvsWardrobeSet = {
  id: string
  name: string
  garmentRefs: string[]
  footwearRefs: string[]
  accessoryRefs: string[]
  colorIntent: string | null
  styleIntent: string | null
  continuityLocked: boolean
}

export type HvsPerformanceQuality =
  | 'CALM'
  | 'AUTHORITATIVE'
  | 'CONFIDENT'
  | 'RESERVED'
  | 'ENERGETIC'
  | 'SERIOUS'
  | 'HUMOROUS'

export type HvsPerformanceProfile = {
  energy: HvsPerformanceQuality
  speechTempo: 'SLOW' | 'MEASURED' | 'BRISK'
  gestureFrequency: 'LOW' | 'MEDIUM' | 'HIGH'
  gestureAmplitude: 'SMALL' | 'MEDIUM' | 'LARGE'
  postureStyle: string
  gazeStyle: string
  headMovementStyle: string
  walkingStyle: string
  expressionBaseline: string
  emotionalRange: string[]
  notes: string
}

export type HvsVoiceClass = 'FICTIONAL_SYNTHETIC' | 'COMMANDER_AUTHORIZED' | 'AUTHORIZED_REAL_PERSON'

export type HvsVoiceBinding = {
  providerNeutralId: string
  voiceClass: HvsVoiceClass
  providerBindings: HvsCharacterProviderBinding[]
  localModelRef: string | null
  consentState: HvsConsentState
  enrolled: boolean
}

export type HvsCharacterProviderBinding = {
  id: string
  provider: string
  providerCharacterId: string
  model: string | null
  referenceSetVersion: string
  createdAt: string
  rightsStatus: 'UNSET' | 'AUTHORIZED' | 'REFUSED'
}

export type HvsRigBinding = {
  state: 'NO_RIG' | 'BOUND'
  modelRef: string | null
  skeletonRef: string | null
  faceRigRef: string | null
  blendshapeMap: Record<string, string>
  motionRetargetProfile: string | null
  sceneNodeId: string | null
  bodyProportionSource?: typeof HVS_NEUTRAL_HUMANOID
  wardrobePreviewNote?: typeof HVS_PREVIEW_WARDROBE_NOTE
}

export type HvsRepresentationKind =
  | 'REFERENCE_IMAGES'
  | 'REFERENCE_VIDEO'
  | '3D_MODEL'
  | 'RIG'
  | 'VOICE'
  | 'PROVIDER_CHARACTER_ID'
  | 'PERFORMANCE_CAPTURE'

export type HvsCharacterRepresentation = {
  id: string
  kind: HvsRepresentationKind
  assetId: string | null
  note: string
}

export type HvsIdentityLock = {
  characterId: string
  faceLocked: boolean
  bodyLocked: boolean
  voiceLocked: boolean
  hairLocked: boolean
  wardrobeLocked: boolean
  providerConsistencyRequired: boolean
}

export type HvsCharacterContinuityState = {
  appearanceRevision: number
  wardrobeSetId: string | null
  hairNote: string | null
  bodyState: string
  injuries: string[]
  propsHeld: string[]
  position: HvsVec3 | null
  orientationYaw: number | null
  emotion: string | null
  sceneState: string
}

export type HvsCharacterBibleSection =
  | 'identity'
  | 'appearance'
  | 'body'
  | 'hair'
  | 'wardrobe'
  | 'voice'
  | 'mannerisms'
  | 'posture'
  | 'gait'
  | 'gestureTendencies'
  | 'expressionTendencies'
  | 'speakingStyle'
  | 'continuityNotes'
  | 'allowedVariations'
  | 'lockedTraits'

export type HvsCharacterBible = {
  id: string
  characterId: string
  version: number
  sections: Record<HvsCharacterBibleSection, string>
  createdAt: string
  updatedAt: string
}

export type HvsDigitalHuman = {
  id: string
  projectScope: string | null
  globalCharacterId: string | null
  name: string
  displayName: string
  characterClass: HvsHumanCharacterClass
  identityClass: HvsIdentityClass
  appearanceProfile: HvsAppearanceProfile
  bodyProfile: HvsBodyProfile
  faceProfile: { notes: string[]; referenceAssetIds: string[] }
  hairProfile: { style: string | null; color: string | null; locked: boolean }
  wardrobeSets: HvsWardrobeSet[]
  activeWardrobeSetId: string | null
  performanceProfile: HvsPerformanceProfile
  voiceBinding: HvsVoiceBinding | null
  rigBinding: HvsRigBinding
  generatorBindings: HvsCharacterProviderBinding[]
  representations: HvsCharacterRepresentation[]
  referenceAssetIds: string[]
  referenceSetVersion: string
  continuityState: HvsCharacterContinuityState
  identityLock: HvsIdentityLock
  consentState: HvsConsentState
  authorityState: 'COMMANDER_ONLY' | 'CREATIVE_DIRECTION_ALLOWED' | 'FICTIONAL'
  persistence: 'PERSISTENT' | 'NON_PERSISTENT_SYNTHETIC'
  lodDefault: 'HIGH' | 'MEDIUM' | 'LOW'
  createdAt: string
  updatedAt: string
}

export type HvsFacialExpression =
  | 'NEUTRAL'
  | 'HAPPY'
  | 'SAD'
  | 'ANGRY'
  | 'NERVOUS'
  | 'SURPRISED'
  | 'CONFIDENT'
  | 'CONCERNED'
  | 'TIRED'
  | 'WORRIED'
  | 'SERIOUS'

export type HvsActingIntent = {
  id: string
  characterId: string
  shotId: string | null
  beatId: string | null
  objective: string
  emotion: HvsFacialExpression | null
  intensity: number
  bodyAction: string | null
  gestureIntent: string | null
  headIntent: string | null
  gazeIntent: string | null
  facialIntent: string | null
  speechIntent: string | null
  start: MediaTime
  end: MediaTime
}

export type HvsGazeTargetKind = 'CHARACTER' | 'PROP' | 'CAMERA' | 'WORLD_POINT'
export type HvsGazeBehavior = 'LOOK_AT' | 'GLANCE_AT' | 'LOOK_AWAY' | 'FOLLOW' | 'RETURN_TO_CAMERA'

export type HvsGazePlan = {
  id: string
  characterId: string
  shotId: string | null
  actingIntentId: string | null
  targetKind: HvsGazeTargetKind
  targetId: string | null
  targetLabel: string
  behavior: HvsGazeBehavior
  start: MediaTime
  duration: MediaTime
  easing: 'LINEAR' | 'EASE_IN_OUT'
}

export type HvsHeadMotionKind =
  | 'TURN_LEFT'
  | 'TURN_RIGHT'
  | 'NOD'
  | 'SHAKE'
  | 'TILT'
  | 'LOWER'
  | 'RAISE'
  | 'FOLLOW_TARGET'

export type HvsHeadMotionIntent = {
  id: string
  characterId: string
  kind: HvsHeadMotionKind
  intensity: number
  start: MediaTime
  duration: MediaTime
}

export type HvsGestureKind =
  | 'POINT'
  | 'OPEN_HAND'
  | 'CROSS_ARMS'
  | 'HAND_TO_CHEST'
  | 'WAVE'
  | 'SHRUG'
  | 'REACH'
  | 'PICK_UP'
  | 'PLACE'
  | 'CUSTOM_REFERENCE'

export type HvsGestureIntent = {
  id: string
  characterId: string
  kind: HvsGestureKind
  intensity: number
  start: MediaTime
  duration: MediaTime
  note: string | null
}

export type HvsBodyPoseKind =
  | 'STANDING'
  | 'SITTING'
  | 'WALKING'
  | 'RUNNING'
  | 'LEANING'
  | 'CROUCHING'
  | 'REACHING'
  | 'TURNING'

export type HvsBodyPose = {
  id: string
  characterId: string
  kind: HvsBodyPoseKind
  start: MediaTime
  end: MediaTime
  note: string | null
}

export type HvsMark = {
  id: string
  code: 'MARK_A' | 'MARK_B' | 'MARK_C' | 'CUSTOM'
  name: string
  position: HvsVec3
}

export type HvsBlockingPlan = {
  id: string
  characterId: string
  startTransform: { position: HvsVec3; yaw: number }
  endTransform: { position: HvsVec3; yaw: number } | null
  motionPathId: string | null
  marks: HvsMark[]
  actions: string[]
  shotIds: string[]
}

export type HvsDialoguePerformance = {
  id: string
  characterId: string
  text: string
  voiceBindingId: string | null
  emotion: HvsFacialExpression | null
  intensity: number
  speechRate: number
  pausePlan: Array<{ afterWordIndex: number; seconds: number }>
  emphasis: string[]
  gestureLinks: string[]
  gazeLinks: string[]
}

export type HvsLipSyncPlan = {
  id: string
  characterId: string
  audioAssetId: string | null
  transcriptRef: string | null
  phonemeTrack: null
  timing: { start: MediaTime; end: MediaTime }
  emotionRef: string | null
  backendPreference: null
  modelInstalled: false
}

export type HvsCaptureMode =
  | 'BODY_REFERENCE'
  | 'FACE_REFERENCE'
  | 'HEAD_REFERENCE'
  | 'GESTURE_REFERENCE'
  | 'EYELINE_REFERENCE'
  | 'DIALOGUE_PERFORMANCE'
  | 'DIRECTOR_BLOCKING'

export type HvsCaptureDeviceStatus = 'AVAILABLE' | 'PREVIEW' | 'CAPTURING' | 'CLOSED' | 'UNAVAILABLE'

export type HvsCaptureDevice = {
  id: string
  label: string
  type: 'VIDEO_CAPTURE' | 'VIDEO_METADATA' | 'AUDIO'
  node: string
  capabilities: string[]
  resolutionModes: Array<{ width: number; height: number; pixelFormat: string }>
  fpsModes: number[]
  audioAvailable: boolean
  status: HvsCaptureDeviceStatus
  latencyMs: number | null
}

export type HvsCaptureSessionStatus = 'ARMED' | 'ACTIVE' | 'STOPPED' | 'INTERRUPTED'

export type HvsPerformanceCaptureSession = {
  id: string
  characterId: string | null
  mode: HvsCaptureMode
  sourceDeviceId: string | null
  startTime: string | null
  endTime: string | null
  status: HvsCaptureSessionStatus
  rawCaptureRef: string | null
  derivedMotionRef: string | null
  consentState: HvsConsentState
  deviceReleased: boolean
  explicitStart: true
}

export type HvsMotionJoint = {
  jointName: string
  position: HvsVec3
  confidence: number
}

export type HvsMotionExtractionStatus = 'EXTRACTED' | typeof PERFORMANCE_CAPTURE_MODEL_APPROVAL_REQUIRED | 'NOT_RUN'

export type HvsPerformanceMotion = {
  id: string
  duration: MediaTime
  frameRate: { n: number; d: number }
  bodyFrames: Array<{ time: MediaTime; joints: HvsMotionJoint[] }>
  faceFrames: Array<{ time: MediaTime; signals: HvsFacialPerformance }>
  headFrames: Array<{ time: MediaTime; yaw: number; pitch: number; roll: number }>
  gazeFrames: Array<{ time: MediaTime; yaw: number; pitch: number }>
  gestureEvents: HvsGestureIntent[]
  extractionStatus: HvsMotionExtractionStatus
  landmarkFrames?: HvsLandmarkFrame[]
  confidence?: HvsMotionConfidence
  failure?: HvsCaptureFailure | null
  gazeSource?: HvsGazeSource
  evidence: {
    frameCount: number
    frameBytes: number[]
    firstFrameMs: number | null
    interFrameMs: number[]
    captureFps?: number | null
    inferenceFps?: number | null
    inferenceLatencyMs?: number | null
    droppedFrames?: number
    processRssBytes?: number | null
    rawBytes?: number
    landmarkBytes?: number
    motionBytes?: number
    previewBytes?: number
    inferenceRan?: boolean
    landmarkPath?: string
    modelBytes?: number
    modelSha256?: string
    meanInferenceMs?: number | null
    medianInferenceMs?: number | null
    p95InferenceMs?: number | null
    cpuUserSeconds?: number | null
    delegate?: string
    frameTrackingCoverage?: number
    fullBodyCoverage?: number
    jointCoverage?: Record<string, number>
    standingReadiness?: HvsStandingReadinessLevel | null
  } | null
}

export type HvsFacialPerformance = {
  brow: number
  eyes: number
  blink: number
  mouthOpenness: number
  smile: number
  frown: number
  jaw: number
  headPose: { yaw: number; pitch: number; roll: number }
  expression: HvsFacialExpression
  intensity: number
}

export type HvsPerformanceTake = {
  id: string
  captureSessionId: string
  characterId: string | null
  label: string
  duration: MediaTime
  motionRef: string
  audioRef: string | null
  rawAssetId: string | null
  rating: number | null
  selected: boolean
  quality?: HvsPerformanceTakeQuality
  qualityReason?: string
  trackingCoverage?: number
  frameTrackingCoverage?: number
  fullBodyCoverage?: number
  standingReadiness?: HvsStandingReadinessLevel | null
}

export type HvsPerformanceReference = {
  id: string
  takeId: string
  motionRef: string
  rawAssetId: string | null
  characterId: string | null
  shotId: string | null
  actingIntentId: string | null
  semanticModifier?: string | null
}

export type HvsPerformancePatchKind =
  | 'CHANGE_EMOTION'
  | 'CHANGE_INTENSITY'
  | 'CHANGE_GAZE'
  | 'CHANGE_GESTURE'
  | 'CHANGE_POSTURE'
  | 'CHANGE_BLOCKING'
  | 'CHANGE_WARDROBE'
  | 'CHANGE_DIALOGUE_DELIVERY'
  | 'CHANGE_MOTION_REFERENCE'
  | 'CHANGE_SPEED'
  | 'TRIM'
  | 'MIRROR'
  | 'CHANGE_HEAD_MOTION'
  | 'CHANGE_ROOT_MOTION'
  | 'REASSIGN_TAKE'

export type HvsPerformancePatch = {
  id: string
  characterId: string
  kind: HvsPerformancePatchKind
  summary: string
  status: 'proposed' | 'applied' | 'rejected'
  createdAt: string
}

export type HvsCastRoleType = 'LEAD' | 'SUPPORTING' | 'BACKGROUND' | 'PRESENTER' | 'STUNT' | 'STAND_IN'

export type HvsCastRole = {
  id: string
  roleName: string
  characterId: string
  roleType: HvsCastRoleType
}

export type HvsCast = {
  id: string
  productionId: string
  roles: HvsCastRole[]
}

export type HvsCharacterCreationIntent = {
  id: string
  role: string
  ageIntent: string | null
  appearanceIntent: string | null
  wardrobeIntent: string | null
  personalityIntent: string | null
  voiceIntent: string | null
  performanceIntent: string | null
  generatesMedia: false
}

export type HvsCrowdBehavior =
  | 'IDLE'
  | 'WALK'
  | 'WAIT'
  | 'TALK_GROUP'
  | 'LOOK_AROUND'
  | 'QUEUE'
  | 'CROSS_STREET'
  | 'REACT'
  | 'FLEE'
  | 'WATCH'

export type HvsCrowdVariation = {
  height: 'LOW' | 'MEDIUM' | 'HIGH'
  bodySilhouette: 'LOW' | 'MEDIUM' | 'HIGH'
  wardrobe: 'LOW' | 'MEDIUM' | 'HIGH'
  hair: 'LOW' | 'MEDIUM' | 'HIGH'
  walkingSpeed: 'LOW' | 'MEDIUM' | 'HIGH'
  idleAction: 'LOW' | 'MEDIUM' | 'HIGH'
  direction: 'LOW' | 'MEDIUM' | 'HIGH'
  grouping: 'LOW' | 'MEDIUM' | 'HIGH'
}

export type HvsCrowdLod = 'HIGH' | 'MEDIUM' | 'LOW'

export type HvsBackgroundActorInstance = {
  id: string
  populationId: string
  persistent: false
  identity: 'NON_PERSISTENT_SYNTHETIC'
  lod: HvsCrowdLod
  behavior: HvsCrowdBehavior
  group: string
}

export type HvsCrowdReactionEvent = {
  id: string
  populationId: string
  trigger: 'MAJOR_COLLAPSE'
  triggerTime: MediaTime
  behavior: 'FLEE' | 'REACT'
  affected: 'CLOSEST' | 'ALL'
  avoidDestruction: true
}

export type HvsCrowdPathPlan = {
  id: string
  populationId: string
  waypoints: HvsVec3[]
  avoid: Array<{ id: string; kind: 'WALL' | 'CAR' | 'PROTECTED' | 'DESTRUCTION'; min: HvsVec3; max: HvsVec3 }>
  honesty: 'SIMPLE_NAV'
}

export type HvsBackgroundPopulation = {
  id: string
  count: number
  populationProfile: string
  wardrobeVariation: HvsCrowdVariation['wardrobe']
  motionBehavior: HvsCrowdBehavior
  reactionBehavior: HvsCrowdBehavior | null
  density: number
  spawnRegion: { id: string; min: HvsVec3; max: HvsVec3 }
  avoidRegions: Array<{ id: string; min: HvsVec3; max: HvsVec3 }>
  seed: number
  variation: HvsCrowdVariation
  groups: Array<{ name: string; count: number; behavior: HvsCrowdBehavior; lod: HvsCrowdLod }>
  instances: HvsBackgroundActorInstance[]
  reaction: HvsCrowdReactionEvent | null
  path: HvsCrowdPathPlan | null
  persistentFaces: false
}

export type HvsCharacterContinuityWarning = {
  id: string
  code:
    | 'FACE_REFERENCE_DRIFT'
    | 'WARDROBE_DRIFT'
    | 'BODY_SCALE_DRIFT'
    | 'VOICE_BINDING_DRIFT'
    | 'HAIR_DRIFT'
    | 'DUPLICATE_CHARACTER'
    | 'PROVIDER_IDENTITY_MISMATCH'
    | 'MISSING_CONSENT'
    | 'MISSING_AUTHORITY'
    | 'MISSING_PERFORMANCE_TARGET'
    | 'CROWD_DUPLICATION'
    | 'HERO_TREATED_AS_BACKGROUND'
  characterId: string | null
  message: string
}

export type HvsHumanGenerationBlueprint = {
  id: string
  characterId: string
  referenceAssetIds: string[]
  wardrobeSetId: string | null
  poseId: string | null
  performanceReferenceId: string | null
  shotId: string | null
  lighting: string | null
  voiceRef: string | null
  lipsyncRef: string | null
  continuityConstraints: string[]
  invoked: false
}

export const HVS_CANONICAL_JOINTS = [
  'HEAD',
  'NECK',
  'LEFT_SHOULDER',
  'RIGHT_SHOULDER',
  'LEFT_ELBOW',
  'RIGHT_ELBOW',
  'LEFT_WRIST',
  'RIGHT_WRIST',
  'CHEST',
  'PELVIS',
  'LEFT_HIP',
  'RIGHT_HIP',
  'LEFT_KNEE',
  'RIGHT_KNEE',
  'LEFT_ANKLE',
  'RIGHT_ANKLE',
] as const
export type HvsCanonicalJoint = (typeof HVS_CANONICAL_JOINTS)[number]

export type HvsDepthSource = 'NONE' | 'MONOCULAR_RELATIVE'

export type HvsNormalizedPoint = {
  x: number
  y: number
  confidence: number
  /** Image-relative only. Monocular values are not metric depth. */
  relativeDepth: number | null
  depthSource: HvsDepthSource
}

export type HvsLandmarkPoint = HvsNormalizedPoint & {
  name: string
  canonicalName: HvsCanonicalJoint | string | null
}

export type HvsHeadPerformanceFrame = {
  yaw: number
  pitch: number
  roll: number
  confidence: number
  source: 'MODEL' | 'DERIVED_FROM_LANDMARKS' | 'COARSE_BODY_LANDMARK_HEAD_POSE' | 'NOT_MEASURED'
}

export type HvsGazeSource = 'EYE_LANDMARKS' | 'HEAD_DIRECTION_ONLY' | 'NOT_MEASURED'
export type HvsHandTrackingStatus = 'TRACKED' | 'HAND_TRACKING_NOT_AVAILABLE'

export type HvsLandmarkFrame = {
  time: MediaTime
  frameIndex: number
  bodyLandmarks: HvsLandmarkPoint[]
  faceLandmarks: HvsLandmarkPoint[]
  handLandmarks: HvsLandmarkPoint[]
  headPose: HvsHeadPerformanceFrame | null
  gazeSource: HvsGazeSource
  handStatus: HvsHandTrackingStatus
  confidence: number
  source: string
  modelId: string | null
  personCount: number
}

export type HvsCaptureFailure =
  | 'NO_PERSON_DETECTED'
  | 'LOW_LIGHT'
  | 'TRACKING_LOST'
  | 'MULTIPLE_PEOPLE_DETECTED'
  | 'CAMERA_DISCONNECTED'
  | 'MODEL_NOT_READY'
  | 'PARTIAL_BODY'

export type HvsPerformanceTakeQuality = 'GOOD' | 'USABLE' | 'LOW_CONFIDENCE' | 'TRACKING_LOST'

export type HvsStandingReadinessLevel =
  | 'FULL BODY READY'
  | 'STEP BACK — FEET / ANKLES NOT VISIBLE'
  | 'ADJUST CAMERA — LOWER BODY OUT OF FRAME'
  | 'IMPROVE LIGHTING — TRACKING WEAK'
  | 'CENTER BODY'

export type HvsMotionConfidence = {
  bodyConfidence: number | null
  faceConfidence: number | null
  headConfidence: number | null
  handConfidence: number | null
  /** @deprecated same as frameTrackingCoverage; kept so existing takes still load */
  trackingCoverage: number
  frameTrackingCoverage: number
  fullBodyCoverage: number
}

export type HvsBodyCoverageReport = {
  totalFrames: number
  acceptedPersonFrames: number
  frameTrackingCoverage: number
  fullBodyCoverage: number
  jointCoverage: Record<string, number>
  bothShouldersCoverage: number
  bothElbowsCoverage: number
  bothWristsCoverage: number
  bothHipsCoverage: number
  bothKneesCoverage: number
  bothAnklesCoverage: number
}

export type HvsStandingReadiness = {
  level: HvsStandingReadinessLevel
  warning: string | null
  present: string[]
  missing: string[]
  persistRatio: Record<string, number>
  windowFrames: number
  acceptedFrames: number
}

export type HvsCaptureCalibration = {
  id: string
  characterId: string | null
  shoulderWidthNormalized: number | null
  center: { x: number; y: number } | null
  framing: string | null
  orientationYaw: number | null
  kind: 'NEUTRAL_POSE'
  biometricEnrollment: false
}

export type HvsPerformanceEdit = {
  id: string
  sourceTakeId: string
  sourceMotionRef: string
  derivedMotionRef: string
  trimStart: MediaTime | null
  trimEnd: MediaTime | null
  speed: { n: number; d: number }
  mirror: boolean
  loop: boolean
  mutatesSource: false
}

export type HvsCrowdMotionUse = {
  id: string
  sourceTakeId: string
  rawAssetId: string | null
  populationId: string
  instanceId: string
  timeOffset: MediaTime
  speed: { n: number; d: number }
  mirror: boolean
  phase: number
  seed: number
}

export type HvsPerformanceRetargetSample = {
  time: MediaTime
  root: { x: number; y: number; z: number }
  rootSource: 'RELATIVE_INTENT'
  metricLocomotion: false
  lean: number
  head: { yaw: number; pitch: number; roll: number }
  leftArm: number
  rightArm: number
}

export type HvsSafetyStaging = {
  characterId: string
  protectedRegion: { min: HvsVec3; max: HvsVec3 } | null
  evacuationPathId: string | null
  reactionTiming: MediaTime | null
  note: 'CINEMATIC_STAGING_ONLY'
}

export type HvsDigitalHumanSceneBinding = {
  id: string
  prompt: string
  characterIds: string[]
  populationId: string | null
  actingIntentIds: string[]
  gazePlanIds: string[]
  blockingPlanId: string | null
  shotIds: string[]
  storyboardFrameIds: string[]
  sceneId: string | null
  destructionTrigger: 'MAJOR_COLLAPSE' | null
  destructionTime: MediaTime | null
  sharedTimescale: number
}

export type HvsDigitalHumanStore = {
  schemaVersion: typeof HVS_DIGITAL_HUMAN_SCHEMA
  characters: HvsDigitalHuman[]
  bibles: HvsCharacterBible[]
  casts: HvsCast[]
  creationIntents: HvsCharacterCreationIntent[]
  populations: HvsBackgroundPopulation[]
  actingIntents: HvsActingIntent[]
  gazePlans: HvsGazePlan[]
  headMotions: HvsHeadMotionIntent[]
  gestures: HvsGestureIntent[]
  poses: HvsBodyPose[]
  blockingPlans: HvsBlockingPlan[]
  dialogue: HvsDialoguePerformance[]
  lipsyncPlans: HvsLipSyncPlan[]
  devices: HvsCaptureDevice[]
  captureSessions: HvsPerformanceCaptureSession[]
  motions: HvsPerformanceMotion[]
  takes: HvsPerformanceTake[]
  references: HvsPerformanceReference[]
  patches: HvsPerformancePatch[]
  warnings: HvsCharacterContinuityWarning[]
  blueprints: HvsHumanGenerationBlueprint[]
  staging: HvsSafetyStaging[]
  sceneBindings: HvsDigitalHumanSceneBinding[]
  calibrations: HvsCaptureCalibration[]
  performanceEdits: HvsPerformanceEdit[]
  crowdMotionUses: HvsCrowdMotionUse[]
  activeCharacterId: string | null
}

export function dhId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function emptyAppearance(): HvsAppearanceProfile {
  return {
    apparentAgeRange: null,
    skinToneDescriptor: null,
    faceShape: null,
    hairStyle: null,
    hairColor: null,
    facialHair: null,
    eyeColor: null,
    heightClass: null,
    buildClass: null,
    distinctiveFeatures: [],
    styleNotes: [],
    suppliedByCommander: false,
  }
}

export function emptyBody(): HvsBodyProfile {
  return {
    heightMeters: null,
    bodyScale: 1,
    shoulderWidthClass: null,
    torsoClass: null,
    limbProportionClass: null,
    stance: null,
    posture: null,
    movementStyle: null,
    suppliedMeasurements: false,
  }
}

export function emptyPerformanceProfile(energy: HvsPerformanceQuality = 'CALM'): HvsPerformanceProfile {
  return {
    energy,
    speechTempo: 'MEASURED',
    gestureFrequency: 'LOW',
    gestureAmplitude: 'SMALL',
    postureStyle: 'UPRIGHT',
    gazeStyle: 'STEADY',
    headMovementStyle: 'SUBTLE',
    walkingStyle: 'EVEN',
    expressionBaseline: 'NEUTRAL',
    emotionalRange: ['CALM', 'SERIOUS', 'CONFIDENT'],
    notes: 'Acting is objective, gaze, gesture, and posture. Emotion labels are one layer.',
  }
}

export function emptyRig(): HvsRigBinding {
  return {
    state: 'NO_RIG',
    modelRef: null,
    skeletonRef: null,
    faceRigRef: null,
    blendshapeMap: {},
    motionRetargetProfile: null,
    sceneNodeId: null,
  }
}

export function emptyContinuity(): HvsCharacterContinuityState {
  return {
    appearanceRevision: 1,
    wardrobeSetId: null,
    hairNote: null,
    bodyState: 'UNSTATED',
    injuries: [],
    propsHeld: [],
    position: null,
    orientationYaw: null,
    emotion: null,
    sceneState: 'UNSET',
  }
}

export function emptyDigitalHumanStore(): HvsDigitalHumanStore {
  return {
    schemaVersion: HVS_DIGITAL_HUMAN_SCHEMA,
    characters: [],
    bibles: [],
    casts: [],
    creationIntents: [],
    populations: [],
    actingIntents: [],
    gazePlans: [],
    headMotions: [],
    gestures: [],
    poses: [],
    blockingPlans: [],
    dialogue: [],
    lipsyncPlans: [],
    devices: [],
    captureSessions: [],
    motions: [],
    takes: [],
    references: [],
    patches: [],
    warnings: [],
    blueprints: [],
    staging: [],
    sceneBindings: [],
    calibrations: [],
    performanceEdits: [],
    crowdMotionUses: [],
    activeCharacterId: null,
  }
}

export function releaseStaleCaptures(store: HvsDigitalHumanStore): HvsDigitalHumanStore {
  store.calibrations ??= []
  store.performanceEdits ??= []
  store.crowdMotionUses ??= []
  for (const session of store.captureSessions) {
    if (session.status === 'ACTIVE' || session.status === 'ARMED') {
      session.status = 'INTERRUPTED'
      session.endTime = session.endTime ?? new Date().toISOString()
      session.deviceReleased = true
    }
  }
  for (const device of store.devices) {
    if (device.status === 'PREVIEW' || device.status === 'CAPTURING') device.status = 'CLOSED'
  }
  return store
}
