/**
 * Generative model storage + discovery. Read-only: never downloads, never installs.
 *
 * Config (env):
 *   HVS_GENERATIVE_MODELS_DIR     root for generative weights + runtimes
 *                                 default: <app-data>/data/media-command/models/generative
 *                                 (on Nebula-Genesis the root disk is ~97% full; point this at a large volume,
 *                                  e.g. /run/media/chosenone/Seagate/hvs-models — recommended, not hardcoded)
 *   HVS_WAN22_ENABLED             '0' | 'false' | 'off' | 'no' disables the provider (default enabled)
 *   HVS_WAN22_MODEL_PATH          default: <models>/Wan2.2-TI2V-5B
 *   HVS_GENERATIVE_WORKER_PYTHON  default: <models>/runtimes/wan22/venv/bin/python
 * Official code checkout (derived): <models>/runtimes/wan22/Wan2.2
 */
import { existsSync, readFileSync, readdirSync, statSync, statfsSync } from 'node:fs'
import path from 'node:path'
import { mediaCommandDataHierarchy } from '../paths'
import { WAN22_CODE_REQUIRED_FILES, WAN22_HF_TOTAL_BYTES, WAN22_REQUIRED_BYTES, WAN22_REQUIRED_FILES } from './providers/wan22'

export type GenerativeConfigSource = 'env' | 'default'

export type GenerativeModelConfig = {
  enabled: boolean
  enabledSource: GenerativeConfigSource
  modelsDir: string
  modelsDirSource: GenerativeConfigSource
  wan22ModelPath: string
  wan22ModelPathSource: GenerativeConfigSource
  workerPython: string
  workerPythonSource: GenerativeConfigSource
  wan22CodeDir: string
  wan22VenvDir: string
}

export type InstalledModelMetadata = {
  modelVersion: string | null
  modelVersionSource: 'hvs-install-manifest' | 'hf-local-dir-metadata' | 'UNKNOWN'
  license: string | null
  licenseSource: 'readme-front-matter' | 'license-file' | 'hvs-install-manifest' | 'UNKNOWN'
  configClass: string | null
  configDiffusersVersion: string | null
  configModelType: string | null
}

export type ModelDiscovery = {
  config: GenerativeModelConfig
  status: 'INSTALLED' | 'MODEL_NOT_INSTALLED' | 'INCOMPLETE' | 'RUNTIME_MISSING' | 'DISABLED'
  weightsInstalled: boolean
  runtimeInstalled: boolean
  workerPythonExists: boolean
  codeDirComplete: boolean
  missingFiles: string[]
  sizeMismatch: Array<{ path: string; expected: number; actual: number }>
  presentBytes: number
  requiredBytes: number
  hfTotalBytes: number
  metadata: InstalledModelMetadata
  disk: { probePath: string; freeBytes: number | null; totalBytes: number | null }
  autoDownload: false
  detail: string
}

function envValue(name: string, env: NodeJS.ProcessEnv): string | null {
  const raw = env[name]
  if (raw == null) return null
  const trimmed = String(raw).trim()
  return trimmed ? trimmed : null
}

function absoluteOrNull(value: string | null): string | null {
  if (!value) return null
  if (value.includes('\0')) return null
  return path.isAbsolute(value) ? path.resolve(value) : null
}

