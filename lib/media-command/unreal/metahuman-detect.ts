/**
 * Honest local inspection of official Unreal 5.8.3 MetaHuman plugins and Core Data.
 * Does not download, guess, or enable experimental plugins.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

export const HVS_METAHUMAN_ENGINE_ROOT = '/home/chosenone/Unreal'
export const HVS_METAHUMAN_PLUGIN_ROOT = path.join(HVS_METAHUMAN_ENGINE_ROOT, 'Engine/Plugins/MetaHuman')
export const HVS_METAHUMAN_CHARACTER_PLUGIN = path.join(HVS_METAHUMAN_PLUGIN_ROOT, 'MetaHumanCharacter/MetaHumanCharacter.uplugin')
export const HVS_METAHUMAN_CHARACTER_CONTENT = path.join(HVS_METAHUMAN_PLUGIN_ROOT, 'MetaHumanCharacter/Content')
export const HVS_METAHUMAN_IDENTITY_FACE = path.join(HVS_METAHUMAN_CHARACTER_CONTENT, 'Face/IdentityTemplate')
export const HVS_METAHUMAN_IDENTITY_BODY = path.join(HVS_METAHUMAN_CHARACTER_CONTENT, 'Body/IdentityTemplate')
export const HVS_RIGLOGIC_PLUGIN = '/home/chosenone/Unreal/Engine/Plugins/Animation/RigLogic/RigLogic.uplugin'
export const HVS_GROOM_PLUGIN = '/home/chosenone/Unreal/Engine/Plugins/Runtime/HairStrands/HairStrands.uplugin'
export const HVS_CONTROL_RIG_PLUGIN = '/home/chosenone/Unreal/Engine/Plugins/Animation/ControlRig/ControlRig.uplugin'
export const HVS_IK_RIG_PLUGIN = '/home/chosenone/Unreal/Engine/Plugins/Animation/IKRig/IKRig.uplugin'
export const HVS_METAHUMAN_SDK_PLUGIN = path.join(HVS_METAHUMAN_PLUGIN_ROOT, 'MetaHumanSDK/MetaHumanSDK.uplugin')
export const HVS_METAHUMAN_ANIMATOR_PLUGIN = path.join(HVS_METAHUMAN_PLUGIN_ROOT, 'MetaHumanAnimator/MetaHuman.uplugin')
export const HVS_METAHUMAN_LIVELINK_PLUGIN = path.join(HVS_METAHUMAN_PLUGIN_ROOT, 'MetaHumanLiveLink/MetaHumanLiveLink.uplugin')
export const HVS_RESERVED_MHC_PATH = '/Game/HVS/Characters/Rael/MHC_Rael_Commander'

type PluginJson = {
  FriendlyName?: string
  VersionName?: string
  EnabledByDefault?: boolean
  IsBetaVersion?: boolean
  IsExperimentalVersion?: boolean
  SupportedTargetPlatforms?: string[]
}

function readPlugin(file: string): PluginJson | null {
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as PluginJson
  } catch {
    return null
  }
}

function linuxBinary(pluginDir: string): boolean {
  const soDir = path.join(pluginDir, 'Binaries/Linux')
  if (!existsSync(soDir)) return false
  try {
    return readFileSync(path.join(soDir, 'UnrealEditor.modules'), 'utf8').length > 0 || existsSync(soDir)
  } catch {
    return existsSync(soDir)
  }
}

export type HvsMetaHumanDetect = {
  creatorPlugin: 'YES' | 'NO'
  creatorFriendlyName: string | null
  creatorVersion: string | null
  creatorBeta: boolean
  coreData: 'YES' | 'NO'
  coreDataPath: string | null
  coreDataVersion: string | null
  linuxSupport: 'DETECTED' | 'PARTIAL' | 'NOT PRESENT'
  rigLogic: 'YES' | 'NO'
  groom: 'YES' | 'NO'
  controlRig: 'YES' | 'NO'
  ikRig: 'YES' | 'NO'
  sdk: 'YES' | 'NO'
  animator: 'YES' | 'NO'
  liveLink: 'YES' | 'NO'
  linuxCreatorBinary: boolean
  linuxRigLogicBinary: boolean
  identityTemplates: boolean
  dnaTemplate: boolean
  officialOnly: true
  experimentalGenerator: 'PRESENT_NOT_ENABLED'
  notes: string[]
}

export function detectMetaHumanSupport(): HvsMetaHumanDetect {
  const creator = readPlugin(HVS_METAHUMAN_CHARACTER_PLUGIN)
  const rigLogic = readPlugin(HVS_RIGLOGIC_PLUGIN)
  const groom = readPlugin(HVS_GROOM_PLUGIN)
  const notes: string[] = []
  const identityTemplates = existsSync(path.join(HVS_METAHUMAN_IDENTITY_FACE, 'face_landmarks.json'))
    && existsSync(path.join(HVS_METAHUMAN_IDENTITY_BODY, 'body_model.dna'))
  const faceDna = existsSync(path.join(HVS_METAHUMAN_CHARACTER_CONTENT, 'Face/SKM_Face_DNA.uasset'))
  const dnaTemplate = existsSync(path.join(HVS_METAHUMAN_IDENTITY_BODY, 'body_model.dna')) && faceDna
  const optional = existsSync(path.join(HVS_METAHUMAN_CHARACTER_CONTENT, 'Optional/TextureSynthesis'))
  const corePresent = identityTemplates && (faceDna || dnaTemplate) && existsSync(HVS_METAHUMAN_CHARACTER_CONTENT)
  if (corePresent) {
    notes.push(`Official MetaHuman Character plugin Content includes IdentityTemplate DNA/landmarks${optional ? ' and Optional TextureSynthesis' : ''}. No separate Epic Core Data pack folder was found.`)
  } else {
    notes.push('MetaHuman Creator Core Data pack was not found as a separate install. Official plugin Content is incomplete for a full Creator likeness.')
  }
  const linuxCreator = linuxBinary(path.join(HVS_METAHUMAN_PLUGIN_ROOT, 'MetaHumanCharacter'))
  const linuxRig = linuxBinary('/home/chosenone/Unreal/Engine/Plugins/Animation/RigLogic')
  const linuxSupport: HvsMetaHumanDetect['linuxSupport'] = linuxCreator && linuxRig ? 'DETECTED' : linuxCreator || linuxRig ? 'PARTIAL' : 'NOT PRESENT'
  return {
    creatorPlugin: creator ? 'YES' : 'NO',
    creatorFriendlyName: creator?.FriendlyName ?? null,
    creatorVersion: creator?.VersionName ?? null,
    creatorBeta: Boolean(creator?.IsBetaVersion),
    coreData: corePresent ? 'YES' : 'NO',
    coreDataPath: corePresent ? HVS_METAHUMAN_CHARACTER_CONTENT : null,
    coreDataVersion: corePresent ? `MetaHumanCharacter ${creator?.VersionName ?? '1.0.0'} bundled with UE 5.8.3` : null,
    linuxSupport,
    rigLogic: rigLogic ? 'YES' : 'NO',
    groom: groom ? 'YES' : 'NO',
    controlRig: readPlugin(HVS_CONTROL_RIG_PLUGIN) ? 'YES' : 'NO',
    ikRig: readPlugin(HVS_IK_RIG_PLUGIN) ? 'YES' : 'NO',
    sdk: readPlugin(HVS_METAHUMAN_SDK_PLUGIN) ? 'YES' : 'NO',
    animator: readPlugin(HVS_METAHUMAN_ANIMATOR_PLUGIN) ? 'YES' : 'NO',
    liveLink: readPlugin(HVS_METAHUMAN_LIVELINK_PLUGIN) ? 'YES' : 'NO',
    linuxCreatorBinary: linuxCreator,
    linuxRigLogicBinary: linuxRig,
    identityTemplates,
    dnaTemplate: dnaTemplate || faceDna,
    officialOnly: true,
    experimentalGenerator: 'PRESENT_NOT_ENABLED',
    notes,
  }
}

export function requiredCreatorPlugins(): Array<{ name: string; enabled: boolean; reason: string }> {
  return [
    { name: 'MetaHumanCharacter', enabled: true, reason: 'MetaHuman Creator' },
    { name: 'MetaHumanSDK', enabled: true, reason: 'MetaHuman utilities / DNA interchange' },
    { name: 'RigLogic', enabled: true, reason: 'Facial RigLogic runtime' },
    { name: 'HairStrands', enabled: true, reason: 'Groom' },
    { name: 'ControlRig', enabled: true, reason: 'already required for Manny execution' },
    { name: 'IKRig', enabled: true, reason: 'already required for Manny execution' },
  ]
}

export function deferredPlugins(): string[] {
  return ['MetaHuman', 'MetaHumanLiveLink', 'MetaHumanCrowd', 'MetaHumanCoreML', 'MetaHumanGenerator']
}
