/**
 * Adaptive experience / playbook / WRIM-eval staging store.
 * Structured records only. No CoT. No secrets. No WRIM training.
 */

import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { resolveLocalAppDataPaths } from '@/lib/sovereign-runtime/local-ownership/paths'
import type { LearningRecord } from './orchestrationTypes'
import type { MissionExperienceRecord, RecoveryPlaybook, LearningScreenDecision } from './adaptiveIntelligence'

function rootDir(): string {
  const override = process.env.WAR_ROOM_ADAPTIVE_STORE
  return override || path.join(resolveLocalAppDataPaths().data, 'council', 'adaptive')
}

function expDir(): string { return path.join(rootDir(), 'experience') }
function stageDir(): string { return path.join(rootDir(), 'wrim-eval-staging') }
function playbookDir(): string { return path.join(rootDir(), 'playbooks') }

export async function persistExperience(record: MissionExperienceRecord): Promise<string> {
  await mkdir(expDir(), { recursive: true })
  const file = path.join(expDir(), `${record.mission_id}.json`)
  await writeFile(file, JSON.stringify(record, null, 2) + '\n')
  return file
}

export async function loadExperience(missionId: string): Promise<MissionExperienceRecord | null> {
  const file = path.join(expDir(), `${missionId}.json`)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(await readFile(file, 'utf8')) as MissionExperienceRecord
  } catch {
    return null
  }
}

export async function listExperience(): Promise<MissionExperienceRecord[]> {
  if (!existsSync(expDir())) return []
  const names = (await readdir(expDir())).filter(n => n.endsWith('.json'))
  const rows: MissionExperienceRecord[] = []
  for (const name of names) {
    try {
      rows.push(JSON.parse(await readFile(path.join(expDir(), name), 'utf8')) as MissionExperienceRecord)
    } catch { /* skip */ }
  }
  return rows.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

export async function persistPlaybook(playbook: RecoveryPlaybook): Promise<string> {
  await mkdir(playbookDir(), { recursive: true })
  const file = path.join(playbookDir(), `${playbook.playbook_id}.json`)
  await writeFile(file, JSON.stringify(playbook, null, 2) + '\n')
  return file
}

export async function loadPlaybook(id: string): Promise<RecoveryPlaybook | null> {
  const file = path.join(playbookDir(), `${id}.json`)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(await readFile(file, 'utf8')) as RecoveryPlaybook
  } catch {
    return null
  }
}

export type StagedWrimEval = {
  schema: 'war-room.wrim-eval-staging.v1'
  mission_id: string
  decision: LearningScreenDecision
  trains_wrim: false
  purpose: 'evaluation'
  provenance: string
  record: LearningRecord
}

export async function persistStagedEval(row: StagedWrimEval): Promise<string> {
  await mkdir(stageDir(), { recursive: true })
  const file = path.join(stageDir(), `${row.mission_id}.json`)
  await writeFile(file, JSON.stringify(row, null, 2) + '\n')
  return file
}

export async function listStagedEval(): Promise<StagedWrimEval[]> {
  if (!existsSync(stageDir())) return []
  const names = (await readdir(stageDir())).filter(n => n.endsWith('.json'))
  const rows: StagedWrimEval[] = []
  for (const name of names) {
    try {
      const parsed = JSON.parse(await readFile(path.join(stageDir(), name), 'utf8')) as StagedWrimEval
      if (parsed.trains_wrim === false && parsed.purpose === 'evaluation') rows.push(parsed)
    } catch { /* skip */ }
  }
  return rows
}
