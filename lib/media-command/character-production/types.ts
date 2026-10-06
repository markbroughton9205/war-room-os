/**
 * Canonical Ra'el high-fidelity production contract.
 * Production truth lives here. Button labels are not a source of truth.
 * Unreal is an HVS execution engine, not a second user workflow.
 */
import { RAEL_CHARACTER_ID } from '../digital-human/types'

export const HVS_CHARACTER_PRODUCTION_SLICE = 'HVS-DIRECTOR-CHARACTER-01' as const
export const HVS_CHARACTER_PREVIEW_RETURN_SLICE = 'HVS-DIRECTOR-CHARACTER-02' as const
export const HVS_CHARACTER_BUILD_OPERATION = 'hvs.character.build_high_fidelity' as const
export const HVS_CHARACTER_PRODUCTION_VERSION = 1 as const

export const HVS_RAEL_PRODUCTION_CHARACTER_ID = RAEL_CHARACTER_ID
export const HVS_RAEL_PRODUCTION_PROJECT_ID = 'hvs-mud545ez-8w3a'
export const HVS_RAEL_BODY_TAKE_ID = 'take-mud7ggfd-zgdqbm'
export const HVS_RAEL_BODY_MOTION_ID = 'motion-mud7ggel-h3xmyo'
export const HVS_RAEL_ASSEMBLY_INTENT = 'CINE' as const
export const HVS_RAEL_WARDROBE_INTENT = 'RAEL_BLACK_SUIT' as const
export const HVS_RAEL_RENDER_INTENT = 'HIGH_FIDELITY' as const
export const HVS_RAEL_MHC_PATH = '/Game/HVS/Characters/Rael/MHC_Rael_Commander'

export const HVS_LIKENESS_PRODUCTION_STATES = [
  'LIKELINESS_APPROVAL_REQUIRED',
  'LIKELINESS_AUTHORIZED',
  'LIKELINESS_PREPARING',
  'LIKELINESS_SUBMITTING',
  'LIKELINESS_PROCESSING',
  'LIKELINESS_VERIFYING',
  'LIKELINESS_COMPLETE',
  'LIKELINESS_BLOCKED',
] as const
export type HvsLikenessProductionState = (typeof HVS_LIKENESS_PRODUCTION_STATES)[number]

export const HVS_CHARACTER_PRODUCTION_STATES = [
  'REFERENCES_REQUIRED',
  'REFERENCES_IN_PROGRESS',
  'REFERENCES_COMPLETE',
  'CHARACTER_READY_TO_BUILD',
  'CHARACTER_PREPARING',
  'CHARACTER_CONFORMING',
  'CHARACTER_ASSEMBLING',
  'BODY_BINDING',
  'CAMERA_BINDING',
  'VALIDATING',
  'PREVIEW_PREPARING',
  'CHARACTER_READY',
  'CHARACTER_BLOCKED',
  'CHARACTER_ERROR',
  ...HVS_LIKENESS_PRODUCTION_STATES,
] as const
export type HvsCharacterProductionState = (typeof HVS_CHARACTER_PRODUCTION_STATES)[number]

export const HVS_LIKENESS_STAGE_RECEIPTS = [
  'AUTHORITY_CHECK',
  'CONFORM_INPUT_PREP',
  'AUTORIG_SUBMIT',
  'AUTORIG_PROCESS',
  'AUTORIG_RESULT',
] as const
export type HvsLikenessStageName = (typeof HVS_LIKENESS_STAGE_RECEIPTS)[number]

export const HVS_CLOUD_PAYLOAD_CATEGORY = 'DERIVED_FACE_MESH_VERTICES' as const
export const HVS_METAHUMAN_LIKENESS_AUTHORITY_TYPE = 'METAHUMAN_LIKENESS_CLOUD' as const
export const HVS_METAHUMAN_LIKENESS_PROVIDER = 'EPIC_METAHUMAN' as const
export const HVS_METAHUMAN_LIKENESS_SCOPE = 'LIKELINESS_CONFORM_AUTORIG_ONLY' as const

