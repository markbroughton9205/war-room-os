/**
 * HvsCharacterProductionOrchestrator
 * Owns workflow sequencing. Does not own character identity truth.
 */
import { existsSync } from 'node:fs'
import { HVS_FACE_REFERENCE_REQUIRED, readFaceReferenceSet } from '../digital-human/face-reference'
import { RAEL_CHARACTER_ID } from '../digital-human/types'
import { productionAuthorityOk } from '../production-ai'
import { HVS_UE01_MOTION_ID, HVS_UE01_TAKE_ID, HVS_UE02_UPROJECT } from '../unreal/package'
import { HVS_RAEL_MHC_PATH } from './types'
import { ensureMetaHumanBinding } from '../unreal/metahuman-binding'
import { readUnrealScenePackage } from '../unreal/storage'
import { cinemaShots, dispatchUnrealCharacterOp } from '../unreal/character-ops'
import {
  HVS_UNREAL_LAUNCH_GRACE_MS,
  HVS_UNREAL_READY_TIMEOUT_MS,
  inspectUnrealProcess,
  metaHumanCharacterEditorVisible,
  probeUnrealStability,
  type HvsUnrealProcessTrace,
} from '../unreal/process'
import {
  HVS_CHARACTER_BUILD_OPERATION,
  HVS_CHARACTER_PRODUCTION_STAGES,
  HVS_CHARACTER_PRODUCTION_VERSION,
  canonicalBuildOperationId,
  defaultDnaRecord,
  defaultPrivacyDisclosure,
  defaultRaelBuildInputs,
  type HvsCharacterBuildInputs,
  type HvsCharacterBuildOperation,
  type HvsCharacterProductionSnapshot,
  type HvsCharacterProductionStage,
  HVS_OPERATOR_STEP_FAILED,
  HVS_OPERATOR_STEP_OPENING,
  HVS_OPERATOR_STEP_OPENING_MHC,
  HVS_OPERATOR_STEP_READY,
  HVS_OPERATOR_STEP_WAITING,
  type HvsCharacterStageReceipt,
  type HvsOperatorStepUi,
  type HvsUnrealCharacterOp,
} from './types'
import { acceptedFaceCount, deriveProductionState, inferredLikenessState, nextIncompleteStage } from './state'
import { appendCharacterAudit, readCharacterProduction, writeCharacterProduction } from './persist'
import { assertLocalOnlyPayload, preservesHuman01Locks, privacyDisclosureFor, privacyLocks } from './privacy'
import { primaryCta } from './view'
import { ensureAuthorityOnOperation, hvsMetaHumanLikenessAdapter, operatorStepMhcProofReady, type HvsPersistedConformResult } from './likeness-adapter'
import { persistMockUnrealPreview, previewUrl, readHighFidelityPreview, requestUnrealPreviewCapture } from './preview'

const STAGE_UNREAL_OP: Partial<Record<HvsCharacterProductionStage, HvsUnrealCharacterOp>> = {
  METAHUMAN_FOUNDATION: 'hvs.unreal.character.prepare',
  CONFORM: 'hvs.unreal.character.conform',
  ASSEMBLY: 'hvs.unreal.character.assemble',
  BODY_BIND: 'hvs.unreal.character.bind_body',
  CAMERA_BIND: 'hvs.unreal.character.bind_sequence',
  PREVIEW: 'hvs.unreal.character.preview',
}

export type OrchestratorOptions = {
  launchUnreal?: boolean
  resume?: boolean
  now?: string
  executeLive?: boolean
  persistConform?: HvsPersistedConformResult | null
  persistPreview?: boolean
  identityFitted?: boolean
}

function emptyReceipt(operationId: string, stage: HvsCharacterProductionStage): HvsCharacterStageReceipt {
  return {
    operationId,
    stage,
    status: 'PENDING',
    startedAt: null,
    completedAt: null,
    assetPaths: [],
    warnings: [],
    errorCode: null,
    operatorStep: null,
    unrealOp: STAGE_UNREAL_OP[stage] ?? null,
    notes: [],
  }
}

function takeConnected(projectId: string): boolean {
  const pkg = readUnrealScenePackage(projectId)
  return pkg?.characters[0]?.performanceTakeId === HVS_UE01_TAKE_ID
    && pkg.performances[0]?.motionId === HVS_UE01_MOTION_ID
}

function cinemaConnected(projectId: string): boolean {
  const shots = cinemaShots(projectId)
  const pkg = readUnrealScenePackage(projectId)
  return shots.length === 4 && shots.map(item => item.lensMm).join(',') === '24,24,24,85' && Boolean(pkg?.characters[0]?.binding.levelSequencePath)
}

