/**
 * HVS humanoid bone → generic Unreal humanoid bone.
 * Semantic targets follow the HVS-UE-01 bridge list.
 * unrealBone names are the UE5 mannequin / MetaHuman-class body names.
 * No finger bones are invented. The adapter chooses the asset later.
 */
import { HVS_HUMANOID_BONES, type HvsHumanoidBone } from '../digital-human/humanoid-rig'
import type { HvsUnrealBoneMapEntry } from './types'

const SEMANTIC: Record<HvsHumanoidBone, { semanticTarget: string; unrealBone: string }> = {
  ROOT: { semanticTarget: 'ROOT', unrealBone: 'root' },
  PELVIS: { semanticTarget: 'PELVIS', unrealBone: 'pelvis' },
  SPINE_01: { semanticTarget: 'SPINE_01', unrealBone: 'spine_01' },
  SPINE_02: { semanticTarget: 'SPINE_02', unrealBone: 'spine_02' },
  CHEST: { semanticTarget: 'CHEST', unrealBone: 'spine_03' },
  NECK: { semanticTarget: 'NECK', unrealBone: 'neck_01' },
  HEAD: { semanticTarget: 'HEAD', unrealBone: 'head' },
  LEFT_CLAVICLE: { semanticTarget: 'LEFT_CLAVICLE', unrealBone: 'clavicle_l' },
  LEFT_SHOULDER: { semanticTarget: 'LEFT_UPPER_ARM', unrealBone: 'upperarm_l' },
  LEFT_ELBOW: { semanticTarget: 'LEFT_FOREARM', unrealBone: 'lowerarm_l' },
  LEFT_WRIST: { semanticTarget: 'LEFT_WRIST', unrealBone: 'hand_l' },
  RIGHT_CLAVICLE: { semanticTarget: 'RIGHT_CLAVICLE', unrealBone: 'clavicle_r' },
  RIGHT_SHOULDER: { semanticTarget: 'RIGHT_UPPER_ARM', unrealBone: 'upperarm_r' },
  RIGHT_ELBOW: { semanticTarget: 'RIGHT_FOREARM', unrealBone: 'lowerarm_r' },
  RIGHT_WRIST: { semanticTarget: 'RIGHT_WRIST', unrealBone: 'hand_r' },
  LEFT_HIP: { semanticTarget: 'LEFT_UPPER_LEG', unrealBone: 'thigh_l' },
  LEFT_KNEE: { semanticTarget: 'LEFT_LOWER_LEG', unrealBone: 'calf_l' },
  LEFT_ANKLE: { semanticTarget: 'LEFT_ANKLE', unrealBone: 'foot_l' },
  LEFT_FOOT: { semanticTarget: 'LEFT_FOOT', unrealBone: 'ball_l' },
  RIGHT_HIP: { semanticTarget: 'RIGHT_UPPER_LEG', unrealBone: 'thigh_r' },
  RIGHT_KNEE: { semanticTarget: 'RIGHT_LOWER_LEG', unrealBone: 'calf_r' },
  RIGHT_ANKLE: { semanticTarget: 'RIGHT_ANKLE', unrealBone: 'foot_r' },
  RIGHT_FOOT: { semanticTarget: 'RIGHT_FOOT', unrealBone: 'ball_r' },
}

export const HVS_UNREAL_REQUIRED_SEMANTIC_TARGETS = [
  'ROOT',
  'PELVIS',
  'SPINE_01',
  'SPINE_02',
  'CHEST',
  'NECK',
  'HEAD',
  'LEFT_CLAVICLE',
  'LEFT_UPPER_ARM',
  'LEFT_FOREARM',
  'LEFT_WRIST',
  'RIGHT_CLAVICLE',
  'RIGHT_UPPER_ARM',
  'RIGHT_FOREARM',
  'RIGHT_WRIST',
  'LEFT_UPPER_LEG',
  'LEFT_LOWER_LEG',
  'LEFT_ANKLE',
  'LEFT_FOOT',
  'RIGHT_UPPER_LEG',
  'RIGHT_LOWER_LEG',
  'RIGHT_ANKLE',
  'RIGHT_FOOT',
] as const

export function hvsUnrealSkeletonMap(): HvsUnrealBoneMapEntry[] {
  return HVS_HUMANOID_BONES.map(bone => ({
    hvsBone: bone,
    semanticTarget: SEMANTIC[bone].semanticTarget,
    unrealBone: SEMANTIC[bone].unrealBone,
    control: null,
  }))
}

export function skeletonMapComplete(map: HvsUnrealBoneMapEntry[]): boolean {
  if (map.length !== HVS_HUMANOID_BONES.length) return false
  const bones = new Set(map.map(entry => entry.hvsBone))
  const semantic = new Set(map.map(entry => entry.semanticTarget))
  if (bones.size !== HVS_HUMANOID_BONES.length) return false
  for (const bone of HVS_HUMANOID_BONES) if (!bones.has(bone)) return false
  for (const target of HVS_UNREAL_REQUIRED_SEMANTIC_TARGETS) if (!semantic.has(target)) return false
  return map.every(entry => entry.control === null && !/finger|thumb|index|pinky|ring|middle/i.test(entry.unrealBone))
}