export function resolveGenerativeConfig(env: NodeJS.ProcessEnv = process.env): GenerativeModelConfig {
  const enabledRaw = envValue('HVS_WAN22_ENABLED', env)
  const enabled = enabledRaw ? !/^(0|false|off|no)$/i.test(enabledRaw) : true
  const modelsEnv = absoluteOrNull(envValue('HVS_GENERATIVE_MODELS_DIR', env))
  const modelsDir = modelsEnv ?? path.join(mediaCommandDataHierarchy().models, 'generative')
  const modelEnv = absoluteOrNull(envValue('HVS_WAN22_MODEL_PATH', env))
  const wan22ModelPath = modelEnv ?? path.join(modelsDir, 'Wan2.2-TI2V-5B')
  const runtimeRoot = path.join(modelsDir, 'runtimes', 'wan22')
  const venv = path.join(runtimeRoot, 'venv')
  const pyEnv = absoluteOrNull(envValue('HVS_GENERATIVE_WORKER_PYTHON', env))
  return {
    enabled,
    enabledSource: enabledRaw ? 'env' : 'default',
    modelsDir,
    modelsDirSource: modelsEnv ? 'env' : 'default',
    wan22ModelPath,
    wan22ModelPathSource: modelEnv ? 'env' : 'default',
    workerPython: pyEnv ?? path.join(venv, 'bin', 'python'),
    workerPythonSource: pyEnv ? 'env' : 'default',
    wan22CodeDir: path.join(runtimeRoot, 'Wan2.2'),
    wan22VenvDir: venv,
  }
}