function mergeReceipt(operation: HvsCharacterBuildOperation, receipt: HvsCharacterStageReceipt): void {
  const index = operation.receipts.findIndex(item => item.stage === receipt.stage)
  if (index >= 0) operation.receipts[index] = receipt
  else operation.receipts.push(receipt)
}

function audit(operation: HvsCharacterBuildOperation, action: string, now: string, extra: Partial<HvsCharacterBuildOperation['audit'][number]> = {}): void {
  operation.audit.push({
    at: now,
    actor: 'commander',
    action,
    operationId: operation.operationId,
    inputIds: [
      operation.inputs.projectId,
      operation.inputs.characterId,
      operation.inputs.faceReferenceSetId,
      operation.inputs.bodyMotionTakeId,
      operation.inputs.bodyMotionId,
    ],
    outputIds: [operation.metahumanCharacterPath],
    unrealReceipts: operation.receipts.filter(item => item.unrealOp).map(item => `${item.stage}:${item.status}`),
    ...extra,
  })
  appendCharacterAudit(operation)
}

function operatorStepMessage(status: HvsOperatorStepUi['status']): string {
  if (status === 'WAITING') return HVS_OPERATOR_STEP_WAITING
  if (status === 'OPENING_MHC') return HVS_OPERATOR_STEP_OPENING_MHC
  if (status === 'READY') return HVS_OPERATOR_STEP_READY
  if (status === 'FAILED') return HVS_OPERATOR_STEP_FAILED
  return HVS_OPERATOR_STEP_OPENING
}

function operatorStepElapsedMs(ui: HvsOperatorStepUi, now: number): number {
  const start = ui.launchedAt ?? ui.requestedAt
  if (!start) return 0
  const parsed = Date.parse(start)
  return Number.isFinite(parsed) ? Math.max(0, now - parsed) : 0
}

function withOperatorStepStatus(ui: HvsOperatorStepUi, status: HvsOperatorStepUi['status'], extra: Partial<HvsOperatorStepUi> = {}): HvsOperatorStepUi {
  return {
    ...ui,
    ...extra,
    status,
    message: operatorStepMessage(status),
    executeCloud: false,
    autoRigCalled: false,
  }
}

function promotedOperatorStepUi(
  operation: HvsCharacterBuildOperation | null,
  processStatus: HvsUnrealProcessTrace['status'],
): HvsOperatorStepUi | null {
  const ui = operation?.operatorStepUi ?? null
  if (!ui) return null
  if (ui.status === 'IDLE') return ui
  const now = Date.now()
  const elapsed = operatorStepElapsedMs(ui, now)
  const probe = probeUnrealStability(operation?.projectId ?? '', ui.firstAliveAt ?? null, now)
  const windowOpen = metaHumanCharacterEditorVisible()
  const mhcProof = operatorStepMhcProofReady(operation?.projectId ?? '', ui.requestedAt) || windowOpen
  const assetEditorOpened = mhcProof

  if (ui.status === 'READY') {
    if (processStatus === 'STOPPED') return withOperatorStepStatus(ui, 'FAILED', { mhcOpenProof: mhcProof, assetEditorOpened })
    return { ...ui, mhcOpenProof: mhcProof, assetEditorOpened, focused: true }
  }

  if (ui.status === 'FAILED') return ui

  if (processStatus === 'STOPPED') {
    if (elapsed < HVS_UNREAL_LAUNCH_GRACE_MS && (ui.launched || ui.status === 'OPENING')) {
      return withOperatorStepStatus(ui, 'OPENING')
    }
    return withOperatorStepStatus(ui, 'FAILED', { mhcOpenProof: mhcProof, assetEditorOpened })
  }

  if (ui.status === 'OPENING' && processStatus === 'RUNNING') {
    return withOperatorStepStatus(ui, 'WAITING', {
      firstAliveAt: ui.firstAliveAt ?? new Date(now).toISOString(),
    })
  }

  if ((ui.status === 'WAITING' || ui.status === 'OPENING') && processStatus === 'RUNNING') {
    if (!probe.stable) {
      return withOperatorStepStatus(ui, 'WAITING', { firstAliveAt: ui.firstAliveAt ?? new Date(now).toISOString() })
    }
    return withOperatorStepStatus(ui, 'OPENING_MHC', {
      firstAliveAt: ui.firstAliveAt ?? new Date(now).toISOString(),
      stableAt: ui.stableAt ?? new Date(now).toISOString(),
    })
  }

  if (ui.status === 'OPENING_MHC') {
    if (mhcProof && probe.alive) {
      return withOperatorStepStatus(ui, 'READY', {
        focused: true,
        mhcOpenProof: true,
        assetEditorOpened: true,
        stableAt: ui.stableAt ?? new Date(now).toISOString(),
      })
    }
    if (elapsed > HVS_UNREAL_READY_TIMEOUT_MS) {
      return withOperatorStepStatus(ui, 'FAILED', { mhcOpenProof: false, assetEditorOpened: false })
    }
    return withOperatorStepStatus(ui, 'OPENING_MHC', { mhcOpenProof: mhcProof, assetEditorOpened })
  }

  return ui
}

