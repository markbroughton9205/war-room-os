/**
 * Persist unattended envelopes under the existing Foundry contracts hierarchy.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { foundryContractsRoot } from './foundryContractStore'
import { FOUNDRY_UNATTENDED_TERMINAL_STATES, type FoundryUnattendedEnvelope } from './foundryUnattendedTypes'

function envelopeRoot(): string {
  const root = path.join(foundryContractsRoot(), 'envelopes')
  mkdirSync(root, { recursive: true })
  return root
}

function atomicWrite(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(tmp, filePath)
}

function readJson<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

export function saveUnattendedEnvelope(envelope: FoundryUnattendedEnvelope): FoundryUnattendedEnvelope {
  const root = envelopeRoot()
  atomicWrite(path.join(root, `${envelope.envelopeId}.json`), envelope)
  if (!FOUNDRY_UNATTENDED_TERMINAL_STATES.includes(envelope.status) && !envelope.revokedAt) {
    atomicWrite(path.join(root, `active-${envelope.missionId}.json`), { envelopeId: envelope.envelopeId, missionId: envelope.missionId })
  } else {
    const pointer = path.join(root, `active-${envelope.missionId}.json`)
    if (existsSync(pointer)) {
      try { unlinkSync(pointer) } catch { /* keep history */ }
    }
  }
  return envelope
}

export function loadUnattendedEnvelope(envelopeId: string): FoundryUnattendedEnvelope | null {
  return readJson(path.join(envelopeRoot(), `${envelopeId}.json`))
}

export function loadActiveUnattendedEnvelope(missionId: string): FoundryUnattendedEnvelope | null {
  const pointer = readJson<{ envelopeId: string }>(path.join(envelopeRoot(), `active-${missionId}.json`))
  if (pointer?.envelopeId) {
    const loaded = loadUnattendedEnvelope(pointer.envelopeId)
    if (loaded && !FOUNDRY_UNATTENDED_TERMINAL_STATES.includes(loaded.status) && !loaded.revokedAt) return loaded
  }
  return listUnattendedEnvelopes(missionId).filter(item => !FOUNDRY_UNATTENDED_TERMINAL_STATES.includes(item.status) && !item.revokedAt).at(-1) ?? null
}

export function listUnattendedEnvelopes(missionId?: string): FoundryUnattendedEnvelope[] {
  const root = envelopeRoot()
  return readdirSync(root)
    .filter(name => name.endsWith('.json') && !name.startsWith('active-'))
    .map(name => readJson<FoundryUnattendedEnvelope>(path.join(root, name)))
    .filter((item): item is FoundryUnattendedEnvelope => Boolean(item && (!missionId || item.missionId === missionId)))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
}

export function listActiveUnattendedEnvelopes(): FoundryUnattendedEnvelope[] {
  return listUnattendedEnvelopes().filter(item => !FOUNDRY_UNATTENDED_TERMINAL_STATES.includes(item.status) && !item.revokedAt)
}
