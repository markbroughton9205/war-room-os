/**
 * Local Unreal-native preview return for HIGH-FIDELITY RA'EL.
 * Never labels Three.js as high-fidelity. Never embeds face bytes.
 */
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { inspectUnrealProcess, startUnrealProcess } from '../unreal/process'
import { HVS_RAEL_MHC_PATH, HVS_RAEL_PRODUCTION_CHARACTER_ID, type HvsUnrealPreviewReceipt } from './types'
import { characterPreviewDir, readPreviewReceipt, writePreviewReceipt } from './persist'
import { HVS_LIKENESS_PYTHON } from './likeness-adapter'
import { mkdirSync } from 'node:fs'
import { unrealPackageDir } from '../unreal/storage'

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

export function highFidelityPreviewPath(projectId: string, characterId = HVS_RAEL_PRODUCTION_CHARACTER_ID): string {
  return path.join(characterPreviewDir(projectId, characterId), 'rael-unreal-preview.png')
}

export function previewUrl(projectId: string): string {
  return `/api/media-command/character-production?projectId=${encodeURIComponent(projectId)}&preview=1`
}

export function readHighFidelityPreview(projectId: string, characterId = HVS_RAEL_PRODUCTION_CHARACTER_ID): HvsUnrealPreviewReceipt | null {
  const receipt = readPreviewReceipt(projectId, characterId)
  if (!receipt) return null
  if (!existsSync(receipt.assetPath)) return null
  if (receipt.renderEngine !== 'UNREAL') return null
  return receipt
}

export function persistUnrealPreviewReceipt(input: {
  projectId: string
  characterId?: string
  now: string
  width: number
  height: number
  assemblyState: string
  takeBindingState: string
  sourceCharacterAsset?: string
  camera?: string | null
  lensMm?: number | null
  assetPath?: string
}): HvsUnrealPreviewReceipt {
  const characterId = input.characterId ?? HVS_RAEL_PRODUCTION_CHARACTER_ID
  const assetPath = input.assetPath ?? highFidelityPreviewPath(input.projectId, characterId)
  const receipt: HvsUnrealPreviewReceipt = {
    previewId: `preview-${characterId}-${input.now.replace(/[:.]/g, '')}`,
    characterId,
    renderEngine: 'UNREAL',
    assetPath,
    width: input.width,
    height: input.height,
    generatedAt: input.now,
    sourceCharacterAsset: input.sourceCharacterAsset ?? HVS_RAEL_MHC_PATH,
    assemblyState: input.assemblyState,
    takeBindingState: input.takeBindingState,
    camera: input.camera ?? 'Close-up',
    lensMm: input.lensMm ?? 85,
  }
  writePreviewReceipt(receipt, input.projectId)
  return receipt
}

export function persistMockUnrealPreview(projectId: string, now: string, assemblyState: string, takeBindingState: string): HvsUnrealPreviewReceipt {
  const assetPath = highFidelityPreviewPath(projectId)
  mkdirSync(path.dirname(assetPath), { recursive: true })
  writeFileSync(assetPath, PNG_1X1)
  return persistUnrealPreviewReceipt({
    projectId,
    now,
    width: 1,
    height: 1,
    assemblyState,
    takeBindingState,
    assetPath,
  })
}

export function requestUnrealPreviewCapture(projectId: string, launch: boolean): { requested: boolean; path: string } {
  const dir = characterPreviewDir(projectId)
  const file = path.join(unrealPackageDir(projectId), 'character-ops', 'hvs_unreal_character_preview.request.json')
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({
    op: 'hvs.unreal.character.preview',
    projectId,
    characterId: HVS_RAEL_PRODUCTION_CHARACTER_ID,
    mhc: HVS_RAEL_MHC_PATH,
    previewDir: dir,
    previewPath: highFidelityPreviewPath(projectId),
    width: 1600,
    height: 900,
    camera: 'Close-up',
    lensMm: 85,
    capture: 'take_high_res_screenshot',
  }, null, 2)}\n`)
  const process = inspectUnrealProcess(projectId)
  if (process.status === 'STOPPED' && launch) startUnrealProcess(projectId, HVS_LIKENESS_PYTHON)
  return { requested: true, path: highFidelityPreviewPath(projectId) }
}