function createOperation(inputs: HvsCharacterBuildInputs, now: string): HvsCharacterBuildOperation {
  const operationId = canonicalBuildOperationId(inputs.characterId)
  return {
    version: HVS_CHARACTER_PRODUCTION_VERSION,
    operationId,
    kind: HVS_CHARACTER_BUILD_OPERATION,
    projectId: inputs.projectId,
    characterId: inputs.characterId,
    identityId: RAEL_CHARACTER_ID,
    notASecondIdentity: true,
    status: 'PENDING',
    productionState: 'CHARACTER_PREPARING',
    authorizedBy: 'commander',
    authorizedAt: now,
    inputs,
    receipts: HVS_CHARACTER_PRODUCTION_STAGES.map(stage => emptyReceipt(operationId, stage)),
    currentStage: 'PREREQUISITES',
    lastError: null,
    lastErrorCode: null,
    blocked: null,
    preview: null,
    previews: [],
    audit: [],
    privacy: privacyLocks(inputs.projectId),
    mannyRole: 'BODY_TEST_REFERENCE',
    take3Connected: false,
    cinemaConnected: false,
    metahumanCharacterPath: HVS_RAEL_MHC_PATH,
    likenessState: null,
    likenessReceipts: [],
    authority: null,
    keepLocal: false,
    approvalGateOpen: false,
    cloudSubmission: null,
    dna: defaultDnaRecord(),
    highFidelityPreview: null,
    operatorGate: null,
    operatorStepUi: null,
    epicSignInRequired: false,
    textureSynthesisCalled: false,
    payloadCategory: null,
    updatedAt: now,
  }
}

function runPrerequisites(operation: HvsCharacterBuildOperation, now: string): HvsCharacterStageReceipt {
  const face = acceptedFaceCount(operation.projectId)
  const warnings: string[] = []
  const notes: string[] = []
  if (!face.complete) {
    return {
      operationId: operation.operationId,
      stage: 'PREREQUISITES',
      status: 'FAILED',
      startedAt: now,
      completedAt: now,
      assetPaths: [],
      warnings,
      errorCode: 'FACE_REFERENCES_INCOMPLETE',
      operatorStep: 'Accept all five identity stills before building Ra\'el.',
      unrealOp: null,
      notes: [`${face.accepted}/${face.required} accepted.`],
    }
  }
  if (operation.inputs.characterId !== RAEL_CHARACTER_ID) {
    return {
      operationId: operation.operationId,
      stage: 'PREREQUISITES',
      status: 'FAILED',
      startedAt: now,
      completedAt: now,
      assetPaths: [],
      warnings,
      errorCode: 'IDENTITY_MISMATCH',
      operatorStep: "Only rael-commander may be built in this flow.",
      unrealOp: null,
      notes,
    }
  }
  const authority = productionAuthorityOk()
  if (!authority.ok) {
    return {
      operationId: operation.operationId,
      stage: 'PREREQUISITES',
      status: 'FAILED',
      startedAt: now,
      completedAt: now,
      assetPaths: [],
      warnings,
      errorCode: 'AUTHORITY_REFUSED',
      operatorStep: authority.error,
      unrealOp: null,
      notes,
    }
  }
  if (!existsSync(HVS_UE02_UPROJECT)) warnings.push('HVSRuntime project file was not found.')
  notes.push('BUILD RA\'EL authorizes local HVS, Unreal, MetaHuman Creator, binding, and validation only.')
  notes.push('Cloud upload, training, voice cloning, publishing, spending, Marketplace/Fab, and deployment are refused.')
  return {
    operationId: operation.operationId,
    stage: 'PREREQUISITES',
    status: 'COMPLETE',
    startedAt: now,
    completedAt: now,
    assetPaths: [HVS_UE02_UPROJECT],
    warnings,
    errorCode: null,
    operatorStep: null,
    unrealOp: null,
    notes,
  }
}