function safeRead(file: string, max = 64 * 1024): string | null {
  try {
    if (!existsSync(file)) return null
    const st = statSync(file)
    if (!st.isFile() || st.size > max) return null
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

/** Real metadata from the installed directory. Never invented: unknown stays null/UNKNOWN. */
export function readInstalledModelMetadata(modelPath: string): InstalledModelMetadata {
  const meta: InstalledModelMetadata = {
    modelVersion: null,
    modelVersionSource: 'UNKNOWN',
    license: null,
    licenseSource: 'UNKNOWN',
    configClass: null,
    configDiffusersVersion: null,
    configModelType: null,
  }
  const manifestRaw = safeRead(path.join(modelPath, 'hvs-install-manifest.json'))
  if (manifestRaw) {
    try {
      const manifest = JSON.parse(manifestRaw) as { hfRevision?: unknown; license?: unknown }
      if (typeof manifest.hfRevision === 'string' && /^[0-9a-f]{40}$/.test(manifest.hfRevision)) {
        meta.modelVersion = manifest.hfRevision
        meta.modelVersionSource = 'hvs-install-manifest'
      }
      if (typeof manifest.license === 'string' && manifest.license.length < 64) {
        meta.license = manifest.license
        meta.licenseSource = 'hvs-install-manifest'
      }
    } catch {
      // ignore malformed manifest
    }
  }
  if (!meta.modelVersion) {
    // `hf download --local-dir` writes .cache/huggingface/download/<file>.metadata whose first line is the commit sha.
    const metaDir = path.join(modelPath, '.cache', 'huggingface', 'download')
    const raw = safeRead(path.join(metaDir, 'config.json.metadata'))
    const first = raw?.split('\n')[0]?.trim() ?? ''
    if (/^[0-9a-f]{40}$/.test(first)) {
      meta.modelVersion = first
      meta.modelVersionSource = 'hf-local-dir-metadata'
    }
  }
  const readme = safeRead(path.join(modelPath, 'README.md'), 256 * 1024)
  const front = readme?.startsWith('---') ? readme.slice(3, readme.indexOf('\n---', 3) > 0 ? readme.indexOf('\n---', 3) : 0) : ''
  const lic = front.match(/^license:\s*([A-Za-z0-9.\-+]+)\s*$/m)
  if (lic) {
    meta.license = lic[1]
    meta.licenseSource = 'readme-front-matter'
  } else if (!meta.license) {
    for (const name of ['LICENSE', 'LICENSE.txt', 'LICENSE.md']) {
      const text = safeRead(path.join(modelPath, name), 256 * 1024)
      if (!text) continue
      if (/Apache License[\s\S]{0,80}Version 2\.0/i.test(text)) meta.license = 'apache-2.0'
      else meta.license = text.split('\n').find(line => line.trim())?.trim().slice(0, 64) ?? null
      if (meta.license) {
        meta.licenseSource = 'license-file'
        break
      }
    }
  }
  const configRaw = safeRead(path.join(modelPath, 'config.json'))
  if (configRaw) {
    try {
      const cfg = JSON.parse(configRaw) as Record<string, unknown>
      meta.configClass = typeof cfg._class_name === 'string' ? cfg._class_name : null
      meta.configDiffusersVersion = typeof cfg._diffusers_version === 'string' ? cfg._diffusers_version : null
      meta.configModelType = typeof cfg.model_type === 'string' ? cfg.model_type : null
    } catch {
      // ignore
    }
  }
  return meta
}

export function diskFree(target: string): { probePath: string; freeBytes: number | null; totalBytes: number | null } {
  let probe = path.resolve(target)
  for (let i = 0; i < 64 && !existsSync(probe); i++) {
    const parent = path.dirname(probe)
    if (parent === probe) break
    probe = parent
  }
  try {
    const st = statfsSync(probe)
    return { probePath: probe, freeBytes: Number(st.bavail) * Number(st.bsize), totalBytes: Number(st.blocks) * Number(st.bsize) }
  } catch {
    return { probePath: probe, freeBytes: null, totalBytes: null }
  }
}

export function discoverWan22(env: NodeJS.ProcessEnv = process.env): ModelDiscovery {
  const config = resolveGenerativeConfig(env)
  const missingFiles: string[] = []
  const sizeMismatch: ModelDiscovery['sizeMismatch'] = []
  let presentBytes = 0
  for (const row of WAN22_REQUIRED_FILES) {
    const file = path.join(config.wan22ModelPath, row.path)
    try {
      if (!existsSync(file)) {
        missingFiles.push(row.path)
        continue
      }
      const size = statSync(file).size
      presentBytes += size
      if (size !== row.bytes) sizeMismatch.push({ path: row.path, expected: row.bytes, actual: size })
    } catch {
      missingFiles.push(row.path)
    }
  }
  const weightsInstalled = missingFiles.length === 0 && sizeMismatch.length === 0
  const workerPythonExists = existsSync(config.workerPython)
  const codeDirComplete = WAN22_CODE_REQUIRED_FILES.every(rel => existsSync(path.join(config.wan22CodeDir, rel)))
  const runtimeInstalled = workerPythonExists && codeDirComplete
  const metadata = readInstalledModelMetadata(config.wan22ModelPath)
  const anyPresent = existsSync(config.wan22ModelPath) && (() => {
    try { return readdirSync(config.wan22ModelPath).length > 0 } catch { return false }
  })()
  let status: ModelDiscovery['status']
  let detail: string
  if (!config.enabled) {
    status = 'DISABLED'
    detail = 'HVS_WAN22_ENABLED disables the Wan 2.2 provider.'
  } else if (!weightsInstalled) {
    status = anyPresent && (missingFiles.length < WAN22_REQUIRED_FILES.length || sizeMismatch.length) ? 'INCOMPLETE' : 'MODEL_NOT_INSTALLED'
    detail = status === 'INCOMPLETE'
      ? `Wan2.2-TI2V-5B weights incomplete at ${config.wan22ModelPath}: ${missingFiles.length} missing, ${sizeMismatch.length} size mismatch.`
      : `Wan2.2-TI2V-5B weights not found at ${config.wan22ModelPath}. Run scripts/hvs/install-wan22.sh --download (Commander-authorized). HVS never auto-downloads.`
  } else if (!runtimeInstalled) {
    status = 'RUNTIME_MISSING'
    detail = `Weights present but worker runtime missing (python: ${workerPythonExists ? 'ok' : 'missing'}, official code: ${codeDirComplete ? 'ok' : 'missing'}).`
  } else {
    status = 'INSTALLED'
    detail = 'Wan2.2-TI2V-5B weights and worker runtime present.'
  }
  return {
    config,
    status,
    weightsInstalled,
    runtimeInstalled,
    workerPythonExists,
    codeDirComplete,
    missingFiles,
    sizeMismatch,
    presentBytes,
    requiredBytes: WAN22_REQUIRED_BYTES,
    hfTotalBytes: WAN22_HF_TOTAL_BYTES,
    metadata,
    disk: diskFree(config.modelsDir),
    autoDownload: false,
    detail,
  }
}
