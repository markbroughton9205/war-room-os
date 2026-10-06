/**
 * ENGINE-04 persistence. Extends the existing per-user data root.
 * Atomic tmp+rename. Corrupt/partial files are not loaded.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile, readdir, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { resolveLocalAppDataPaths } from '@/lib/sovereign-runtime/local-ownership/paths'
import type { LongHorizonMission, MissionCheckpoint } from './types'
import { LONG_HORIZON_MISSION_SCHEMA, MISSION_CHECKPOINT_SCHEMA } from './types'

export function engine04StoreRoot(): string {
  const override = process.env.WAR_ROOM_ENGINE04_STORE
  return override || path.join(resolveLocalAppDataPaths().data, 'council', 'engine-04')
}

function missionPath(id: string): string {
  return path.join(engine04StoreRoot(), 'missions', `${id}.json`)
}

function checkpointDir(missionId: string): string {
  return path.join(engine04StoreRoot(), 'checkpoints', missionId)
}

function checkpointPath(missionId: string, checkpointId: string): string {
  return path.join(checkpointDir(missionId), `${checkpointId}.json`)
}

async function atomicWrite(file: string, body: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, body)
  await rename(tmp, file)
  try { await unlink(`${file}.partial`) } catch { /* none */ }
}

export function canonicalizeForHash(checkpoint: Omit<MissionCheckpoint, 'integrity_hash'> & { integrity_hash?: string }): string {
  const copy = { ...checkpoint, integrity_hash: '' }
  return JSON.stringify(copy)
}

export function hashCheckpoint(checkpoint: Omit<MissionCheckpoint, 'integrity_hash'> & { integrity_hash?: string }): string {
  return createHash('sha256').update(canonicalizeForHash(checkpoint)).digest('hex')
}

export function verifyCheckpointIntegrity(checkpoint: MissionCheckpoint): { ok: boolean; reason: string } {
  if (checkpoint.schema !== MISSION_CHECKPOINT_SCHEMA) return { ok: false, reason: 'incompatible schema' }
  if (!checkpoint.integrity_hash) return { ok: false, reason: 'missing integrity hash' }
  const expected = hashCheckpoint(checkpoint)
  if (expected !== checkpoint.integrity_hash) return { ok: false, reason: 'corrupted checkpoint' }
  if (checkpoint.mission.schema !== LONG_HORIZON_MISSION_SCHEMA) return { ok: false, reason: 'mission schema mismatch' }
  return { ok: true, reason: 'valid' }
}

export async function saveMission(mission: LongHorizonMission): Promise<string> {
  const file = missionPath(mission.mission_id)
  await atomicWrite(file, JSON.stringify(mission, null, 2) + '\n')
  return file
}

export async function loadMission(missionId: string): Promise<LongHorizonMission | null> {
  const file = missionPath(missionId)
  const tmp = `${file}.tmp`
  if (existsSync(tmp) && !existsSync(file)) return null
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as LongHorizonMission
    if (parsed.schema !== LONG_HORIZON_MISSION_SCHEMA) return null
    if (parsed.hidden_cot !== false) return null
    return parsed
  } catch {
    return null
  }
}

export async function listMissions(): Promise<LongHorizonMission[]> {
  const dir = path.join(engine04StoreRoot(), 'missions')
  if (!existsSync(dir)) return []
  const names = (await readdir(dir)).filter(n => n.endsWith('.json') && !n.endsWith('.tmp.json'))
  const rows: LongHorizonMission[] = []
  for (const name of names) {
    const row = await loadMission(name.replace(/\.json$/, ''))
    if (row) rows.push(row)
  }
  return rows.sort((a, b) => a.updated_at.localeCompare(b.updated_at))
}

export async function saveCheckpoint(checkpoint: MissionCheckpoint): Promise<string> {
  const file = checkpointPath(checkpoint.mission_id, checkpoint.checkpoint_id)
  await atomicWrite(file, JSON.stringify(checkpoint, null, 2) + '\n')
  return file
}

export async function loadCheckpoint(missionId: string, checkpointId: string): Promise<MissionCheckpoint | null> {
  const file = checkpointPath(missionId, checkpointId)
  if (existsSync(`${file}.tmp`) && !existsSync(file)) return null
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as MissionCheckpoint
    const check = verifyCheckpointIntegrity(parsed)
    if (!check.ok) return null
    return parsed
  } catch {
    return null
  }
}

export async function loadLatestCheckpoint(missionId: string): Promise<MissionCheckpoint | null> {
  const dir = checkpointDir(missionId)
  if (!existsSync(dir)) return null
  const names = (await readdir(dir)).filter(n => n.endsWith('.json'))
  let best: MissionCheckpoint | null = null
  for (const name of names) {
    const row = await loadCheckpoint(missionId, name.replace(/\.json$/, ''))
    if (!row) continue
    if (!best || row.created_at > best.created_at) best = row
  }
  return best
}

export async function findLatestActiveByConversation(conversationId: string | null, sessionId: string | null): Promise<LongHorizonMission | null> {
  const all = await listMissions()
  const match = all.filter(row =>
    (conversationId && row.conversation_id === conversationId)
    || (sessionId && row.session_id === sessionId),
  )
  if (!match.length) return null
  return [...match].reverse().find(row => !['COMPLETED', 'CANCELLED', 'FAILED'].includes(row.mission_state)) ?? match.at(-1) ?? null
}