function runFaceReferences(operation: HvsCharacterBuildOperation, now: string): HvsCharacterStageReceipt {
  const face = readFaceReferenceSet(operation.projectId)
  const accepted = HVS_FACE_REFERENCE_REQUIRED.filter(type => face.stills[type]?.accepted)
  return {
    operationId: operation.operationId,
    stage: 'FACE_REFERENCES',
    status: accepted.length === 5 ? 'COMPLETE' : 'FAILED',
    startedAt: now,
    completedAt: now,
    assetPaths: accepted.map(type => face.stills[type]?.file ?? type).filter(Boolean) as string[],
    warnings: [],
    errorCode: accepted.length === 5 ? null : 'FACE_REFERENCES_INCOMPLETE',
    operatorStep: accepted.length === 5 ? null : 'Finish the five accepted identity stills.',
    unrealOp: null,
    notes: ['Existing accepted set reused. Capture was not restarted.', `localOnly=${face.localOnly}`],
  }
}

function runLikenessStage(
  operation: HvsCharacterBuildOperation,
  now: string,
  options: OrchestratorOptions,
): HvsCharacterStageReceipt {
  const result = hvsMetaHumanLikenessAdapter.run(operation, {
    executeLive: Boolean(options.executeLive),
    launchUnreal: Boolean(options.launchUnreal),
    now,
    persistResult: options.persistConform ?? null,
    identityFitted: options.identityFitted,
  })
  operation.likenessState = result.likenessState
  operation.likenessReceipts = result.receipts
  operation.cloudSubmission = result.submission
  operation.dna = result.dna
  operation.operatorGate = result.operatorGate
  operation.epicSignInRequired = result.epicSignInRequired
  operation.textureSynthesisCalled = result.textureSynthesisCalled
  operation.payloadCategory = result.payloadCategory
  return {
    operationId: operation.operationId,
    stage: 'CONFORM',
    status: result.status,
    startedAt: now,
    completedAt: result.status === 'RUNNING' ? null : now,
    assetPaths: result.assetPaths,
    warnings: result.networkSideEffect ? [] : ['No MetaHuman cloud call was made in this step.'],
    errorCode: result.errorCode,
    operatorStep: result.operatorStep,
    unrealOp: 'hvs.unreal.character.conform',
    notes: result.notes,
  }
}

function runUnrealStage(operation: HvsCharacterBuildOperation, stage: HvsCharacterProductionStage, now: string, launch: boolean): HvsCharacterStageReceipt {
  const op = STAGE_UNREAL_OP[stage]
  if (!op) return emptyReceipt(operation.operationId, stage)
  const dispatched = dispatchUnrealCharacterOp({ projectId: operation.projectId, op, launch })
  return {
    operationId: operation.operationId,
    stage,
    status: dispatched.status === 'RUNNING' ? 'RUNNING' : dispatched.status,
    startedAt: now,
    completedAt: dispatched.status === 'RUNNING' ? null : now,
    assetPaths: dispatched.assetPaths,
    warnings: dispatched.warnings,
    errorCode: dispatched.errorCode,
    operatorStep: dispatched.operatorStep,
    unrealOp: op,
    notes: dispatched.notes,
  }
}

function runValidation(operation: HvsCharacterBuildOperation, now: string): HvsCharacterStageReceipt {
  const manny = readUnrealScenePackage(operation.projectId)?.characters[0]?.binding
  const binding = ensureMetaHumanBinding(operation.projectId)
  const ok = operation.characterId === RAEL_CHARACTER_ID
    && operation.identityId === RAEL_CHARACTER_ID
    && operation.notASecondIdentity
    && binding.metahumanCharacterPath === HVS_RAEL_MHC_PATH
    && manny?.adapter === 'GENERIC_UE_HUMANOID'
    && manny.metahumanCharacterPath == null
    && preservesHuman01Locks(operation)
  return {
    operationId: operation.operationId,
    stage: 'VALIDATION',
    status: ok ? 'COMPLETE' : 'FAILED',
    startedAt: now,
    completedAt: now,
    assetPaths: [binding.metahumanCharacterPath],
    warnings: [],
    errorCode: ok ? null : 'VALIDATION_FAILED',
    operatorStep: ok ? null : 'Validation found a second identity or a privacy lock failure.',
    unrealOp: null,
    notes: [
      `Manny adapter ${manny?.adapter ?? 'missing'} remains BODY_TEST_REFERENCE.`,
      `Privacy localOnly=${operation.privacy.localOnly}.`,
    ],
  }
}

