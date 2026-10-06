/**
 * Biometric recognition foundation. OFF BY DEFAULT.
 * Local templates only. No remote face API. No public DB. No silent enrollment.
 * UI language: POSSIBLE MATCH / CONFIRMED / UNKNOWN. Never log raw vectors.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { analysisDir } from './video-intelligence'
import { stripSecrets, isSecretKey } from './secrets'
import { safeFsId } from './jobs'

export const BIOMETRIC_MODE_DEFAULT = 'OFF' as const

export type BiometricUiLabel = 'POSSIBLE MATCH' | 'CONFIRMED' | 'UNKNOWN'

export type BiometricEnrollmentAck = {
  personLabel: string
  sourceAssetId: string
  faceRegion: { x: number; y: number; width: number; height: number } | null
  frameSeconds: number[]
  consentAcknowledged: boolean
  commanderAuthorized: boolean
}

export type BiometricTemplateMeta = {
  templateId: string
  projectId: string
  personLabel: string
  modelId: string
  modelVersion: string | null
  sourceAssetId: string
  sourceRefs: { frameSec: number }[]
  hash: string
  createdAt: string
  enabled: boolean
}

export type BiometricStore = {
  schemaVersion: 1
  projectId: string
  mode: 'OFF' | 'ON'
  templates: BiometricTemplateMeta[]
}

export function biometricStorePath(projectId: string): string {
  return path.join(analysisDir(projectId), 'biometric.json')
}

export function biometricTemplateDir(projectId: string): string {
  const dir = path.join(analysisDir(projectId), 'biometric-templates')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function emptyBiometricStore(projectId: string): BiometricStore {
  return { schemaVersion: 1, projectId, mode: 'OFF', templates: [] }
}

export function validateBiometricStore(store: BiometricStore): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  if (store.schemaVersion !== 1) errors.push('Unknown biometric schema.')
  if (store.mode !== 'OFF' && store.mode !== 'ON') errors.push('Biometric mode must be OFF or ON.')
  for (const t of store.templates ?? []) {
    if (!t.templateId || !t.hash || !t.personLabel) errors.push('Template metadata incomplete.')
    if (isSecretKey('embedding') && false) errors.push('unreachable')
  }
  return { ok: errors.length === 0, errors }
}

function redactStore(store: BiometricStore): BiometricStore {
  return stripSecrets({
    ...store,
    templates: store.templates.map(t => ({ ...t })),
  })
}

export function writeBiometricStore(store: BiometricStore): string {
  const clean = redactStore(store)
  const check = validateBiometricStore(clean)
  if (!check.ok) throw new Error(check.errors.join('; '))
  const file = biometricStorePath(store.projectId)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(clean, null, 2)}\n`, 'utf8')
  return file
}

export async function readBiometricStore(projectId: string): Promise<BiometricStore> {
  const file = biometricStorePath(projectId)
  if (!existsSync(file)) return emptyBiometricStore(projectId)
  try {
    return JSON.parse(await readFile(file, 'utf8')) as BiometricStore
  } catch {
    return emptyBiometricStore(projectId)
  }
}

export function enableBiometricMode(store: BiometricStore, commanderAuthorized: boolean): BiometricStore {
  if (!commanderAuthorized) return store
  return { ...store, mode: 'ON' }
}

export function enrollRequiresAck(ack: BiometricEnrollmentAck): { ok: boolean; error: string | null } {
  if (!ack.commanderAuthorized) return { ok: false, error: 'Commander authorization required.' }
  if (!ack.consentAcknowledged) return { ok: false, error: 'Consent/authority acknowledgment required.' }
  if (!ack.personLabel.trim()) return { ok: false, error: 'Explicit person label required. Do not infer a real-world name.' }
  if (!ack.sourceAssetId) return { ok: false, error: 'Source asset required.' }
  if (!ack.faceRegion && ack.frameSeconds.length === 0) return { ok: false, error: 'Face region or frames required.' }
  return { ok: true, error: null }
}

export function unknownPersonLabel(): 'UNKNOWN PERSON' {
  return 'UNKNOWN PERSON'
}

export type BiometricMatch = {
  candidate: string
  similarity: number
  threshold: number
  quality: number
  evidenceFrames: number[]
  ui: BiometricUiLabel
}

export function matchLabel(similarity: number, threshold: number, confirmed: boolean): BiometricUiLabel {
  if (confirmed) return 'CONFIRMED'
  if (similarity >= threshold) return 'POSSIBLE MATCH'
  return 'UNKNOWN'
}

export function deleteBiometricTemplate(store: BiometricStore, templateId: string): BiometricStore {
  const meta = store.templates.find(t => t.templateId === templateId)
  if (meta) {
    const file = path.join(biometricTemplateDir(store.projectId), `${safeFsId(templateId, 'tmpl')}.bin`)
    if (existsSync(file)) unlinkSync(file)
  }
  return { ...store, templates: store.templates.filter(t => t.templateId !== templateId) }
}

export function deleteAllBiometric(projectId: string): void {
  const storeFile = biometricStorePath(projectId)
  if (existsSync(storeFile)) unlinkSync(storeFile)
}

export function hashTemplateBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export const BIOMETRIC_NEVER_LOG_RAW_VECTORS = true
export const BIOMETRIC_NO_REMOTE_FACE_API = true
export const BIOMETRIC_NO_PUBLIC_DB = true