export const HVS_CHARACTER_PRODUCTION_STAGES = [
  'PREREQUISITES',
  'FACE_REFERENCES',
  'METAHUMAN_FOUNDATION',
  'CONFORM',
  'ASSEMBLY',
  'BODY_BIND',
  'CAMERA_BIND',
  'VALIDATION',
  'PREVIEW',
] as const
export type HvsCharacterProductionStage = (typeof HVS_CHARACTER_PRODUCTION_STAGES)[number]

export const HVS_UNREAL_CHARACTER_OPS = [
  'hvs.unreal.character.prepare',
  'hvs.unreal.character.conform',
  'hvs.unreal.character.assemble',
  'hvs.unreal.character.bind_body',
  'hvs.unreal.character.bind_sequence',
  'hvs.unreal.character.preview',
] as const
export type HvsUnrealCharacterOp = (typeof HVS_UNREAL_CHARACTER_OPS)[number]

export type HvsReceiptStatus = 'PENDING' | 'RUNNING' | 'COMPLETE' | 'BLOCKED' | 'FAILED' | 'SKIPPED'

export type HvsCharacterStageReceipt = {
  operationId: string
  stage: HvsCharacterProductionStage
  status: HvsReceiptStatus
  startedAt: string | null
  completedAt: string | null
  assetPaths: string[]
  warnings: string[]
  errorCode: string | null
  operatorStep: string | null
  unrealOp: HvsUnrealCharacterOp | null
  notes: string[]
}

export type HvsCharacterBuildInputs = {
  projectId: string
  characterId: typeof RAEL_CHARACTER_ID | string
  faceReferenceSetId: string
  bodyMotionTakeId: string
  bodyMotionId: string
  assemblyIntent: typeof HVS_RAEL_ASSEMBLY_INTENT
  wardrobeIntent: typeof HVS_RAEL_WARDROBE_INTENT
  renderIntent: typeof HVS_RAEL_RENDER_INTENT
}

export const HVS_BUILD_AUTHORIZES = [
  'local HVS processing',
  'local Unreal execution',
  'local MetaHuman Creator operations',
  'local asset generation',
  'local binding',
  'local validation',
] as const

export const HVS_BUILD_DOES_NOT_AUTHORIZE = [
  'cloud upload',
  'external provider training',
  'voice cloning',
  'publishing',
  'spending money',
  'Marketplace purchase',
  'Fab purchase',
  'deployment',
] as const

export type HvsCharacterAuditEvent = {
  at: string
  actor: 'commander'
  action: string
  operationId: string
  inputIds: string[]
  outputIds: string[]
  unrealReceipts: string[]
}

export type HvsCharacterPreview = {
  mode: 'FAST' | 'HIGH_FIDELITY'
  renderer: 'THREE_JS' | 'UNREAL'
  url: string | null
  path: string | null
  ready: boolean
}

export type HvsLikenessStageReceipt = {
  stage: HvsLikenessStageName
  status: HvsReceiptStatus
  startedAt: string | null
  completedAt: string | null
  operationId: string | null
  provider: typeof HVS_METAHUMAN_LIKENESS_PROVIDER | null
  inputAssetRefs: string[]
  outputAssetRefs: string[]
  warnings: string[]
  errorCode: string | null
  notes: string[]
}

export type HvsMetaHumanLikenessAuthority = {
  authorizationId: string
  authorityType: typeof HVS_METAHUMAN_LIKENESS_AUTHORITY_TYPE
  projectId: string
  characterId: string
  provider: typeof HVS_METAHUMAN_LIKENESS_PROVIDER
  scope: typeof HVS_METAHUMAN_LIKENESS_SCOPE
  assemblyIntent: typeof HVS_RAEL_ASSEMBLY_INTENT
  trainingAllowed: false
  voiceAllowed: false
  faceRecognitionAllowed: false
  publicUploadAllowed: false
  marketplaceAllowed: false
  spendAllowed: false
  authorizedAt: string
  authorizedBy: 'commander'
  purpose: string
  inputCategories: Array<typeof HVS_CLOUD_PAYLOAD_CATEGORY | 'RELATED_CONFORM_MESHES' | 'TEXTURE_SYNTHESIS_DERIVED_MAPS'>
  singlePurpose: true
}