function applyReceipt(operation: HvsCharacterBuildOperation, receipt: HvsCharacterStageReceipt, now: string, process: HvsUnrealProcessTrace): void {
  mergeReceipt(operation, receipt)
  operation.currentStage = receipt.stage
  operation.updatedAt = now
  operation.take3Connected = takeConnected(operation.projectId) || operation.receipts.some(item => item.stage === 'BODY_BIND' && item.status === 'COMPLETE')
  operation.cinemaConnected = cinemaConnected(operation.projectId) || operation.receipts.some(item => item.stage === 'CAMERA_BIND' && item.status === 'COMPLETE')
  if (receipt.status === 'BLOCKED') {
    const approval = receipt.errorCode === 'LIKELINESS_APPROVAL_REQUIRED'
    operation.status = 'BLOCKED'
    operation.lastError = receipt.operatorStep
    operation.lastErrorCode = receipt.errorCode
    operation.blocked = approval ? null : {
      headline: process.status === 'UNRESPONSIVE' ? 'UNREAL IS NOT RESPONDING' : "RA'EL BUILD NEEDS YOUR ATTENTION",
      operatorStep: receipt.operatorStep,
      retryable: true,
      errorCode: receipt.errorCode,
    }
    operation.productionState = approval ? 'LIKELINESS_APPROVAL_REQUIRED' : (receipt.errorCode === 'EPIC_SIGN_IN_REQUIRED' ? 'LIKELINESS_BLOCKED' : 'CHARACTER_BLOCKED')
    if (approval) operation.likenessState = 'LIKELINESS_APPROVAL_REQUIRED'
    return
  }
  if (receipt.status === 'FAILED') {
    operation.status = 'FAILED'
    operation.lastError = receipt.operatorStep
    operation.lastErrorCode = receipt.errorCode
    operation.blocked = {
      headline: process.status === 'STOPPED' ? 'UNREAL STOPPED' : process.status === 'UNRESPONSIVE' ? 'UNREAL IS NOT RESPONDING' : 'Build could not finish',
      operatorStep: receipt.operatorStep,
      retryable: true,
      errorCode: receipt.errorCode,
    }
    operation.productionState = 'CHARACTER_ERROR'
  }
}

export class HvsCharacterProductionOrchestrator {
  snapshot(projectId: string, characterId = RAEL_CHARACTER_ID): HvsCharacterProductionSnapshot {
    const face = acceptedFaceCount(projectId)
    const operation = readCharacterProduction(projectId, characterId)
    const connected = takeConnected(projectId)
    const process = inspectUnrealProcess(projectId)
    const productionState = deriveProductionState({
      faceComplete: face.complete,
      faceAccepted: face.accepted,
      operation,
      takeConnected: connected,
    })
    const shots = cinemaShots(projectId)
    const preview = operation?.highFidelityPreview ?? readHighFidelityPreview(projectId, characterId)
    const likenessState = inferredLikenessState(operation)
    const operatorStepUi = promotedOperatorStepUi(operation, process.status)
    if (operation && operatorStepUi && JSON.stringify(operation.operatorStepUi) !== JSON.stringify(operatorStepUi)) {
      operation.operatorStepUi = operatorStepUi
      writeCharacterProduction(operation)
    }
    return {
      version: HVS_CHARACTER_PRODUCTION_VERSION,
      projectId,
      characterId,
      productionState,
      faceReferences: face,
      bodyPerformance: {
        takeId: HVS_UE01_TAKE_ID,
        motionId: HVS_UE01_MOTION_ID,
        connected,
        label: connected ? 'TAKE 3 connected' : 'TAKE 3 missing',
      },
      facePerformance: { captured: false, recommended: 'CAPTURE FACIAL PERFORMANCE' },
      cinema: {
        connected: cinemaConnected(projectId),
        shots,
      },
      operation,
      unrealProcess: {
        status: process.status,
        version: process.version,
        uproject: process.uproject,
      },
      nextAction: primaryCta(productionState) ?? (productionState === 'CHARACTER_READY' ? 'CAPTURE FACIAL PERFORMANCE' : 'Wait'),
      primaryCta: primaryCta(productionState),
      recommendedAfterReady: 'CAPTURE FACIAL PERFORMANCE',
      likenessState,
      approvalGateOpen: Boolean(operation?.approvalGateOpen),
      authority: operation?.authority ?? null,
      privacyDisclosure: operation ? privacyDisclosureFor(operation) : defaultPrivacyDisclosure(),
      operatorGate: operation?.operatorGate ?? null,
      operatorStepUi,
      epicSignInRequired: Boolean(operation?.epicSignInRequired),
      highFidelityPreview: preview,
      previewUnavailable: Boolean(operation) && !preview && (productionState === 'CHARACTER_READY' || likenessState === 'LIKELINESS_COMPLETE'),
    }
  }

