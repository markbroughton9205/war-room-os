import { mkdir, readFile, appendFile, readdir } from 'node:fs/promises'
import { parseJsonRecovering, writeFileAtomic } from './foundryAtomicJson'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { foundryDataHierarchy } from './foundryPaths'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'
import { resolveBaseRepoRoot } from '@/lib/repo/paths'
import {
  LEGAL_TRANSITIONS,
  type FoundryJournalEntry,
  type FoundryMissionRecord,
  type FoundryMissionState,
} from './foundryMissionTypes'

function dataDir(): string {
  return foundryDataHierarchy().missions
}

function repoMirrorDir(): string {
  return path.join(resolveBaseRepoRoot(), '.war-room', 'foundry-missions')
}

function missionPath(id: string, root: string): string {
  return path.join(root, `${id}.json`)
}

function journalPath(id: string, root: string): string {
  return path.join(root, `${id}.journal.jsonl`)
}

export async function saveMission(mission: FoundryMissionRecord): Promise<void> {
  const existingFile = missionPath(mission.missionId, dataDir())
  if (existsSync(existingFile)) {
    try {
      const read = parseJsonRecovering<FoundryMissionRecord>(await readFile(existingFile, 'utf8'))
      if (!read.ok) throw new Error(read.error)
      const existing = read.value
      if (existing.archived && mission.archived !== false) {
        mission.archived = true
        mission.visibility = 'system'
        mission.testArtifact = true
        mission.classification ??= existing.classification
        mission.classificationEvidence ??= existing.classificationEvidence
        mission.archivedAt ??= existing.archivedAt
      }
      if (existing.superseded && mission.superseded !== false) {
        mission.superseded = true
        mission.resumeEligible = false
        mission.archived = true
        mission.visibility = 'system'
        mission.testArtifact = true
      }
      if (existing.resumeEligible === false && mission.resumeEligible !== true) {
        mission.resumeEligible = false
      }
    } catch {
      /* keep incoming record */
    }
  }
  mission.updatedAt = new Date().toISOString()
  const json = JSON.stringify(mission, null, 2)
  for (const root of [dataDir(), repoMirrorDir()]) {
    await mkdir(root, { recursive: true })
    await writeFileAtomic(missionPath(mission.missionId, root), json)
  }
  if (mission.writeSet?.established) {
    const { persistMissionWriteSet } = await import('./foundryMissionWriteSet')
    await persistMissionWriteSet(mission)
  }
  const { upsertRegistry } = await import('./foundryMissionRegistry')
  await upsertRegistry(mission)
}

export async function loadMission(missionId: string): Promise<FoundryMissionRecord | null> {
  for (const root of [dataDir(), repoMirrorDir()]) {
    const file = missionPath(missionId, root)
    if (!existsSync(file)) continue
    try {
      const read = parseJsonRecovering<FoundryMissionRecord>(await readFile(file, 'utf8'))
      if (read.ok) return read.value
      throw new Error(read.error)
    } catch {
      continue
    }
  }
  return null
}

export async function listAllMissions(): Promise<FoundryMissionRecord[]> {
  await mkdir(dataDir(), { recursive: true })
  const names = (await readdir(dataDir())).filter(name => name.endsWith('.json') && !name.endsWith('.journal.json'))
  const missions = await Promise.all(names.map(async name => {
    try {
      const read = parseJsonRecovering<FoundryMissionRecord>(await readFile(path.join(dataDir(), name), 'utf8'))
      if (read.ok) return read.value
      throw new Error(read.error)
    } catch {
      return null
    }
  }))
  return missions
    .filter((mission): mission is FoundryMissionRecord => mission !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function listMissions(limit = 30): Promise<FoundryMissionRecord[]> {
  const missions = await listAllMissions()
  return missions.slice(0, Math.max(1, Math.min(limit, 500)))
}

export async function appendJournal(mission: FoundryMissionRecord, entry: Omit<FoundryJournalEntry, 'at'>): Promise<void> {
  const full: FoundryJournalEntry = { at: new Date().toISOString(), ...entry }
  mission.journal = [...mission.journal, full].slice(-400)
  const line = `${JSON.stringify(full)}\n`
  for (const root of [dataDir(), repoMirrorDir()]) {
    await mkdir(root, { recursive: true })
    await appendFile(journalPath(mission.missionId, root), line, 'utf8')
  }
}

export async function transitionMission(mission: FoundryMissionRecord, next: FoundryMissionState, reason: string): Promise<void> {
  if (mission.status === next) {
    mission.phase = next
    await appendJournal(mission, { kind: 'transition', text: `Already ${next}: ${reason}` })
    const { isTerminalClaimMission, releaseTerminalMissionClaims } = await import('./foundryTerminalResourceRelease')
    if (isTerminalClaimMission(mission)) {
      await releaseTerminalMissionClaims(mission)
    }
    await saveMission(mission)
    return
  }
  const allowed = LEGAL_TRANSITIONS[mission.status] ?? []
  if (!allowed.includes(next)) {
    await appendJournal(mission, {
      kind: 'transition',
      text: `Illegal transition ${mission.status} → ${next} ignored (${reason}).`,
    })
    await saveMission(mission)
    throw new Error(`Illegal mission transition ${mission.status} → ${next}`)
  }
  const from = mission.status
  mission.status = next
  mission.phase = next
  await appendJournal(mission, { kind: 'transition', text: `${from} → ${next}: ${reason}` })
  await logWarRoomRepoAudit('foundry-mission: transition', { missionId: mission.missionId, from, next, reason })
  const { isTerminalClaimMission, releaseTerminalMissionClaims } = await import('./foundryTerminalResourceRelease')
  if (isTerminalClaimMission(mission)) {
    await releaseTerminalMissionClaims(mission)
  }
  await saveMission(mission)
}

export function summarizeContext(mission: FoundryMissionRecord): FoundryMissionRecord['context'] {
  return {
    goal: mission.goal,
    currentPlan: mission.plan.map(s => `${s.status}:${s.intent}:${s.title}`),
    architectureFindings: mission.observations.filter(o => o.source === 'architecture').map(o => o.text).slice(-12),
    changedFiles: mission.sourceState.changedFiles,
    currentErrors: mission.errors.slice(-8).map(e => `${e.klass}: ${e.message}`),
    latestObservations: mission.observations.slice(-8).map(o => o.text),
    unresolvedQuestions: mission.blocker ? [mission.blocker.blocker] : [],
    completion: mission.completionGate.detail,
  }
}
