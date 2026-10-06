/**
 * MetaHuman is an Unreal execution representation of the single Ra'el identity.
 * Stored beside the Manny scene package. Never written into .hvsproj.
 * Never overwrites GENERIC_UE_HUMANOID / metahumanCharacterPath on the Manny binding.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { RAEL_CHARACTER_ID } from '../digital-human/types'
import { HVS_UE01_PROJECT_ID, HVS_UE02_UPROJECT } from './package'
import { unrealPackageDir } from './storage'
import { HVS_RESERVED_MHC_PATH } from './metahuman-detect'

export const HVS_METAHUMAN_BINDING_VERSION = 1 as const
export const HVS_METAHUMAN_ADAPTER = 'METAHUMAN_CHARACTER' as const
export const HVS_MHC_RESERVED_PATH = HVS_RESERVED_MHC_PATH
export const HVS_MHC_RESERVED_DIR = '/home/chosenone/HVSRuntime/Content/HVS/Characters/Rael'
export const HVS_MHC_RESERVED_MARKER = path.join(HVS_MHC_RESERVED_DIR, 'MHC_Rael_Commander.reserved.json')
export const HVS_MHC_UASSET = path.join(HVS_MHC_RESERVED_DIR, 'MHC_Rael_Commander.uasset')
export const HVS_HUMAN02_PROOF = '/home/chosenone/HVSRuntime/Saved/HVS/human02-proof.json'
export const HVS_HUMAN02_BRIDGE = path.join(HVS_MHC_RESERVED_DIR, 'hvs-human02-execution-bridge.json')

export type HvsLikenessStillBind = {
  type: string
  file: string
  texturePath: string | null
  accepted: boolean
  bytes: number
  width: number
  height: number
}

export type HvsMetaHumanBinding = {
  version: typeof HVS_METAHUMAN_BINDING_VERSION
  characterId: typeof RAEL_CHARACTER_ID
  identityId: typeof RAEL_CHARACTER_ID
  projectId: string
  executionRepresentation: 'METAHUMAN'
  notASecondIdentity: true
  adapter: typeof HVS_METAHUMAN_ADAPTER
  metahumanCharacterPath: typeof HVS_MHC_RESERVED_PATH
  assetState: 'RESERVED' | 'CREATED' | 'NOT_CREATED'
  assemblyPipeline: 'CINE'
  body: 'NEUTRAL'
  bodyOverrideFromWebcam: false
  groom: 'NEUTRAL'
  wardrobeIntent: 'RAEL_BLACK_SUIT'
  rigLogic: {
    architecture: 'RIGLOGIC'
    dnaAssetPath: string | null
    dnaPresent: boolean
    note: string
  }
  faceCapture: 'REFERENCE_CAPTURE_REQUIRED' | 'REFERENCE_CAPTURED' | 'NOT_SOLVED'
  animator: 'NOT_STARTED'
  liveLink: 'NOT_ENABLED'
  likeness: 'NOT_FINAL' | 'CONFORMED'
  officialOnly: true
  mannyPreserved: true
  take3Preserved: true
  sourceOfTruth: 'HVS'
  likenessInput?: {
    source: 'FACE_REFERENCE_STILLS'
    localOnly: true
    acceptedRequired: number
    required: string[]
    stills: HvsLikenessStillBind[]
  }
  bodyExecution?: {
    primary: 'METAHUMAN_PENDING_DNA'
    fallback: 'MANNY_BODY_TEST_REFERENCE'
    takeId: string
    motionId: string
    sourceAnimation: '/Game/HVS/Animation/AN_Rael_Take3'
    mannyAnimation: '/Game/HVS/Animation/AN_Rael_Take3_Manny'
    ikRetargeterPath: '/Game/HVS/Characters/Rigs/RTG_HVS_To_Manny'
  }
  conformGate?: {
    status: 'BLOCKED'
    code: 'METAHUMAN_CREATOR_AUTORIG_CLOUD_OR_UI'
    cloudRequired: boolean
    animatorRequired: false
    message: string
  }
}

export function metaHumanBindingPath(projectId: string): string {
  return path.join(unrealPackageDir(projectId), 'metahuman-binding.json')
}

export function defaultMetaHumanBinding(projectId = HVS_UE01_PROJECT_ID): HvsMetaHumanBinding {
  return {
    version: HVS_METAHUMAN_BINDING_VERSION,
    characterId: RAEL_CHARACTER_ID,
    identityId: RAEL_CHARACTER_ID,
    projectId,
    executionRepresentation: 'METAHUMAN',
    notASecondIdentity: true,
    adapter: HVS_METAHUMAN_ADAPTER,
    metahumanCharacterPath: HVS_MHC_RESERVED_PATH,
    assetState: 'RESERVED',
    assemblyPipeline: 'CINE',
    body: 'NEUTRAL',
    bodyOverrideFromWebcam: false,
    groom: 'NEUTRAL',
    wardrobeIntent: 'RAEL_BLACK_SUIT',
    rigLogic: {
      architecture: 'RIGLOGIC',
      dnaAssetPath: null,
      dnaPresent: false,
      note: 'DNA is not assembled yet. Do not invent DNA.',
    },
    faceCapture: 'REFERENCE_CAPTURE_REQUIRED',
    animator: 'NOT_STARTED',
    liveLink: 'NOT_ENABLED',
    likeness: 'NOT_FINAL',
    officialOnly: true,
    mannyPreserved: true,
    take3Preserved: true,
    sourceOfTruth: 'HVS',
  }
}

export function readMetaHumanBinding(projectId: string): HvsMetaHumanBinding | null {
  const file = metaHumanBindingPath(projectId)
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, 'utf8')) as HvsMetaHumanBinding
}

export function writeMetaHumanBinding(binding: HvsMetaHumanBinding): string {
  const file = metaHumanBindingPath(binding.projectId)
  writeFileSync(file, `${JSON.stringify(binding, null, 2)}\n`)
  return file
}

export function reserveMetaHumanCharacterAsset(): { marker: string; path: string; created: boolean } {
  mkdirSync(HVS_MHC_RESERVED_DIR, { recursive: true })
  const created = !existsSync(HVS_MHC_RESERVED_MARKER)
  let state: 'RESERVED' | 'CREATED' = existsSync(HVS_MHC_UASSET) ? 'CREATED' : 'RESERVED'
  const marker = {
    reservedPath: HVS_MHC_RESERVED_PATH,
    characterId: RAEL_CHARACTER_ID,
    identityId: RAEL_CHARACTER_ID,
    asset: 'MetaHuman Character',
    state,
    likeness: 'NOT_FINAL',
    note: state === 'CREATED'
      ? 'Official MHC container exists. Likeness is not sculpted. Manny remains the TAKE 3 body fallback.'
      : 'Path reserved for one Ra\'el MetaHuman Character. Likeness is not sculpted. Manny remains the execution test body.',
    uproject: HVS_UE02_UPROJECT,
  }
  writeFileSync(HVS_MHC_RESERVED_MARKER, `${JSON.stringify(marker, null, 2)}\n`)
  return { marker: HVS_MHC_RESERVED_MARKER, path: HVS_MHC_RESERVED_PATH, created }
}

export function ensureMetaHumanBinding(projectId = HVS_UE01_PROJECT_ID): HvsMetaHumanBinding {
  reserveMetaHumanCharacterAsset()
  const existing = readMetaHumanBinding(projectId)
  if (existing && existing.characterId === RAEL_CHARACTER_ID && existing.identityId === RAEL_CHARACTER_ID) {
    return existing
  }
  const binding = defaultMetaHumanBinding(projectId)
  writeMetaHumanBinding(binding)
  return binding
}

export function markFaceReferenceState(projectId: string, state: HvsMetaHumanBinding['faceCapture']): HvsMetaHumanBinding {
  const binding = { ...ensureMetaHumanBinding(projectId), faceCapture: state }
  writeMetaHumanBinding(binding)
  return binding
}