  build(projectId: string, options: OrchestratorOptions = {}): HvsCharacterProductionSnapshot {
    const now = options.now ?? new Date().toISOString()
    const inputs = defaultRaelBuildInputs(projectId)
    const existing = readCharacterProduction(projectId, inputs.characterId)
    if (existing && existing.operationId !== canonicalBuildOperationId(inputs.characterId)) {
      throw new Error('IDENTITY_MISMATCH: a second Ra\'el operation is not allowed.')
    }
    if (existing?.status === 'COMPLETE' && !options.resume) {
      return this.snapshot(projectId, inputs.characterId)
    }
    if (existing?.status === 'RUNNING' && !options.resume) {
      return this.snapshot(projectId, inputs.characterId)
    }
    const operation = existing && existing.operationId === canonicalBuildOperationId(inputs.characterId)
      ? existing
      : createOperation(inputs, now)
    if (!existing) audit(operation, 'BUILD_RAEL', now)
    else if (options.resume || existing.status === 'BLOCKED' || existing.status === 'FAILED') audit(operation, 'RESUME_BUILD', now)
    operation.status = 'RUNNING'
    operation.blocked = null
    operation.lastError = null
    operation.lastErrorCode = null
    operation.privacy = privacyLocks(projectId)
    assertLocalOnlyPayload({ inputs: operation.inputs, privacy: operation.privacy })
    this.runFrom(operation, now, options)
    writeCharacterProduction(operation)
    return this.snapshot(projectId, inputs.characterId)
  }

  continueRaelBuild(projectId: string, options: OrchestratorOptions = {}): HvsCharacterProductionSnapshot {
    const snapshot = this.build(projectId, { ...options, launchUnreal: false, executeLive: false })
    const operation = readCharacterProduction(projectId)
    if (operation) {
      operation.approvalGateOpen = true
      operation.likenessState = 'LIKELINESS_APPROVAL_REQUIRED'
      writeCharacterProduction(operation)
    }
    return this.snapshot(projectId)
  }

  keepLocal(projectId: string, options: OrchestratorOptions = {}): HvsCharacterProductionSnapshot {
    const now = options.now ?? new Date().toISOString()
    let operation = readCharacterProduction(projectId)
    if (!operation) {
      this.build(projectId, { ...options, launchUnreal: false, executeLive: false })
      operation = readCharacterProduction(projectId)
    }
    if (!operation) throw new Error('KEEP_LOCAL_FAILED')
    operation.keepLocal = true
    operation.approvalGateOpen = false
    operation.likenessState = 'LIKELINESS_APPROVAL_REQUIRED'
    operation.status = 'BLOCKED'
    operation.productionState = 'LIKELINESS_APPROVAL_REQUIRED'
    operation.lastErrorCode = 'LIKELINESS_APPROVAL_REQUIRED'
    audit(operation, 'KEEP_LOCAL', now)
    writeCharacterProduction(operation)
    return this.snapshot(projectId)
  }

  authorizeLikeness(projectId: string, options: OrchestratorOptions = {}): HvsCharacterProductionSnapshot {
    const now = options.now ?? new Date().toISOString()
    this.build(projectId, { ...options, launchUnreal: false, executeLive: false })
    const operation = readCharacterProduction(projectId)
    if (!operation) throw new Error('AUTHORIZE_FAILED')
    ensureAuthorityOnOperation(operation, now)
    operation.approvalGateOpen = false
    operation.keepLocal = false
    operation.likenessState = 'LIKELINESS_AUTHORIZED'
    const conform = operation.receipts.find(item => item.stage === 'CONFORM')
    if (conform && conform.status !== 'COMPLETE') {
      conform.status = 'PENDING'
      conform.completedAt = null
      conform.errorCode = null
    }
    if (options.persistConform?.dnaPresent) {
      for (const stage of ['ASSEMBLY', 'VALIDATION', 'PREVIEW'] as const) {
        const receipt = operation.receipts.find(item => item.stage === stage)
        if (receipt && receipt.status === 'COMPLETE') {
          receipt.status = 'PENDING'
          receipt.completedAt = null
        }
      }
    }
    audit(operation, 'AUTHORIZE_LIKENESS', now, { outputIds: [operation.authority?.authorizationId ?? '', HVS_RAEL_MHC_PATH] })
    operation.status = 'RUNNING'
    this.runFrom(operation, now, { ...options, executeLive: Boolean(options.executeLive) })
    writeCharacterProduction(operation)
    return this.snapshot(projectId)
  }