export type HvsCloudSubmissionRecord = {
  submissionId: string
  providerRequestId: string | null
  inputHash: string
  status: 'PENDING' | 'RUNNING' | 'COMPLETE' | 'FAILED' | 'BLOCKED'
  submittedAt: string | null
  completedAt: string | null
  payloadCategory: typeof HVS_CLOUD_PAYLOAD_CATEGORY
  networkSideEffect: boolean
  textureSynthesisCalled: boolean
}

export type HvsDnaRecord = {
  present: boolean
  assetPath: string | null
  internalToCharacter: boolean
  rigLogic: 'UNRIGGED' | 'RIG_PENDING' | 'RIGGED' | 'UNKNOWN'
  faceMeshPath: string | null
  bodyMeshPath: string | null
  note: string
}

export type HvsUnrealPreviewReceipt = {
  previewId: string
  characterId: string
  renderEngine: 'UNREAL'
  assetPath: string
  width: number
  height: number
  generatedAt: string
  sourceCharacterAsset: string
  assemblyState: string
  takeBindingState: string
  camera: string | null
  lensMm: number | null
}

export type HvsLikenessOperatorGate = {
  kind: 'NONE' | 'CREATOR_LANDMARK' | 'EPIC_SIGN_IN'
  headline: string
  expectedAction: string
  assetPath: string
}

export const HVS_OPERATOR_STEP_OPEN_LABEL = 'OPEN REQUIRED STEP' as const
export const HVS_OPERATOR_STEP_OPENING = 'OPENING UNREAL...' as const
export const HVS_OPERATOR_STEP_WAITING = 'WAITING FOR UNREAL...' as const
export const HVS_OPERATOR_STEP_OPENING_MHC = 'OPENING METAHUMAN CREATOR...' as const
export const HVS_OPERATOR_STEP_READY = 'UNREAL READY — COMPLETE THE REQUIRED METAHUMAN CREATOR STEP' as const
export const HVS_OPERATOR_STEP_FAILED = 'UNREAL COULD NOT STAY OPEN' as const
export const HVS_OPERATOR_STEP_RETRY = 'RETRY' as const

export type HvsOperatorStepUiStatus = 'IDLE' | 'OPENING' | 'WAITING' | 'OPENING_MHC' | 'READY' | 'FAILED'

export type HvsOperatorStepUi = {
  status: HvsOperatorStepUiStatus
  message: string
  launched: boolean
  focused: boolean
  duplicateRefused: boolean
  executeCloud: false
  autoRigCalled: false
  assetPath: typeof HVS_RAEL_MHC_PATH
  requestedAt?: string | null
  launchedAt?: string | null
  firstAliveAt?: string | null
  stableAt?: string | null
  mhcOpenProof?: boolean
  assetEditorOpened?: boolean
}

export type HvsPrivacyDisclosure = {
  originalReferences: 'LOCAL'
  epicCloudStep: typeof HVS_CLOUD_PAYLOAD_CATEGORY | 'NOT_AUTHORIZED'
  purpose: 'MetaHuman likeness creation'
  training: 'NOT AUTHORIZED'
  faceRecognition: 'NOT AUTHORIZED'
  voice: 'NOT AUTHORIZED'
}

export type HvsCharacterBlockedInfo = {
  headline: string
  operatorStep: string | null
  retryable: boolean
  errorCode: string | null
}

