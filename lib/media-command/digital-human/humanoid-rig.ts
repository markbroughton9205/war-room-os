/**
 * HVS-owned humanoid body representation.
 * Identity stays on HvsDigitalHuman. This file is skeleton + proportions only.
 */
import type { HvsProject } from '../types'
import {
  HVS_HUMANOID,
  HVS_HUMANOID_RIG_ID,
  HVS_HUMANOID_RIG_V1,
  HVS_NEUTRAL_HUMANOID,
  HVS_PREVIEW_WARDROBE_NOTE,
  RAEL_CHARACTER_ID,
  type HvsDigitalHuman,
  type HvsDigitalHumanStore,
  type HvsPerformanceTake,
  type HvsRigBinding,
} from './types'

export const HVS_HUMANOID_BONES = [
  'ROOT',
  'PELVIS',
  'SPINE_01',
  'SPINE_02',
  'CHEST',
  'NECK',
  'HEAD',
  'LEFT_CLAVICLE',
  'LEFT_SHOULDER',
  'LEFT_ELBOW',
  'LEFT_WRIST',
  'RIGHT_CLAVICLE',
  'RIGHT_SHOULDER',
  'RIGHT_ELBOW',
  'RIGHT_WRIST',
  'LEFT_HIP',
  'LEFT_KNEE',
  'LEFT_ANKLE',
  'LEFT_FOOT',
  'RIGHT_HIP',
  'RIGHT_KNEE',
  'RIGHT_ANKLE',
  'RIGHT_FOOT',
] as const

export type HvsHumanoidBone = (typeof HVS_HUMANOID_BONES)[number]

export const HVS_HUMANOID_PARENT: Record<HvsHumanoidBone, HvsHumanoidBone | null> = {
  ROOT: null,
  PELVIS: 'ROOT',
  SPINE_01: 'PELVIS',
  SPINE_02: 'SPINE_01',
  CHEST: 'SPINE_02',
  NECK: 'CHEST',
  HEAD: 'NECK',
  LEFT_CLAVICLE: 'CHEST',
  LEFT_SHOULDER: 'LEFT_CLAVICLE',
  LEFT_ELBOW: 'LEFT_SHOULDER',
  LEFT_WRIST: 'LEFT_ELBOW',
  RIGHT_CLAVICLE: 'CHEST',
  RIGHT_SHOULDER: 'RIGHT_CLAVICLE',
  RIGHT_ELBOW: 'RIGHT_SHOULDER',
  RIGHT_WRIST: 'RIGHT_ELBOW',
  LEFT_HIP: 'PELVIS',
  LEFT_KNEE: 'LEFT_HIP',
  LEFT_ANKLE: 'LEFT_KNEE',
  LEFT_FOOT: 'LEFT_ANKLE',
  RIGHT_HIP: 'PELVIS',
  RIGHT_KNEE: 'RIGHT_HIP',
  RIGHT_ANKLE: 'RIGHT_KNEE',
  RIGHT_FOOT: 'RIGHT_ANKLE',
}

export const HVS_LANDMARK_TO_BONE: Record<string, HvsHumanoidBone> = {
  HEAD: 'HEAD',
  NECK: 'NECK',
  CHEST: 'CHEST',
  PELVIS: 'PELVIS',
  LEFT_SHOULDER: 'LEFT_SHOULDER',
  LEFT_ELBOW: 'LEFT_ELBOW',
  LEFT_WRIST: 'LEFT_WRIST',
  RIGHT_SHOULDER: 'RIGHT_SHOULDER',
  RIGHT_ELBOW: 'RIGHT_ELBOW',
  RIGHT_WRIST: 'RIGHT_WRIST',
  LEFT_HIP: 'LEFT_HIP',
  LEFT_KNEE: 'LEFT_KNEE',
  LEFT_ANKLE: 'LEFT_ANKLE',
  RIGHT_HIP: 'RIGHT_HIP',
  RIGHT_KNEE: 'RIGHT_KNEE',
  RIGHT_ANKLE: 'RIGHT_ANKLE',
}

/**
 * Spec anatomical names map onto the landmark-aligned canonical bones.
 * Canonical ids stay LEFT_SHOULDER / LEFT_ELBOW / LEFT_HIP / LEFT_KNEE so
 * TAKE 3 landmarks, Unreal Manny, and existing validators share one skeleton.
 */