  openRequiredStep(projectId: string, options: OrchestratorOptions = {}): HvsCharacterProductionSnapshot {
    const opened = hvsMetaHumanLikenessAdapter.openRequiredStep(projectId, { launch: options.launchUnreal !== false })
    const operation = readCharacterProduction(projectId)
    if (operation) {
      operation.operatorGate = {
        kind: 'CREATOR_LANDMARK',
        headline: "RA'EL BUILD NEEDS YOUR ATTENTION",
        expectedAction: 'MetaHuman Creator needs one confirmation in Unreal.',
        assetPath: opened.assetPath,
      }
      const now = new Date().toISOString()
      const status: HvsOperatorStepUi['status'] = !opened.ok
        ? 'FAILED'
        : 'OPENING'
      operation.operatorStepUi = {
        status,
        message: operatorStepMessage(status),
        launched: opened.launched,
        focused: opened.focused,
        duplicateRefused: opened.duplicateRefused,
        executeCloud: false,
        autoRigCalled: false,
        assetPath: opened.assetPath,
        requestedAt: opened.requestedAt,
        launchedAt: now,
        firstAliveAt: opened.processStatus === 'RUNNING' && opened.duplicateRefused ? now : null,
        stableAt: null,
        mhcOpenProof: false,
        assetEditorOpened: false,
      }
      audit(operation, 'OPEN_REQUIRED_STEP', new Date().toISOString(), {
        outputIds: [opened.assetPath],
        unrealReceipts: [
          `executeCloud=${String(opened.executeCloud)}`,
          `autoRigCalled=${String(opened.autoRigCalled)}`,
          `launched=${String(opened.launched)}`,
          `duplicateRefused=${String(opened.duplicateRefused)}`,
        ],
      })
      writeCharacterProduction(operation)
    }
    return this.snapshot(projectId)
  }

  signInEpic(projectId: string): HvsCharacterProductionSnapshot {
    hvsMetaHumanLikenessAdapter.requestEpicSignIn(projectId)
    const operation = readCharacterProduction(projectId)
    if (operation) {
      operation.epicSignInRequired = true
      audit(operation, 'EPIC_SIGN_IN', new Date().toISOString())
      writeCharacterProduction(operation)
    }
    return this.snapshot(projectId)
  }

  refreshPreview(projectId: string, options: OrchestratorOptions = {}): HvsCharacterProductionSnapshot {
    const now = options.now ?? new Date().toISOString()
    const operation = readCharacterProduction(projectId)
    if (options.persistPreview) {
      const receipt = persistMockUnrealPreview(
        projectId,
        now,
        operation?.likenessState === 'LIKELINESS_COMPLETE' ? 'CINE_ASSEMBLED' : 'MHC_CREATED_LIKENESS_NOT_FINAL',
        operation?.take3Connected ? 'TAKE3_BOUND' : 'UNBOUND',
      )
      if (operation) {
        operation.highFidelityPreview = receipt
        writeCharacterProduction(operation)
      }
      return this.snapshot(projectId)
    }
    requestUnrealPreviewCapture(projectId, Boolean(options.launchUnreal))
    return this.snapshot(projectId)
  }

