/**
 * HVS-RAEL-HUMAN-02 — bind accepted stills + MHC foundation + TAKE 3 body fallback.
 * Does not write .hvsproj. Does not overwrite Manny binding. Does not invent DNA.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { RAEL_CHARACTER_ID } from '../digital-human/types'
import { HVS_FACE_REFERENCE_REQUIRED, jpegDimensions, readFaceReferenceSet } from '../digital-human/face-reference'
import { HVS_UE01_MOTION_ID, HVS_UE01_PROJECT_ID, HVS_UE01_TAKE_ID } from './package'
import { readUnrealScenePackage } from './storage'
import {
  HVS_HUMAN02_BRIDGE,
  HVS_HUMAN02_PROOF,
  HVS_MHC_RESERVED_DIR,
  HVS_MHC_RESERVED_MARKER,
  HVS_MHC_RESERVED_PATH,
  HVS_MHC_UASSET,
  ensureMetaHumanBinding,
  writeMetaHumanBinding,
  type HvsLikenessStillBind,
} from './metahuman-binding'

function main() {
  const face = readFaceReferenceSet(HVS_UE01_PROJECT_ID)
  const required = HVS_FACE_REFERENCE_REQUIRED.filter(type => face.stills[type]?.accepted)
  if (required.length !== 5) throw new Error(`face set is ${required.length}/5`)
  const stills: HvsLikenessStillBind[] = Object.values(face.stills).map(still => {
    const buf = existsSync(still.file) ? readFileSync(still.file) : Buffer.alloc(0)
    const dims = jpegDimensions(buf)
    return {
      type: still.type,
      file: still.file,
      texturePath: `/Game/HVS/Characters/Rael/FaceReference/${still.type}`,
      accepted: still.accepted,
      bytes: existsSync(still.file) ? statSync(still.file).size : 0,
      width: dims?.width ?? still.quality.width,
      height: dims?.height ?? still.quality.height,
    }
  })
  const proof = existsSync(HVS_HUMAN02_PROOF)
    ? JSON.parse(readFileSync(HVS_HUMAN02_PROOF, 'utf8')) as Record<string, unknown>
    : null
  const mhcCreated = existsSync(HVS_MHC_UASSET) || Boolean((proof?.mhc as { created?: boolean } | undefined)?.created)
  const manny = readUnrealScenePackage(HVS_UE01_PROJECT_ID)?.characters[0]?.binding
  const binding = ensureMetaHumanBinding(HVS_UE01_PROJECT_ID)
  const next = {
    ...binding,
    assetState: mhcCreated ? 'CREATED' as const : 'RESERVED' as const,
    faceCapture: 'REFERENCE_CAPTURED' as const,
    likeness: 'NOT_FINAL' as const,
    animator: 'NOT_STARTED' as const,
    liveLink: 'NOT_ENABLED' as const,
    assemblyPipeline: 'CINE' as const,
    wardrobeIntent: 'RAEL_BLACK_SUIT' as const,
    bodyOverrideFromWebcam: false as const,
    mannyPreserved: true as const,
    take3Preserved: true as const,
    sourceOfTruth: 'HVS' as const,
    rigLogic: {
      architecture: 'RIGLOGIC' as const,
      dnaAssetPath: null,
      dnaPresent: false,
      note: mhcCreated
        ? 'Official MHC container exists. Rael-specific DNA is not assembled. Do not invent DNA.'
        : 'DNA is not assembled yet. Do not invent DNA.',
    },
    likenessInput: {
      source: 'FACE_REFERENCE_STILLS' as const,
      localOnly: true as const,
      acceptedRequired: required.length,
      required: [...HVS_FACE_REFERENCE_REQUIRED],
      stills,
    },
    bodyExecution: {
      primary: 'METAHUMAN_PENDING_DNA' as const,
      fallback: 'MANNY_BODY_TEST_REFERENCE' as const,
      takeId: HVS_UE01_TAKE_ID,
      motionId: HVS_UE01_MOTION_ID,
      sourceAnimation: '/Game/HVS/Animation/AN_Rael_Take3' as const,
      mannyAnimation: '/Game/HVS/Animation/AN_Rael_Take3_Manny' as const,
      ikRetargeterPath: '/Game/HVS/Characters/Rigs/RTG_HVS_To_Manny' as const,
    },
    conformGate: {
      status: 'BLOCKED' as const,
      code: 'METAHUMAN_CREATOR_AUTORIG_CLOUD_OR_UI' as const,
      cloudRequired: true,
      animatorRequired: false as const,
      message: 'Photo-to-MetaHuman likeness requires MetaHuman Creator UI landmark work plus Epic AutoRigService, which is a cloud identity/auto-rig path. Animator Identity Solve is not authorized. Stills remain local source input only.',
    },
  }
  writeMetaHumanBinding(next)
  mkdirSync(HVS_MHC_RESERVED_DIR, { recursive: true })
  const marker = {
    reservedPath: HVS_MHC_RESERVED_PATH,
    characterId: RAEL_CHARACTER_ID,
    identityId: RAEL_CHARACTER_ID,
    asset: 'MetaHuman Character',
    state: next.assetState,
    likeness: 'NOT_FINAL',
    stillsBound: required.length,
    note: mhcCreated
      ? 'Official MHC container advanced. Likeness is not conformed. Manny remains TAKE 3 body fallback.'
      : 'Path reserved. MHC uasset not created this slice. Manny remains TAKE 3 body fallback.',
    uproject: '/home/chosenone/HVSRuntime/HVSRuntime.uproject',
  }
  writeFileSync(HVS_MHC_RESERVED_MARKER, `${JSON.stringify(marker, null, 2)}\n`)
  const bridge = {
    version: 'HVS-RAEL-HUMAN-02',
    characterId: RAEL_CHARACTER_ID,
    identityId: RAEL_CHARACTER_ID,
    projectId: HVS_UE01_PROJECT_ID,
    metahumanCharacterPath: HVS_MHC_RESERVED_PATH,
    assetState: next.assetState,
    uasset: existsSync(HVS_MHC_UASSET) ? HVS_MHC_UASSET : null,
    assemblyPipeline: 'CINE',
    wardrobeIntent: 'RAEL_BLACK_SUIT',
    likeness: 'NOT_FINAL',
    faceCapture: 'REFERENCE_CAPTURED',
    animator: 'NOT_STARTED',
    liveLink: 'NOT_ENABLED',
    dnaPresent: false,
    take3: {
      takeId: HVS_UE01_TAKE_ID,
      motionId: HVS_UE01_MOTION_ID,
      sourceAnimation: '/Game/HVS/Animation/AN_Rael_Take3',
      mannyAnimation: '/Game/HVS/Animation/AN_Rael_Take3_Manny',
    },
    manny: {
      preserved: true,
      role: 'BODY_TEST_REFERENCE',
      adapter: manny?.adapter ?? 'GENERIC_UE_HUMANOID',
      metahumanCharacterPath: manny?.metahumanCharacterPath ?? null,
      skeletalMeshPath: manny?.skeletalMeshPath ?? null,
      animationSequencePath: manny?.animationSequencePath ?? null,
    },
    localOnly: true,
    cloud: false,
    embeddings: false,
    identityRecognition: false,
  }
  writeFileSync(HVS_HUMAN02_BRIDGE, `${JSON.stringify(bridge, null, 2)}\n`)
  console.log(JSON.stringify({
    ok: true,
    assetState: next.assetState,
    acceptedRequired: required.length,
    mhcUasset: existsSync(HVS_MHC_UASSET),
    mannyMhcPath: manny?.metahumanCharacterPath ?? null,
    binding: path.join(path.dirname(HVS_HUMAN02_BRIDGE), 'metahuman-binding.json'),
    bridge: HVS_HUMAN02_BRIDGE,
    proof: existsSync(HVS_HUMAN02_PROOF),
  }, null, 2))
}

main()