export type HvsCharacterBuildOperation = {
  version: typeof HVS_CHARACTER_PRODUCTION_VERSION
  operationId: string
  kind: typeof HVS_CHARACTER_BUILD_OPERATION
  projectId: string
  characterId: string
  identityId: typeof RAEL_CHARACTER_ID
  notASecondIdentity: true
  status: 'PENDING' | 'RUNNING' | 'BLOCKED' | 'FAILED' | 'COMPLETE'
  productionState: HvsCharacterProductionState
  authorizedBy: 'commander'
  authorizedAt: string
  inputs: HvsCharacterBuildInputs
  receipts: HvsCharacterStageReceipt[]
  currentStage: HvsCharacterProductionStage | null
  lastError: string | null
  lastErrorCode: string | null
  blocked: HvsCharacterBlockedInfo | null
  preview: HvsCharacterPreview | null
  previews: HvsCharacterPreview[]
  audit: HvsCharacterAuditEvent[]
  privacy: {
    localOnly: true
    cloud: false
    training: false
    embeddings: false
    identityRecognition: false
    faceBytesEmbedded: false
  }
  mannyRole: 'BODY_TEST_REFERENCE'
  take3Connected: boolean
  cinemaConnected: boolean
  metahumanCharacterPath: typeof HVS_RAEL_MHC_PATH
  likenessState: HvsLikenessProductionState | null
  likenessReceipts: HvsLikenessStageReceipt[]
  authority: HvsMetaHumanLikenessAuthority | null
  keepLocal: boolean
  approvalGateOpen: boolean
  cloudSubmission: HvsCloudSubmissionRecord | null
  dna: HvsDnaRecord
  highFidelityPreview: HvsUnrealPreviewReceipt | null
  operatorGate: HvsLikenessOperatorGate | null
  operatorStepUi: HvsOperatorStepUi | null
  epicSignInRequired: boolean
  textureSynthesisCalled: boolean
  payloadCategory: typeof HVS_CLOUD_PAYLOAD_CATEGORY | null
  updatedAt: string
}

export type HvsCharacterProductionSnapshot = {
  version: typeof HVS_CHARACTER_PRODUCTION_VERSION
  projectId: string
  characterId: string
  productionState: HvsCharacterProductionState
  faceReferences: { accepted: number; required: number; status: string; complete: boolean }
  bodyPerformance: { takeId: string; motionId: string; connected: boolean; label: string }
  facePerformance: { captured: false; recommended: 'CAPTURE FACIAL PERFORMANCE' }
  cinema: { connected: boolean; shots: Array<{ name: string; lensMm: number }> }
  operation: HvsCharacterBuildOperation | null
  unrealProcess: {
    status: 'RUNNING' | 'STOPPED' | 'UNRESPONSIVE'
    version: string | null
    uproject: string
  }
  nextAction: string
  primaryCta: string | null
  recommendedAfterReady: 'CAPTURE FACIAL PERFORMANCE'
  likenessState: HvsLikenessProductionState | null
  approvalGateOpen: boolean
  authority: HvsMetaHumanLikenessAuthority | null
  privacyDisclosure: HvsPrivacyDisclosure
  operatorGate: HvsLikenessOperatorGate | null
  operatorStepUi: HvsOperatorStepUi | null
  epicSignInRequired: boolean
  highFidelityPreview: HvsUnrealPreviewReceipt | null
  previewUnavailable: boolean
}

export function canonicalBuildOperationId(characterId: string): string {
  return `${HVS_CHARACTER_BUILD_OPERATION}:${characterId}`
}

export function defaultRaelBuildInputs(projectId = HVS_RAEL_PRODUCTION_PROJECT_ID): HvsCharacterBuildInputs {
  return {
    projectId,
    characterId: HVS_RAEL_PRODUCTION_CHARACTER_ID,
    faceReferenceSetId: `face-reference:${projectId}:${HVS_RAEL_PRODUCTION_CHARACTER_ID}`,
    bodyMotionTakeId: HVS_RAEL_BODY_TAKE_ID,
    bodyMotionId: HVS_RAEL_BODY_MOTION_ID,
    assemblyIntent: HVS_RAEL_ASSEMBLY_INTENT,
    wardrobeIntent: HVS_RAEL_WARDROBE_INTENT,
    renderIntent: HVS_RAEL_RENDER_INTENT,
  }
}

export function defaultDnaRecord(): HvsDnaRecord {
  return {
    present: false,
    assetPath: null,
    internalToCharacter: true,
    rigLogic: 'UNRIGGED',
    faceMeshPath: null,
    bodyMeshPath: null,
    note: 'DNA is not fabricated. Official Auto-Rig returns DNA in memory on the MetaHuman Character; a separate .dna asset path is recorded only if Unreal actually writes one.',
  }
}

export function defaultPrivacyDisclosure(): HvsPrivacyDisclosure {
  return {
    originalReferences: 'LOCAL',
    epicCloudStep: 'NOT_AUTHORIZED',
    purpose: 'MetaHuman likeness creation',
    training: 'NOT AUTHORIZED',
    faceRecognition: 'NOT AUTHORIZED',
    voice: 'NOT AUTHORIZED',
  }
}
