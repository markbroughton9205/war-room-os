/**
 * Whisper.cpp tiny.en catalog. Separate from Piper/FLUX catalog.json.
 * Status reflects files on disk. Never claims INSTALLED without hash match.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  TINY_EN_BYTES,
  TINY_EN_FILENAME,
  TINY_EN_LICENSE,
  TINY_EN_SHA256,
  TINY_EN_URL,
  WHISPER_CPP_GIT,
  WHISPER_CPP_LICENSE,
  whisperPaths,
} from './whisper-install'

export type WhisperCatalogRecord = {
  id: string
  family: string
  version: string
  license: string
  source: string
  hash: string | null
  bytes: number
  backend: 'whisper.cpp'
  localPath: string | null
  installedAt: string | null
  status: 'NOT_INSTALLED' | 'INSTALLED' | 'FAILED'
}

export type WhisperCatalog = {
  schemaVersion: 1
  updatedAt: string
  runtimeLicense: string
  runtimeSource: string
  expectedBytes: number
  expectedSha256: string
  models: WhisperCatalogRecord[]
}

function sha256File(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

export function whisperCatalogPath(): string {
  const dir = whisperPaths().modelDir
  mkdirSync(dir, { recursive: true })
  return path.join(dir, 'catalog.json')
}

export function syncWhisperModelCatalog(): WhisperCatalogRecord {
  const paths = whisperPaths()
  mkdirSync(paths.modelDir, { recursive: true })
  const present = existsSync(paths.model) && existsSync(paths.binary)
  const hash = existsSync(paths.model) ? sha256File(paths.model) : null
  const bytes = existsSync(paths.model) ? statSync(paths.model).size : 0
  let installedAt: string | null = null
  if (existsSync(paths.provenance)) {
    try {
      const prev = JSON.parse(readFileSync(paths.provenance, 'utf8')) as { installedAt?: string }
      installedAt = prev.installedAt ?? null
    } catch { /* ignore */ }
  }
  const status: WhisperCatalogRecord['status'] = present && hash === TINY_EN_SHA256
    ? 'INSTALLED'
    : present
      ? 'FAILED'
      : 'NOT_INSTALLED'
  if (status === 'INSTALLED' && !installedAt) installedAt = new Date().toISOString()
  const record: WhisperCatalogRecord = {
    id: 'whisper-ggml-tiny-en',
    family: 'whisper.cpp',
    version: 'tiny.en',
    license: TINY_EN_LICENSE,
    source: TINY_EN_URL,
    hash,
    bytes,
    backend: 'whisper.cpp',
    localPath: present ? paths.model : null,
    installedAt,
    status,
  }
  const catalog: WhisperCatalog = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    runtimeLicense: WHISPER_CPP_LICENSE,
    runtimeSource: WHISPER_CPP_GIT,
    expectedBytes: TINY_EN_BYTES,
    expectedSha256: TINY_EN_SHA256,
    models: [record],
  }
  writeFileSync(whisperCatalogPath(), `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')
  return record
}

export function loadWhisperCatalog(): WhisperCatalog | null {
  const file = whisperCatalogPath()
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as WhisperCatalog
  } catch {
    return null
  }
}

export function whisperCatalogMatchesDisk(): boolean {
  const record = loadWhisperCatalog()?.models[0]
  if (!record) return false
  const paths = whisperPaths()
  if (record.status === 'INSTALLED') {
    return existsSync(paths.binary)
      && existsSync(paths.model)
      && record.hash === TINY_EN_SHA256
      && record.bytes === TINY_EN_BYTES
      && record.localPath === paths.model
  }
  // A record that is not marked installed makes no claim about the disk, so there is nothing to disagree with.
  return true
}

export { TINY_EN_BYTES, TINY_EN_FILENAME, TINY_EN_SHA256, TINY_EN_URL, TINY_EN_LICENSE }