  private runFrom(operation: HvsCharacterBuildOperation, now: string, options: OrchestratorOptions): void {
    const process = inspectUnrealProcess(operation.projectId)
    const launch = Boolean(options.launchUnreal)
    const start = nextIncompleteStage(operation.receipts, HVS_CHARACTER_PRODUCTION_STAGES) ?? 'PREREQUISITES'
    const startIndex = HVS_CHARACTER_PRODUCTION_STAGES.indexOf(start)
    for (const stage of HVS_CHARACTER_PRODUCTION_STAGES.slice(Math.max(0, startIndex))) {
      const prior = operation.receipts.find(item => item.stage === stage)
      if (prior?.status === 'COMPLETE' || prior?.status === 'SKIPPED') continue
      operation.currentStage = stage
      operation.productionState = deriveProductionState({
        faceComplete: true,
        faceAccepted: 5,
        operation,
        takeConnected: takeConnected(operation.projectId),
      })
      writeCharacterProduction(operation)
      let receipt: HvsCharacterStageReceipt
      if (stage === 'PREREQUISITES') receipt = runPrerequisites(operation, now)
      else if (stage === 'FACE_REFERENCES') receipt = runFaceReferences(operation, now)
      else if (stage === 'CONFORM') receipt = runLikenessStage(operation, now, options)
      else if (stage === 'VALIDATION') receipt = runValidation(operation, now)
      else receipt = runUnrealStage(operation, stage, now, launch && (stage === 'METAHUMAN_FOUNDATION' || stage === 'PREVIEW'))
      applyReceipt(operation, receipt, now, process)
      if (stage === 'CONFORM' && receipt.status === 'COMPLETE' && operation.likenessState === 'LIKELINESS_COMPLETE') {
        for (const later of ['ASSEMBLY', 'VALIDATION', 'PREVIEW'] as const) {
          const item = operation.receipts.find(entry => entry.stage === later)
          if (item && item.status === 'COMPLETE') {
            item.status = 'PENDING'
            item.completedAt = null
          }
        }
      }
      if (stage === 'PREVIEW' && (receipt.status === 'COMPLETE' || receipt.status === 'SKIPPED')) {
        if (options.persistPreview || operation.likenessState === 'LIKELINESS_COMPLETE') {
          const existing = readHighFidelityPreview(operation.projectId, operation.characterId)
          operation.highFidelityPreview = existing ?? (options.persistPreview
            ? persistMockUnrealPreview(
              operation.projectId,
              now,
              operation.likenessState === 'LIKELINESS_COMPLETE' ? 'CINE_ASSEMBLED' : 'MHC_CREATED_LIKENESS_NOT_FINAL',
              operation.take3Connected ? 'TAKE3_BOUND' : 'UNBOUND',
            )
            : null)
        }
        if (!operation.highFidelityPreview && launch) {
          requestUnrealPreviewCapture(operation.projectId, launch)
          operation.highFidelityPreview = readHighFidelityPreview(operation.projectId, operation.characterId)
        }
        const hfReady = Boolean(operation.highFidelityPreview)
        operation.previews = [
          { mode: 'FAST', renderer: 'THREE_JS', url: null, path: null, ready: true },
          {
            mode: 'HIGH_FIDELITY',
            renderer: 'UNREAL',
            url: hfReady ? previewUrl(operation.projectId) : null,
            path: operation.highFidelityPreview?.assetPath ?? null,
            ready: hfReady,
          },
        ]
        operation.preview = hfReady ? operation.previews[1] : operation.previews[0]
      }
      writeCharacterProduction(operation)
      const deferConform = stage === 'CONFORM' && receipt.status === 'BLOCKED'
        && (receipt.errorCode === 'LIKELINESS_APPROVAL_REQUIRED' || receipt.errorCode === 'LIVE_CLOUD_NOT_EXECUTED')
      if (receipt.status === 'FAILED') return
      if (receipt.status === 'BLOCKED' && !deferConform) return
      if (deferConform) {
        operation.status = 'RUNNING'
      }
    }
    const remaining = nextIncompleteStage(operation.receipts, HVS_CHARACTER_PRODUCTION_STAGES)
    const conform = operation.receipts.find(item => item.stage === 'CONFORM')
    if (conform?.status === 'BLOCKED' && (conform.errorCode === 'LIKELINESS_APPROVAL_REQUIRED' || operation.keepLocal)) {
      operation.status = 'BLOCKED'
      operation.productionState = 'LIKELINESS_APPROVAL_REQUIRED'
      operation.likenessState = 'LIKELINESS_APPROVAL_REQUIRED'
      operation.currentStage = 'CONFORM'
      operation.lastError = conform.operatorStep
      operation.lastErrorCode = 'LIKELINESS_APPROVAL_REQUIRED'
      operation.blocked = null
    } else if (conform?.status === 'BLOCKED') {
      operation.status = 'BLOCKED'
      operation.productionState = operation.epicSignInRequired ? 'LIKELINESS_BLOCKED' : 'CHARACTER_BLOCKED'
      operation.currentStage = 'CONFORM'
      operation.lastError = conform.operatorStep
      operation.lastErrorCode = conform.errorCode
      operation.blocked = {
        headline: operation.epicSignInRequired ? 'EPIC SIGN-IN REQUIRED' : "RA'EL BUILD NEEDS YOUR ATTENTION",
        operatorStep: conform.operatorStep,
        retryable: true,
        errorCode: conform.errorCode,
      }
    } else if (!remaining) {
      const ready = operation.likenessState === 'LIKELINESS_COMPLETE'
        && operation.dna.present
        && Boolean(operation.highFidelityPreview)
        && operation.receipts.every(item => item.status === 'COMPLETE' || item.status === 'SKIPPED')
      if (!ready) {
        operation.status = 'BLOCKED'
        operation.productionState = operation.likenessState === 'LIKELINESS_COMPLETE' ? 'CHARACTER_BLOCKED' : 'LIKELINESS_APPROVAL_REQUIRED'
        return
      }
      operation.status = 'COMPLETE'
      operation.productionState = 'CHARACTER_READY'
      operation.currentStage = 'PREVIEW'
      operation.blocked = null
      if (!operation.preview) {
        operation.previews = [
          { mode: 'FAST', renderer: 'THREE_JS', url: null, path: null, ready: true },
          {
            mode: 'HIGH_FIDELITY',
            renderer: 'UNREAL',
            url: previewUrl(operation.projectId),
            path: operation.highFidelityPreview?.assetPath ?? null,
            ready: true,
          },
        ]
        operation.preview = operation.previews[1]
      }
      audit(operation, 'BUILD_COMPLETE', now, { outputIds: [operation.metahumanCharacterPath, operation.inputs.bodyMotionTakeId, operation.highFidelityPreview?.previewId ?? ''] })
    }
  }
}

export const hvsCharacterProductionOrchestrator = new HvsCharacterProductionOrchestrator()
