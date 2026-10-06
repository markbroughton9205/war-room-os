/**
 * HvsMetaHumanLikenessAdapter
 *
 * Typed wrapper around official UE 5.8 MetaHuman auto-rig / conform.
 * Never scatters RequestAutoRigging across UI or API routes.
 * Never calls cloud services unless a single-purpose HVS authority exists.
 *
 * Official contract (inspected in this installed engine):
 * - JPEGs are NOT the AutoRig payload.
 * - RequestAutoRigging builds FTargetSolveParameters from the edited Face State
 *   and uploads protobuf meshes (Face LOD0 ~24049 vertices plus related meshes).
 * - Photo landmark placement is a Creator UI step; TrackFaceLandmarksFromImage
 *   consumes raw BGRA pixels, not JPEG files.
 * - DNA is applied in-memory onto the MetaHuman Character (HasFaceDNA).
 * - CINE build_meta_human requires Rigged + high-resolution textures.
 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { HVS_FACE_REFERENCE_REQUIRED, readFaceReferenceSet } from '../digital-human/face-reference'
import { HVS_MHC_UASSET, ensureMetaHumanBinding, writeMetaHumanBinding } from '../unreal/metahuman-binding'
import { ensureInteractiveUnrealEditor, focusUnrealWindow, inspectUnrealProcess, startUnrealProcess } from '../unreal/process'
import { unrealPackageDir } from '../unreal/storage'
import { writeFileSync, mkdirSync } from 'node:fs'
import { hasLikenessAuthority, createLikenessAuthority } from './authority'
import {
  characterPreviewDir,
  readCloudSubmission,
  writeCloudSubmission,
  writeLikenessAuthority,
} from './persist'
import {
  HVS_CLOUD_PAYLOAD_CATEGORY,
  HVS_METAHUMAN_LIKENESS_PROVIDER,
  HVS_RAEL_MHC_PATH,
  HVS_RAEL_PRODUCTION_CHARACTER_ID,
  defaultDnaRecord,
  type HvsCharacterBuildOperation,
  type HvsCharacterStageReceipt,
  type HvsCloudSubmissionRecord,
  type HvsDnaRecord,
  type HvsLikenessOperatorGate,
  type HvsLikenessStageReceipt,
  type HvsUnrealCharacterOp,
} from './types'

export const HVS_LIKENESS_PYTHON = path.join(process.cwd(), 'lib/media-command/unreal/hvs_likeness_ops.py')

export type HvsOperatorStepResult = {
  launched: boolean
  focused: boolean
  duplicateRefused: boolean
  assetPath: typeof HVS_RAEL_MHC_PATH
  executeCloud: false
  autoRigCalled: false
  processStatus: 'RUNNING' | 'STOPPED' | 'UNRESPONSIVE'
  ok: boolean
  errorCode: string | null
  requestedAt: string
  command: string | null
}

export type HvsLikenessAdapterOptions = {
  executeLive?: boolean
  launchUnreal?: boolean
  now?: string
  persistResult?: HvsPersistedConformResult | null
  identityFitted?: boolean
}

export type HvsPersistedConformResult = {
  dnaPresent: boolean
  dnaInternal: boolean
  dnaAssetPath: string | null
  rigLogic: HvsDnaRecord['rigLogic']
  faceMeshPath: string | null
  bodyMeshPath: string | null
  identityFitted: boolean
  cineAssembled: boolean
  assembledBlueprintPath: string | null
  providerRequestId: string | null
  textureSynthesisCalled: boolean
}

export type HvsLikenessAdapterResult = {
  status: 'COMPLETE' | 'BLOCKED' | 'FAILED' | 'RUNNING'
  likenessState: HvsCharacterBuildOperation['likenessState']
  networkSideEffect: boolean
  autoRigCalled: boolean
  textureSynthesisCalled: boolean
  payloadCategory: typeof HVS_CLOUD_PAYLOAD_CATEGORY | null
  errorCode: string | null
  operatorStep: string | null
  operatorGate: HvsLikenessOperatorGate | null
  epicSignInRequired: boolean
  dna: HvsDnaRecord
  receipts: HvsLikenessStageReceipt[]
  submission: HvsCloudSubmissionRecord | null
  notes: string[]
  assetPaths: string[]
  officialGui: 'HEADLESS' | 'BOUNDED_OPERATOR_STEP'
}

function emptyLikenessReceipt(stage: HvsLikenessStageReceipt['stage'], now: string, status: HvsLikenessStageReceipt['status'] = 'PENDING'): HvsLikenessStageReceipt {
  return {
    stage,
    status,
    startedAt: now,
    completedAt: status === 'RUNNING' || status === 'PENDING' ? null : now,
    operationId: null,
    provider: HVS_METAHUMAN_LIKENESS_PROVIDER,
    inputAssetRefs: [HVS_RAEL_MHC_PATH],
    outputAssetRefs: [],
    warnings: [],
    errorCode: null,
    notes: [],
  }
}

function inputHash(projectId: string, authorizationId: string): string {
  const face = readFaceReferenceSet(projectId)
  const stills = HVS_FACE_REFERENCE_REQUIRED.map(type => {
    const still = face.stills[type]
    return { type, file: still?.file ?? null, bytes: still?.quality.bytes ?? 0 }
  })
  return createHash('sha256').update(JSON.stringify({
    mhc: HVS_RAEL_MHC_PATH,
    authorizationId,
    stills,
  })).digest('hex')
}

function writeLikenessRequest(projectId: string, payload: Record<string, unknown>): string {
  const dir = path.join(unrealPackageDir(projectId), 'character-ops')
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'hvs_unreal_character_conform.request.json')
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`)
  return file
}

function readLikenessProof(projectId: string): Record<string, unknown> | null {
  const file = path.join(unrealPackageDir(projectId), 'character-ops', 'likeness-receipt.json')
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

export function readOperatorStepProof(projectId: string): Record<string, unknown> | null {
  return readLikenessProof(projectId)
}

export function operatorStepMhcProofReady(projectId: string, requestedAt?: string | null): boolean {
  const proof = readLikenessProof(projectId)
  if (!proof) return false
  if (proof.action !== 'open_mhc' || proof.ok !== true) return false
  if (proof.path !== HVS_RAEL_MHC_PATH && proof.mhc !== HVS_RAEL_MHC_PATH) return false
  if (proof.autoRigCalled === true || proof.cloud === true || proof.executeCloud === true) return false
  if (requestedAt && proof.requestedAt !== requestedAt) return false
  return proof.assetEditorOpened === true || proof.assetEditorOpenRequested === true
}

export function openCanonicalMetaHumanCharacter(projectId: string, requestedAt = new Date().toISOString()): {
  requestedAt: string
  assetPath: typeof HVS_RAEL_MHC_PATH
  executeCloud: false
  autoRigCalled: false
} {
  writeLikenessRequest(projectId, {
    op: 'hvs.unreal.character.conform',
    action: 'open_mhc',
    executeCloud: false,
    projectId,
    characterId: HVS_RAEL_PRODUCTION_CHARACTER_ID,
    mhc: HVS_RAEL_MHC_PATH,
    requestedAt,
  })
  return {
    requestedAt,
    assetPath: HVS_RAEL_MHC_PATH,
    executeCloud: false,
    autoRigCalled: false,
  }
}

function applyPersistedDna(result: HvsPersistedConformResult): HvsDnaRecord {
  return {
    present: result.dnaPresent,
    assetPath: result.dnaPresent ? result.dnaAssetPath : null,
    internalToCharacter: result.dnaInternal,
    rigLogic: result.dnaPresent ? result.rigLogic : 'UNRIGGED',
    faceMeshPath: result.faceMeshPath,
    bodyMeshPath: result.bodyMeshPath,
    note: result.dnaPresent
      ? (result.dnaInternal
        ? 'DNA is stored internally on the MetaHuman Character after official Auto-Rig. No separate .dna asset path was written.'
        : `DNA asset recorded at ${result.dnaAssetPath}.`)
      : 'DNA is not present. Result was not fabricated.',
  }
}

export class HvsMetaHumanLikenessAdapter {
  inspectPrerequisites(projectId: string): {
    mhcExists: boolean
    referencesAccepted: number
    identityFitted: boolean
  } {
    const face = readFaceReferenceSet(projectId)
    const accepted = HVS_FACE_REFERENCE_REQUIRED.filter(type => face.stills[type]?.accepted).length
    const proof = readLikenessProof(projectId)
    return {
      mhcExists: existsSync(HVS_MHC_UASSET),
      referencesAccepted: accepted,
      identityFitted: proof?.identityFitted === true,
    }
  }

  run(operation: HvsCharacterBuildOperation, options: HvsLikenessAdapterOptions = {}): HvsLikenessAdapterResult {
    const now = options.now ?? new Date().toISOString()
    const projectId = operation.projectId
    const characterId = operation.characterId || HVS_RAEL_PRODUCTION_CHARACTER_ID
    const receipts: HvsLikenessStageReceipt[] = []
    const notes: string[] = [
      'Original HVS JPEG stills remain local source references.',
      'Official AutoRig payload category is DERIVED_FACE_MESH_VERTICES, not JPEG bytes.',
    ]

    const authorityCheck = emptyLikenessReceipt('AUTHORITY_CHECK', now, 'RUNNING')
    const authorized = Boolean(operation.authority) || hasLikenessAuthority(projectId, characterId)
    if (!authorized) {
      authorityCheck.status = 'COMPLETE'
      authorityCheck.completedAt = now
      authorityCheck.errorCode = 'LIKELINESS_APPROVAL_REQUIRED'
      authorityCheck.notes = ['No METAHUMAN_LIKENESS_CLOUD authority. Zero cloud side effects.']
      receipts.push(authorityCheck)
      return {
        status: 'BLOCKED',
        likenessState: 'LIKELINESS_APPROVAL_REQUIRED',
        networkSideEffect: false,
        autoRigCalled: false,
        textureSynthesisCalled: false,
        payloadCategory: null,
        errorCode: 'LIKELINESS_APPROVAL_REQUIRED',
        operatorStep: "CONTINUE RA'EL BUILD",
        operatorGate: null,
        epicSignInRequired: false,
        dna: operation.dna ?? defaultDnaRecord(),
        receipts,
        submission: null,
        notes,
        assetPaths: [HVS_RAEL_MHC_PATH],
        officialGui: 'HEADLESS',
      }
    }
    authorityCheck.status = 'COMPLETE'
    authorityCheck.completedAt = now
    authorityCheck.notes = [`Authority ${operation.authority?.authorizationId ?? 'present'}. Scope LIKELINESS_CONFORM_AUTORIG_ONLY.`]
    receipts.push(authorityCheck)

    const prep = emptyLikenessReceipt('CONFORM_INPUT_PREP', now, 'RUNNING')
    const prereq = this.inspectPrerequisites(projectId)
    if (prereq.referencesAccepted < 5) {
      prep.status = 'FAILED'
      prep.completedAt = now
      prep.errorCode = 'FACE_REFERENCES_INCOMPLETE'
      receipts.push(prep)
      return {
        status: 'FAILED',
        likenessState: 'LIKELINESS_BLOCKED',
        networkSideEffect: false,
        autoRigCalled: false,
        textureSynthesisCalled: false,
        payloadCategory: HVS_CLOUD_PAYLOAD_CATEGORY,
        errorCode: 'FACE_REFERENCES_INCOMPLETE',
        operatorStep: 'Accept all five identity stills before likeness creation.',
        operatorGate: null,
        epicSignInRequired: false,
        dna: defaultDnaRecord(),
        receipts,
        submission: operation.cloudSubmission,
        notes,
        assetPaths: [HVS_RAEL_MHC_PATH],
        officialGui: 'HEADLESS',
      }
    }
    if (!prereq.mhcExists) {
      prep.status = 'BLOCKED'
      prep.completedAt = now
      prep.errorCode = 'MHC_NOT_CREATED'
      receipts.push(prep)
      return {
        status: 'BLOCKED',
        likenessState: 'LIKELINESS_BLOCKED',
        networkSideEffect: false,
        autoRigCalled: false,
        textureSynthesisCalled: false,
        payloadCategory: HVS_CLOUD_PAYLOAD_CATEGORY,
        errorCode: 'MHC_NOT_CREATED',
        operatorStep: 'MetaHuman foundation is missing.',
        operatorGate: null,
        epicSignInRequired: false,
        dna: defaultDnaRecord(),
        receipts,
        submission: operation.cloudSubmission,
        notes,
        assetPaths: [HVS_RAEL_MHC_PATH],
        officialGui: 'BOUNDED_OPERATOR_STEP',
      }
    }

    const identityFitted = options.identityFitted ?? prereq.identityFitted ?? options.persistResult?.identityFitted ?? false
    prep.status = 'COMPLETE'
    prep.completedAt = now
    prep.notes = [
      `${prereq.referencesAccepted}/5 accepted stills remain local.`,
      `MHC ${HVS_RAEL_MHC_PATH} ${prereq.mhcExists ? 'present' : 'missing'}.`,
      identityFitted
        ? 'Fitted Face Mesh / identity state is present for official AutoRig.'
        : 'Fitted Face Mesh is not proven. Creator landmark confirmation is required before cloud AutoRig.',
    ]
    receipts.push(prep)

    const existing = readCloudSubmission(projectId, characterId) ?? operation.cloudSubmission
    const hash = inputHash(projectId, operation.authority?.authorizationId ?? 'none')
    if (existing && (existing.status === 'COMPLETE' || existing.status === 'PENDING' || existing.status === 'RUNNING') && existing.inputHash === hash) {
      notes.push('Existing AutoRig submission reused. Duplicate cloud request refused.')
      const result = options.persistResult
      const dna = result ? applyPersistedDna(result) : (operation.dna ?? defaultDnaRecord())
      const done = existing.status === 'COMPLETE' && dna.present
      receipts.push({
        ...emptyLikenessReceipt('AUTORIG_SUBMIT', now, 'COMPLETE'),
        operationId: existing.submissionId,
        notes: ['Idempotent reuse of the existing provider submission.'],
      })
      receipts.push({
        ...emptyLikenessReceipt('AUTORIG_PROCESS', now, done ? 'COMPLETE' : 'RUNNING'),
        operationId: existing.providerRequestId,
      })
      receipts.push({
        ...emptyLikenessReceipt('AUTORIG_RESULT', now, done ? 'COMPLETE' : existing.status === 'COMPLETE' ? 'COMPLETE' : 'RUNNING'),
        operationId: existing.providerRequestId,
        outputAssetRefs: dna.present ? [HVS_RAEL_MHC_PATH] : [],
        notes: [dna.note],
      })
      return {
        status: done ? 'COMPLETE' : 'RUNNING',
        likenessState: done ? 'LIKELINESS_COMPLETE' : 'LIKELINESS_PROCESSING',
        networkSideEffect: false,
        autoRigCalled: false,
        textureSynthesisCalled: Boolean(existing.textureSynthesisCalled),
        payloadCategory: HVS_CLOUD_PAYLOAD_CATEGORY,
        errorCode: null,
        operatorStep: null,
        operatorGate: null,
        epicSignInRequired: false,
        dna,
        receipts,
        submission: existing,
        notes,
        assetPaths: [HVS_RAEL_MHC_PATH],
        officialGui: 'HEADLESS',
      }
    }

    if (options.persistResult) {
      return this.applyPersistedResult(operation, options.persistResult, receipts, notes, now, hash)
    }

    if (!identityFitted) {
      const gate: HvsLikenessOperatorGate = {
        kind: 'CREATOR_LANDMARK',
        headline: "RA'EL BUILD NEEDS YOUR ATTENTION",
        expectedAction: 'MetaHuman Creator needs one confirmation in Unreal. Place the local identity stills and confirm the official landmarks on MHC_Rael_Commander.',
        assetPath: HVS_RAEL_MHC_PATH,
      }
      receipts.push({
        ...emptyLikenessReceipt('AUTORIG_SUBMIT', now, 'BLOCKED'),
        errorCode: 'METAHUMAN_CREATOR_LANDMARK',
        notes: ['Cloud AutoRig was not invoked. A fitted Face Mesh is required first.'],
      })
      return {
        status: 'BLOCKED',
        likenessState: 'LIKELINESS_BLOCKED',
        networkSideEffect: false,
        autoRigCalled: false,
        textureSynthesisCalled: false,
        payloadCategory: HVS_CLOUD_PAYLOAD_CATEGORY,
        errorCode: 'METAHUMAN_CREATOR_LANDMARK',
        operatorStep: gate.expectedAction,
        operatorGate: gate,
        epicSignInRequired: false,
        dna: defaultDnaRecord(),
        receipts,
        submission: null,
        notes,
        assetPaths: [HVS_RAEL_MHC_PATH],
        officialGui: 'BOUNDED_OPERATOR_STEP',
      }
    }

    if (!options.executeLive) {
      receipts.push({
        ...emptyLikenessReceipt('AUTORIG_SUBMIT', now, 'BLOCKED'),
        errorCode: 'LIVE_CLOUD_NOT_EXECUTED',
        notes: ['Architecture path only. Live AutoRig is not invoked without an HVS AUTHORIZE click plus executeLive.'],
      })
      return {
        status: 'BLOCKED',
        likenessState: 'LIKELINESS_AUTHORIZED',
        networkSideEffect: false,
        autoRigCalled: false,
        textureSynthesisCalled: false,
        payloadCategory: HVS_CLOUD_PAYLOAD_CATEGORY,
        errorCode: 'LIVE_CLOUD_NOT_EXECUTED',
        operatorStep: null,
        operatorGate: null,
        epicSignInRequired: false,
        dna: defaultDnaRecord(),
        receipts,
        submission: null,
        notes: [...notes, 'Live Epic AutoRig was not started from this adapter call.'],
        assetPaths: [HVS_RAEL_MHC_PATH],
        officialGui: 'HEADLESS',
      }
    }

    const submission: HvsCloudSubmissionRecord = {
      submissionId: `sub-${randomUUID()}`,
      providerRequestId: null,
      inputHash: hash,
      status: 'PENDING',
      submittedAt: now,
      completedAt: null,
      payloadCategory: HVS_CLOUD_PAYLOAD_CATEGORY,
      networkSideEffect: true,
      textureSynthesisCalled: false,
    }
    writeCloudSubmission(projectId, characterId, submission)
    writeLikenessRequest(projectId, {
      op: 'hvs.unreal.character.conform' satisfies HvsUnrealCharacterOp,
      projectId,
      characterId,
      authorizationId: operation.authority?.authorizationId,
      executeCloud: true,
      textureSynthesis: true,
      reason: 'CINE assembly requires HasHighResolutionTextures after AutoRig.',
      payloadCategory: HVS_CLOUD_PAYLOAD_CATEGORY,
      mhc: HVS_RAEL_MHC_PATH,
      previewDir: characterPreviewDir(projectId, characterId),
      submittedAt: now,
      submissionId: submission.submissionId,
    })
    const process = inspectUnrealProcess(projectId)
    if (process.status === 'STOPPED' && options.launchUnreal) {
      startUnrealProcess(projectId, HVS_LIKENESS_PYTHON)
    }
    receipts.push({
      ...emptyLikenessReceipt('AUTORIG_SUBMIT', now, 'RUNNING'),
      operationId: submission.submissionId,
      notes: ['Official request_auto_rigging dispatched only after HVS authority + fitted Face Mesh.'],
    })
    receipts.push(emptyLikenessReceipt('AUTORIG_PROCESS', now, 'RUNNING'))
    receipts.push(emptyLikenessReceipt('AUTORIG_RESULT', now, 'PENDING'))
    return {
      status: 'RUNNING',
      likenessState: 'LIKELINESS_SUBMITTING',
      networkSideEffect: true,
      autoRigCalled: true,
      textureSynthesisCalled: false,
      payloadCategory: HVS_CLOUD_PAYLOAD_CATEGORY,
      errorCode: null,
      operatorStep: null,
      operatorGate: null,
      epicSignInRequired: false,
      dna: defaultDnaRecord(),
      receipts,
      submission,
      notes,
      assetPaths: [HVS_RAEL_MHC_PATH],
      officialGui: 'HEADLESS',
    }
  }

  applyPersistedResult(
    operation: HvsCharacterBuildOperation,
    result: HvsPersistedConformResult,
    prior: HvsLikenessStageReceipt[] = [],
    notes: string[] = [],
    now = new Date().toISOString(),
    hash = inputHash(operation.projectId, operation.authority?.authorizationId ?? 'mock'),
    commitBinding = false,
  ): HvsLikenessAdapterResult {
    const dna = applyPersistedDna(result)
    const submission: HvsCloudSubmissionRecord = {
      submissionId: operation.cloudSubmission?.submissionId ?? `sub-persisted-${randomUUID()}`,
      providerRequestId: result.providerRequestId,
      inputHash: hash,
      status: result.dnaPresent ? 'COMPLETE' : 'FAILED',
      submittedAt: now,
      completedAt: now,
      payloadCategory: HVS_CLOUD_PAYLOAD_CATEGORY,
      networkSideEffect: false,
      textureSynthesisCalled: result.textureSynthesisCalled,
    }
    writeCloudSubmission(operation.projectId, operation.characterId, submission)
    const receipts = [
      ...prior,
      { ...emptyLikenessReceipt('AUTORIG_SUBMIT', now, 'COMPLETE'), operationId: submission.submissionId, notes: ['Persisted / mock conform result. No live cloud call.'] },
      { ...emptyLikenessReceipt('AUTORIG_PROCESS', now, 'COMPLETE'), operationId: result.providerRequestId },
      {
        ...emptyLikenessReceipt('AUTORIG_RESULT', now, result.dnaPresent ? 'COMPLETE' : 'FAILED'),
        operationId: result.providerRequestId,
        outputAssetRefs: [HVS_RAEL_MHC_PATH],
        notes: [dna.note, result.textureSynthesisCalled ? 'Texture synthesis was part of the persisted CINE result.' : 'Texture synthesis was not invoked.'],
      },
    ]
    if (result.dnaPresent && commitBinding) {
      const binding = ensureMetaHumanBinding(operation.projectId)
      writeMetaHumanBinding({
        ...binding,
        likeness: 'CONFORMED',
        rigLogic: {
          architecture: 'RIGLOGIC',
          dnaAssetPath: dna.assetPath,
          dnaPresent: true,
          note: dna.note,
        },
        conformGate: undefined,
      })
    }
    return {
      status: result.dnaPresent ? 'COMPLETE' : 'FAILED',
      likenessState: result.dnaPresent ? 'LIKELINESS_COMPLETE' : 'LIKELINESS_BLOCKED',
      networkSideEffect: false,
      autoRigCalled: false,
      textureSynthesisCalled: result.textureSynthesisCalled,
      payloadCategory: HVS_CLOUD_PAYLOAD_CATEGORY,
      errorCode: result.dnaPresent ? null : 'LIKENESS_NOT_VERIFIED',
      operatorStep: result.dnaPresent ? null : 'Likeness result was not verified in Unreal.',
      operatorGate: null,
      epicSignInRequired: false,
      dna,
      receipts,
      submission,
      notes: [...notes, 'Persisted conform result applied. DNA was not invented beyond the supplied proof.'],
      assetPaths: [HVS_RAEL_MHC_PATH],
      officialGui: 'HEADLESS',
    }
  }

  observe(operation: HvsCharacterBuildOperation): HvsLikenessAdapterResult | null {
    const proof = readLikenessProof(operation.projectId)
    if (!proof) return null
    if (proof.errorCode === 'Unauthorized' || proof.epicSignInRequired === true) {
      return {
        status: 'BLOCKED',
        likenessState: 'LIKELINESS_BLOCKED',
        networkSideEffect: false,
        autoRigCalled: Boolean(proof.autoRigCalled),
        textureSynthesisCalled: Boolean(proof.textureSynthesisCalled),
        payloadCategory: HVS_CLOUD_PAYLOAD_CATEGORY,
        errorCode: 'EPIC_SIGN_IN_REQUIRED',
        operatorStep: 'Sign in to Epic inside Unreal, then resume.',
        operatorGate: {
          kind: 'EPIC_SIGN_IN',
          headline: 'EPIC SIGN-IN REQUIRED',
          expectedAction: 'Sign in to your Epic account in MetaHuman Creator, then return here.',
          assetPath: HVS_RAEL_MHC_PATH,
        },
        epicSignInRequired: true,
        dna: defaultDnaRecord(),
        receipts: operation.likenessReceipts,
        submission: operation.cloudSubmission,
        notes: ['Epic service authentication is required. Credentials are not requested in HVS.'],
        assetPaths: [HVS_RAEL_MHC_PATH],
        officialGui: 'BOUNDED_OPERATOR_STEP',
      }
    }
    if (proof.ok === true && proof.dnaPresent === true) {
      return this.applyPersistedResult(operation, {
        dnaPresent: true,
        dnaInternal: proof.dnaAssetPath == null,
        dnaAssetPath: typeof proof.dnaAssetPath === 'string' ? proof.dnaAssetPath : null,
        rigLogic: proof.rigLogic === 'RIGGED' ? 'RIGGED' : 'UNKNOWN',
        faceMeshPath: typeof proof.faceMeshPath === 'string' ? proof.faceMeshPath : null,
        bodyMeshPath: typeof proof.bodyMeshPath === 'string' ? proof.bodyMeshPath : null,
        identityFitted: proof.identityFitted === true,
        cineAssembled: proof.cineAssembled === true,
        assembledBlueprintPath: typeof proof.assembledBlueprintPath === 'string' ? proof.assembledBlueprintPath : null,
        providerRequestId: typeof proof.providerRequestId === 'string' ? proof.providerRequestId : null,
        textureSynthesisCalled: proof.textureSynthesisCalled === true,
      }, operation.likenessReceipts, ['Unreal likeness proof observed.'], new Date().toISOString(), inputHash(operation.projectId, operation.authority?.authorizationId ?? 'observe'), true)
    }
    return null
  }

  openRequiredStep(projectId: string, options: { launch?: boolean } = {}): HvsOperatorStepResult {
    const requestedAt = new Date().toISOString()
    const before = inspectUnrealProcess(projectId)
    let process = before
    let launched = false
    let duplicateRefused = false
    let focused = false
    if (options.launch !== false) {
      process = ensureInteractiveUnrealEditor(projectId, HVS_LIKENESS_PYTHON)
      launched = process.startedThisCall === true
      duplicateRefused = process.duplicateRefused === true || before.status === 'RUNNING' || before.status === 'UNRESPONSIVE'
      focused = focusUnrealWindow()
    }
    openCanonicalMetaHumanCharacter(projectId, requestedAt)
    const after = inspectUnrealProcess(projectId)
    if (after.status !== 'STOPPED') process = after
    const ok = launched || process.status === 'RUNNING' || (duplicateRefused && process.status !== 'STOPPED')
    return {
      launched,
      focused,
      duplicateRefused,
      assetPath: HVS_RAEL_MHC_PATH,
      executeCloud: false,
      autoRigCalled: false,
      processStatus: process.status,
      ok,
      errorCode: ok ? null : 'UNREAL_COULD_NOT_STAY_OPEN',
      requestedAt,
      command: process.command,
    }
  }

  requestEpicSignIn(projectId: string): { launched: boolean } {
    writeLikenessRequest(projectId, {
      op: 'hvs.unreal.character.conform',
      action: 'epic_signin',
      executeCloud: false,
      projectId,
      characterId: HVS_RAEL_PRODUCTION_CHARACTER_ID,
    })
    const process = inspectUnrealProcess(projectId)
    if (process.status === 'STOPPED') startUnrealProcess(projectId, HVS_LIKENESS_PYTHON)
    return { launched: true }
  }
}

export const hvsMetaHumanLikenessAdapter = new HvsMetaHumanLikenessAdapter()

export function ensureAuthorityOnOperation(operation: HvsCharacterBuildOperation, now: string): HvsCharacterBuildOperation {
  if (operation.authority) {
    writeLikenessAuthority(operation.authority)
    return operation
  }
  operation.authority = createLikenessAuthority({
    projectId: operation.projectId,
    characterId: operation.characterId,
    now,
  })
  return operation
}