export const HVS_HUMANOID_SPEC_ALIAS: Record<string, HvsHumanoidBone> = {
  LEFT_UPPER_ARM: 'LEFT_SHOULDER',
  LEFT_FOREARM: 'LEFT_ELBOW',
  RIGHT_UPPER_ARM: 'RIGHT_SHOULDER',
  RIGHT_FOREARM: 'RIGHT_ELBOW',
  LEFT_UPPER_LEG: 'LEFT_HIP',
  LEFT_LOWER_LEG: 'LEFT_KNEE',
  RIGHT_UPPER_LEG: 'RIGHT_HIP',
  RIGHT_LOWER_LEG: 'RIGHT_KNEE',
}

export const HVS_HUMANOID_SEGMENTS: Array<[HvsHumanoidBone, HvsHumanoidBone, 'torso' | 'arm' | 'leg' | 'head' | 'foot']> = [
  ['PELVIS', 'SPINE_01', 'torso'],
  ['SPINE_01', 'SPINE_02', 'torso'],
  ['SPINE_02', 'CHEST', 'torso'],
  ['CHEST', 'NECK', 'torso'],
  ['NECK', 'HEAD', 'head'],
  ['CHEST', 'LEFT_CLAVICLE', 'torso'],
  ['LEFT_CLAVICLE', 'LEFT_SHOULDER', 'torso'],
  ['LEFT_SHOULDER', 'LEFT_ELBOW', 'arm'],
  ['LEFT_ELBOW', 'LEFT_WRIST', 'arm'],
  ['CHEST', 'RIGHT_CLAVICLE', 'torso'],
  ['RIGHT_CLAVICLE', 'RIGHT_SHOULDER', 'torso'],
  ['RIGHT_SHOULDER', 'RIGHT_ELBOW', 'arm'],
  ['RIGHT_ELBOW', 'RIGHT_WRIST', 'arm'],
  ['PELVIS', 'LEFT_HIP', 'leg'],
  ['LEFT_HIP', 'LEFT_KNEE', 'leg'],
  ['LEFT_KNEE', 'LEFT_ANKLE', 'leg'],
  ['LEFT_ANKLE', 'LEFT_FOOT', 'foot'],
  ['PELVIS', 'RIGHT_HIP', 'leg'],
  ['RIGHT_HIP', 'RIGHT_KNEE', 'leg'],
  ['RIGHT_KNEE', 'RIGHT_ANKLE', 'leg'],
  ['RIGHT_ANKLE', 'RIGHT_FOOT', 'foot'],
]

/** Neutral rest pose in HVS local units. Not a metric body scan. */
export const HVS_NEUTRAL_REST: Record<HvsHumanoidBone, { x: number; y: number; z: number }> = {
  ROOT: { x: 0, y: 0, z: 0 },
  PELVIS: { x: 0, y: 0.95, z: 0 },
  SPINE_01: { x: 0, y: 1.12, z: 0.01 },
  SPINE_02: { x: 0, y: 1.28, z: 0.02 },
  CHEST: { x: 0, y: 1.44, z: 0.02 },
  NECK: { x: 0, y: 1.58, z: 0.01 },
  HEAD: { x: 0, y: 1.74, z: 0 },
  LEFT_CLAVICLE: { x: -0.08, y: 1.5, z: 0.02 },
  LEFT_SHOULDER: { x: -0.18, y: 1.48, z: 0.02 },
  LEFT_ELBOW: { x: -0.2, y: 1.18, z: 0.04 },
  LEFT_WRIST: { x: -0.2, y: 0.9, z: 0.03 },
  RIGHT_CLAVICLE: { x: 0.08, y: 1.5, z: 0.02 },
  RIGHT_SHOULDER: { x: 0.18, y: 1.48, z: 0.02 },
  RIGHT_ELBOW: { x: 0.2, y: 1.18, z: 0.04 },
  RIGHT_WRIST: { x: 0.2, y: 0.9, z: 0.03 },
  LEFT_HIP: { x: -0.09, y: 0.94, z: 0 },
  LEFT_KNEE: { x: -0.1, y: 0.52, z: 0.02 },
  LEFT_ANKLE: { x: -0.1, y: 0.08, z: 0 },
  LEFT_FOOT: { x: -0.1, y: 0.03, z: 0.1 },
  RIGHT_HIP: { x: 0.09, y: 0.94, z: 0 },
  RIGHT_KNEE: { x: 0.1, y: 0.52, z: 0.02 },
  RIGHT_ANKLE: { x: 0.1, y: 0.08, z: 0 },
  RIGHT_FOOT: { x: 0.1, y: 0.03, z: 0.1 },
}

