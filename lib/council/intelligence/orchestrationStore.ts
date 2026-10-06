/**
 * Durable orchestration telemetry / replay / learning records.
 * Structured rationale only. No chain-of-thought. No secrets. No WRIM ingest.
 */

import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { resolveLocalAppDataPaths } from '@/lib/sovereign-runtime/local-ownership/paths'
import type { LearningRecord, MissionReplay, OrchestrationTelemetry } from './orchestrationTypes'

export type PersistedLiveMission = {
  schema: 'war-room.live-cognition.v1'
  mission_id: string
  session_id: string | null
  telemetry: OrchestrationTelemetry
  replay: MissionReplay
  learning: LearningRecord
  hidden_cot: false
}

function storeDir(): string {
  const override = process.env.WAR_ROOM_ORCHESTRATION_STORE
  const root = override || path.join(resolveLocalAppDataPaths().data, 'council', 'orchestration')
  return root
}

export function orchestrationStorePath(missionId: string): string {
  return path.join(storeDir(), `${missionId}.json`)
}

export async function persistLiveMission(record: PersistedLiveMission): Promise<string> {
  const dir = storeDir()
  await mkdir(dir, { recursive: true })
  const file = orchestrationStorePath(record.mission_id)
  await writeFile(file, JSON.stringify(record, null, 2) + '\n')
  return file
}

export async function loadLiveMissionReplay(missionId: string): Promise<MissionReplay | null> {
  const file = orchestrationStorePath(missionId)
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as PersistedLiveMission
    if (parsed.replay && (parsed as { replay?: { executable?: boolean } }).replay?.executable) return null
    return parsed.replay
  } catch {
    return null
  }
}

export async function listLiveMissionIds(): Promise<string[]> {
  const dir = storeDir()
  if (!existsSync(dir)) return []
  const names = await readdir(dir)
  return names.filter(name => name.endsWith('.json')).map(name => name.replace(/\.json$/, ''))
}
