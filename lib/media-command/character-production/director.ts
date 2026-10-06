/**
 * Director resolves "Use Ra'el" to rael-commander.
 * Character path knowledge stays inside execution, not in Director prompts.
 */
import { RAEL_CHARACTER_ID } from '../digital-human/types'
import { readMetaHumanBinding } from '../unreal/metahuman-binding'
import { HVS_RAEL_BODY_MOTION_ID, HVS_RAEL_BODY_TAKE_ID, HVS_RAEL_MHC_PATH, HVS_RAEL_WARDROBE_INTENT } from './types'
import { readCharacterProduction } from './persist'
import { deriveProductionState, acceptedFaceCount } from './state'
import { readUnrealScenePackage } from '../unreal/storage'

export type HvsRaelDirectorRef = {
  phrase: 'Use Ra\'el'
  characterId: typeof RAEL_CHARACTER_ID
  identityId: typeof RAEL_CHARACTER_ID
  wardrobeIntent: typeof HVS_RAEL_WARDROBE_INTENT
  bodyTakeId: string
  bodyMotionId: string
  productionState: string
  execution: 'METAHUMAN' | 'MANNY_BODY_TEST_REFERENCE'
}

export function resolveUseRael(projectId: string): HvsRaelDirectorRef {
  const face = acceptedFaceCount(projectId)
  const operation = readCharacterProduction(projectId)
  const pkg = readUnrealScenePackage(projectId)
  const takeConnected = Boolean(pkg?.characters[0]?.performanceTakeId === HVS_RAEL_BODY_TAKE_ID)
  const binding = readMetaHumanBinding(projectId)
  const productionState = deriveProductionState({
    faceComplete: face.complete,
    faceAccepted: face.accepted,
    operation,
    takeConnected,
  })
  return {
    phrase: "Use Ra'el",
    characterId: RAEL_CHARACTER_ID,
    identityId: RAEL_CHARACTER_ID,
    wardrobeIntent: HVS_RAEL_WARDROBE_INTENT,
    bodyTakeId: HVS_RAEL_BODY_TAKE_ID,
    bodyMotionId: HVS_RAEL_BODY_MOTION_ID,
    productionState,
    execution: binding?.assetState === 'CREATED' || productionState === 'CHARACTER_READY'
      ? 'METAHUMAN'
      : 'MANNY_BODY_TEST_REFERENCE',
  }
}

export function resolveProductionIntent(prompt: string, projectId: string): {
  characterId: typeof RAEL_CHARACTER_ID
  wardrobeIntent: typeof HVS_RAEL_WARDROBE_INTENT
  bodyTakeId: string
  generativeVideo: false
  metahumanPathInternal: typeof HVS_RAEL_MHC_PATH
} {
  void prompt
  const ref = resolveUseRael(projectId)
  return {
    characterId: ref.characterId,
    wardrobeIntent: ref.wardrobeIntent,
    bodyTakeId: ref.bodyTakeId,
    generativeVideo: false,
    metahumanPathInternal: HVS_RAEL_MHC_PATH,
  }
}