export const HVS_NEUTRAL_SHOULDER_WIDTH = 0.36

export type HvsHumanoidRigSchema = {
  rigId: typeof HVS_HUMANOID_RIG_ID
  id: typeof HVS_HUMANOID_RIG_ID
  type: typeof HVS_HUMANOID_RIG_V1
  rigClass: typeof HVS_HUMANOID
  owner: 'HVS'
  identityOwner: typeof RAEL_CHARACTER_ID | string
  proportionSource: typeof HVS_NEUTRAL_HUMANOID
  bodyProportionSource: typeof HVS_NEUTRAL_HUMANOID
  metricBody: false
  photoreal: false
  faceRig: false
  handRig: false
  voiceRig: false
  faces: false
  hands: false
  fingers: false
  voice: false
  bones: readonly HvsHumanoidBone[]
  parents: typeof HVS_HUMANOID_PARENT
  specAliases: typeof HVS_HUMANOID_SPEC_ALIAS
}

export function humanoidRigSchema(characterId: string = RAEL_CHARACTER_ID): HvsHumanoidRigSchema {
  return {
    rigId: HVS_HUMANOID_RIG_ID,
    id: HVS_HUMANOID_RIG_ID,
    type: HVS_HUMANOID_RIG_V1,
    rigClass: HVS_HUMANOID,
    owner: 'HVS',
    identityOwner: characterId,
    proportionSource: HVS_NEUTRAL_HUMANOID,
    bodyProportionSource: HVS_NEUTRAL_HUMANOID,
    metricBody: false,
    photoreal: false,
    faceRig: false,
    handRig: false,
    voiceRig: false,
    faces: false,
    hands: false,
    fingers: false,
    voice: false,
    bones: HVS_HUMANOID_BONES,
    parents: HVS_HUMANOID_PARENT,
    specAliases: HVS_HUMANOID_SPEC_ALIAS,
  }
}

export function validateHumanoidHierarchy(): { ok: boolean; missing: string[]; duplicate: string[]; cycles: string[] } {
  const seen = new Set<string>()
  const duplicate: string[] = []
  for (const bone of HVS_HUMANOID_BONES) {
    if (seen.has(bone)) duplicate.push(bone)
    seen.add(bone)
  }
  const missing: string[] = []
  for (const bone of HVS_HUMANOID_BONES) {
    const parent = HVS_HUMANOID_PARENT[bone]
    if (parent && !seen.has(parent)) missing.push(`${bone}→${parent}`)
  }
  const cycles: string[] = []
  for (const bone of HVS_HUMANOID_BONES) {
    const path: string[] = []
    let cursor: HvsHumanoidBone | null = bone
    while (cursor) {
      if (path.includes(cursor)) {
        cycles.push(bone)
        break
      }
      path.push(cursor)
      cursor = HVS_HUMANOID_PARENT[cursor]
    }
  }
  const required: HvsHumanoidBone[] = ['ROOT', 'PELVIS', 'CHEST', 'NECK', 'HEAD', 'LEFT_SHOULDER', 'LEFT_ELBOW', 'LEFT_WRIST', 'RIGHT_SHOULDER', 'RIGHT_ELBOW', 'RIGHT_WRIST', 'LEFT_HIP', 'LEFT_KNEE', 'LEFT_ANKLE', 'RIGHT_HIP', 'RIGHT_KNEE', 'RIGHT_ANKLE']
  for (const bone of required) {
    if (!seen.has(bone)) missing.push(bone)
  }
  return { ok: duplicate.length === 0 && missing.length === 0 && cycles.length === 0, missing, duplicate, cycles }
}

export function humanoidRigBinding(): HvsRigBinding {
  return {
    state: 'BOUND',
    modelRef: HVS_HUMANOID_RIG_ID,
    skeletonRef: HVS_HUMANOID_RIG_ID,
    faceRigRef: null,
    blendshapeMap: {},
    motionRetargetProfile: HVS_HUMANOID_RIG_V1,
    sceneNodeId: null,
    bodyProportionSource: HVS_NEUTRAL_HUMANOID,
    wardrobePreviewNote: HVS_PREVIEW_WARDROBE_NOTE,
  }
}

