/**
 * Local-engine install authority.
 * Generate never installs. Commander install is a separate action.
 * Wave 4 does not download Piper, ComfyUI, FLUX, Whisper, CLIP, or SAM.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { mediaCommandDataHierarchy } from './paths'
import {
  HVS_COMFYUI_FLUX_INSTALL_AUTHORIZED,
  HVS_MODEL_INSTALL_AUTHORIZATION,
  HVS_PIPER_INSTALL_AUTHORIZED,
  HVS_WAVE4_MODEL_INSTALL_AUTHORIZED,
} from './policy'

export const INSTALL_STATES = [
  'NOT_INSTALLED',
  'INSTALL_APPROVAL_REQUIRED',
  'INSTALLING',
  'INSTALLED',
  'FAILED',
] as const

export type InstallState = (typeof INSTALL_STATES)[number]

export type LocalEngineId = 'piper' | 'comfyui-flux'

export type LocalModelRecord = {
  id: string
  family: string
  version: string | null
  license: string
  hash: string | null
  sizeBytes: number | null
  backend: LocalEngineId
  path: string | null
  installedAt: string | null
  status: InstallState
}

export type LocalEngineCard = {
  engine: string
  engineId: LocalEngineId
  capability: 'VOICE_SYNTHESIS' | 'IMAGE_GENERATION'
  installState: InstallState
  estimatedStorage: string
  vram: string
  ram: string
  license: string
  installApprovalRequired: true
  generateFromThisSurface: false
  modelRecords: LocalModelRecord[]
}

export type ModelCatalog = {
  schemaVersion: 1
  updatedAt: string
  engines: Record<LocalEngineId, { installState: InstallState; models: LocalModelRecord[]; lastError: string | null }>
}

function catalogPath(): string {
  const dir = mediaCommandDataHierarchy().models
  mkdirSync(dir, { recursive: true })
  return path.join(dir, 'catalog.json')
}

export function emptyCatalog(): ModelCatalog {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    engines: {
      piper: { installState: 'NOT_INSTALLED', models: [], lastError: null },
      'comfyui-flux': { installState: 'NOT_INSTALLED', models: [], lastError: null },
    },
  }
}

export function loadModelCatalog(): ModelCatalog {
  const file = catalogPath()
  if (!existsSync(file)) {
    const empty = emptyCatalog()
    writeFileSync(file, `${JSON.stringify(empty, null, 2)}\n`, 'utf8')
    return empty
  }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as ModelCatalog
    if (!parsed?.engines?.piper || !parsed?.engines?.['comfyui-flux']) return emptyCatalog()
    return parsed
  } catch {
    return emptyCatalog()
  }
}

function saveCatalog(catalog: ModelCatalog): ModelCatalog {
  catalog.updatedAt = new Date().toISOString()
  writeFileSync(catalogPath(), `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')
  return catalog
}

export function detectInstalledWeights(): { piper: boolean; flux: boolean; comfyui: boolean } {
  const root = mediaCommandDataHierarchy()
  const voice = path.join(root.modelsVoice, '.')
  const image = path.join(root.modelsImage, '.')
  const hasOnnx = existsSync(voice) && false
  void hasOnnx
  return {
    piper: existsSync(path.join(root.modelsVoice, 'piper')) || existsSync(path.join(root.modelsVoice, 'en_US-lessac-medium.onnx')),
    flux: existsSync(path.join(root.modelsImage, 'flux1-schnell.safetensors')) || existsSync(path.join(root.modelsImage, 'FLUX.1-schnell')),
    comfyui: existsSync(path.join(root.modelsImage, 'ComfyUI')) || existsSync(path.join(root.models, 'comfyui')),
  }
}

export function localEngineCards(): LocalEngineCard[] {
  const catalog = loadModelCatalog()
  const detected = detectInstalledWeights()
  const piperState: InstallState = detected.piper ? 'INSTALLED' : catalog.engines.piper.installState
  const fluxState: InstallState = (detected.comfyui && detected.flux) ? 'INSTALLED' : catalog.engines['comfyui-flux'].installState
  return [
    {
      engine: 'Piper TTS (OHF-Voice/piper1-gpl)',
      engineId: 'piper',
      capability: 'VOICE_SYNTHESIS',
      installState: piperState,
      estimatedStorage: '~80–250 MiB (engine + one English voice)',
      vram: 'none (CPU)',
      ram: '~200–500 MiB',
      license: 'Engine GPLv3 (maintained); archived rhasspy/piper was MIT. Voices typically MIT/CC — record per voice at install time.',
      installApprovalRequired: true,
      generateFromThisSurface: false,
      modelRecords: catalog.engines.piper.models,
    },
    {
      engine: 'ComfyUI + FLUX.1 [schnell]',
      engineId: 'comfyui-flux',
      capability: 'IMAGE_GENERATION',
      installState: fluxState,
      estimatedStorage: '~20–35 GiB (ComfyUI + schnell + text encoders)',
      vram: '12–16 GiB class intended; --cpu exists but is impractical',
      ram: '32 GiB comfortable system RAM',
      license: 'ComfyUI GPL-3.0; FLUX.1 schnell Apache-2.0. Do not download FLUX.1-dev here (non-commercial).',
      installApprovalRequired: true,
      generateFromThisSurface: false,
      modelRecords: catalog.engines['comfyui-flux'].models,
    },
  ]
}

export function installAuthorizationFor(engineId: LocalEngineId): {
  authorized: false
  token: 'HVS_MODEL_INSTALL_AUTHORIZATION'
  engineFlag: 'HVS_PIPER_INSTALL_AUTHORIZED' | 'HVS_COMFYUI_FLUX_INSTALL_AUTHORIZED'
  reason: string
} {
  const engineFlag = engineId === 'piper' ? 'HVS_PIPER_INSTALL_AUTHORIZED' : 'HVS_COMFYUI_FLUX_INSTALL_AUTHORIZED'
  const named = engineId === 'piper' ? HVS_PIPER_INSTALL_AUTHORIZED : HVS_COMFYUI_FLUX_INSTALL_AUTHORIZED
  return {
    authorized: false,
    token: 'HVS_MODEL_INSTALL_AUTHORIZATION',
    engineFlag,
    reason: `Wave 5 is not installation approval. HVS_MODEL_INSTALL_AUTHORIZATION=${String(HVS_MODEL_INSTALL_AUTHORIZATION)} ${engineFlag}=${String(named)}.`,
  }
}

export function requestInstallApproval(engineId: LocalEngineId): {
  ok: boolean
  installState: InstallState
  executed: false
  downloaded: false
  reason: string
} {
  if (HVS_WAVE4_MODEL_INSTALL_AUTHORIZED || HVS_MODEL_INSTALL_AUTHORIZATION) {
    return {
      ok: false,
      installState: 'FAILED',
      executed: false,
      downloaded: false,
      reason: 'Wave 5 policy forbids installation even if a flag is flipped in-session. Commander must authorize a later install wave.',
    }
  }
  const catalog = loadModelCatalog()
  const current = catalog.engines[engineId]
  if (current.installState === 'INSTALLED') {
    return { ok: true, installState: 'INSTALLED', executed: false, downloaded: false, reason: 'Already recorded INSTALLED. Wave 5 did not install.' }
  }
  catalog.engines[engineId] = { ...current, installState: 'INSTALL_APPROVAL_REQUIRED', lastError: null }
  saveCatalog(catalog)
  return {
    ok: true,
    installState: 'INSTALL_APPROVAL_REQUIRED',
    executed: false,
    downloaded: false,
    reason: 'Install recorded as INSTALL_APPROVAL_REQUIRED. No binary, wheel, or weight was downloaded. Generate cannot install.',
  }
}

export function beginInstallForbidden(engineId: LocalEngineId): {
  ok: false
  installState: InstallState
  executed: false
  downloaded: false
  reason: string
} {
  void engineId
  return {
    ok: false,
    installState: 'NOT_INSTALLED',
    executed: false,
    downloaded: false,
    reason: 'Installation is forbidden this wave. Piper, ComfyUI, and FLUX weights must not be downloaded. Wave 5 is install-command preparation only.',
  }
}

export function generateDoesNotInstall(): true {
  return true
}