export function bindHumanoidRig(store: HvsDigitalHumanStore, characterId: string = RAEL_CHARACTER_ID): HvsDigitalHuman {
  const human = store.characters.find(item => item.id === characterId)
  if (!human) throw new Error('Character not found.')
  const sceneNodeId = human.rigBinding.sceneNodeId
  human.rigBinding = { ...humanoidRigBinding(), sceneNodeId }
  if (!human.representations.some(item => item.kind === 'RIG' && item.note.includes(HVS_HUMANOID_RIG_V1))) {
    human.representations.push({
      id: `rig-${HVS_HUMANOID_RIG_ID}`,
      kind: 'RIG',
      assetId: null,
      note: `${HVS_HUMANOID_RIG_V1} body representation. Neutral HVS proportions. Not identity. Not photoreal.`,
    })
  }
  if (!human.representations.some(item => item.id === 'mesh-hvs-stylized-body-v1')) {
    human.representations.push({
      id: 'mesh-hvs-stylized-body-v1',
      kind: '3D_MODEL',
      assetId: null,
      note: 'HVS_STYLIZED_BODY_V1 runtime skinned body. Binds to hvs-humanoid-rig-v1. Not identity. Not photoreal. Not baked animation.',
    })
  }
  if (!human.representations.some(item => item.id === 'groom-hvs-stylized-head-v1')) {
    human.representations.push({
      id: 'groom-hvs-stylized-head-v1',
      kind: '3D_MODEL',
      assetId: null,
      note: 'HVS_NEUTRAL_SHORT_MEDIUM runtime groom. Parent HEAD. Not identity. Not simulated. Not a face rig.',
    })
  }
  human.updatedAt = new Date().toISOString()
  return human
}

export function resolveCharacterBody(store: HvsDigitalHumanStore, characterId: string = RAEL_CHARACTER_ID): {
  characterId: string
  rigId: typeof HVS_HUMANOID_RIG_ID | null
  rigType: typeof HVS_HUMANOID_RIG_V1 | 'NO_RIG'
  takeId: string | null
  motionId: string | null
  rawAssetId: string | null
} {
  const human = store.characters.find(item => item.id === characterId) ?? null
  const bound = human?.rigBinding.state === 'BOUND' && human.rigBinding.skeletonRef === HVS_HUMANOID_RIG_ID
  const ref = [...store.references].reverse().find(item => item.characterId === characterId) ?? null
  const take = (ref ? store.takes.find(item => item.id === ref.takeId) : null)
    ?? [...store.takes].reverse().find(item => item.selected)
    ?? store.takes.at(-1)
    ?? null
  return {
    characterId,
    rigId: bound ? HVS_HUMANOID_RIG_ID : null,
    rigType: bound ? HVS_HUMANOID_RIG_V1 : 'NO_RIG',
    takeId: take?.id ?? ref?.takeId ?? null,
    motionId: take?.motionRef ?? ref?.motionRef ?? null,
    rawAssetId: take?.rawAssetId ?? ref?.rawAssetId ?? null,
  }
}

export function selectedPerformanceTake(store: HvsDigitalHumanStore, characterId: string = RAEL_CHARACTER_ID): HvsPerformanceTake | null {
  return store.takes.find(item => item.id === resolveCharacterBody(store, characterId).takeId) ?? null
}

export function projectHasSingleRael(store: HvsDigitalHumanStore): boolean {
  return store.characters.filter(item => item.id === RAEL_CHARACTER_ID).length === 1
}

export function identityLocksUnchanged(before: HvsDigitalHuman, after: HvsDigitalHuman): boolean {
  return JSON.stringify(before.identityLock) === JSON.stringify(after.identityLock)
    && before.activeWardrobeSetId === after.activeWardrobeSetId
    && JSON.stringify(before.wardrobeSets) === JSON.stringify(after.wardrobeSets)
    && JSON.stringify(before.generatorBindings) === JSON.stringify(after.generatorBindings)
    && before.id === after.id
    && before.characterClass === after.characterClass
}

export function directorBodyBinding(project: HvsProject, characterId: string = RAEL_CHARACTER_ID) {
  const store = project.digitalHumans
  if (!store) return null
  return resolveCharacterBody(store, characterId)
}
