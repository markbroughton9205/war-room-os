/**
 * Persist mission runtimes, leases, checkpoints, wake index, and durable actions
 * under the existing Foundry contracts hierarchy. No unrelated database.
 */
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { foundryContractsRoot } from './foundryContractStore'
import type {
  FoundryDurableRuntimeAction,
  FoundryMissionRuntimeRecord,
  FoundryRuntimeCheckpoint,
  FoundryRuntimeLease,
  FoundryWakeEntry,
} from './foundryMissionRuntimeTypes'
import { FOUNDRY_RUNTIME_TERMINAL_STATES } from './foundryMissionRuntimeTypes'

function runtimeRoot(): string {
  const root = path.join(foundryContractsRoot(), 'runtimes')
  mkdirSync(path.join(root, 'leases'), { recursive: true })
  mkdirSync(path.join(root, 'checkpoints'), { recursive: true })
  mkdirSync(path.join(root, 'actions'), { recursive: true })
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

export function saveMissionRuntime(record: FoundryMissionRuntimeRecord): FoundryMissionRuntimeRecord {
  const root = runtimeRoot()
  atomicWrite(path.join(root, `${record.runtimeId}.json`), record)
  if (!FOUNDRY_RUNTIME_TERMINAL_STATES.includes(record.state)) {
    atomicWrite(path.join(root, `active-${record.missionId}.json`), { runtimeId: record.runtimeId, missionId: record.missionId })
  } else {
    const pointer = path.join(root, `active-${record.missionId}.json`)
    if (existsSync(pointer)) {
      try { unlinkSync(pointer) } catch { /* keep history */ }
    }
  }
  return record
}

export function loadMissionRuntime(runtimeId: string): FoundryMissionRuntimeRecord | null {
  return readJson(path.join(runtimeRoot(), `${runtimeId}.json`))
}

export function loadActiveMissionRuntime(missionId: string): FoundryMissionRuntimeRecord | null {
  const pointer = readJson<{ runtimeId: string }>(path.join(runtimeRoot(), `active-${missionId}.json`))
  if (pointer?.runtimeId) {
    const loaded = loadMissionRuntime(pointer.runtimeId)
    if (loaded && !FOUNDRY_RUNTIME_TERMINAL_STATES.includes(loaded.state)) return loaded
  }
  return listMissionRuntimes(missionId).filter(item => !FOUNDRY_RUNTIME_TERMINAL_STATES.includes(item.state)).sort((a, b) => b.runtimeGeneration - a.runtimeGeneration)[0] ?? null
}

export function listMissionRuntimes(missionId?: string): FoundryMissionRuntimeRecord[] {
  const root = runtimeRoot()
  return readdirSync(root)
    .filter(name => name.endsWith('.json') && !name.startsWith('active-') && name !== 'wake-index.json')
    .map(name => readJson<FoundryMissionRuntimeRecord>(path.join(root, name)))
    .filter((item): item is FoundryMissionRuntimeRecord => Boolean(item && (!missionId || item.missionId === missionId)))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
}

export function listActiveMissionRuntimes(): FoundryMissionRuntimeRecord[] {
  return listMissionRuntimes().filter(item => !FOUNDRY_RUNTIME_TERMINAL_STATES.includes(item.state))
}

export function saveRuntimeLease(lease: FoundryRuntimeLease): FoundryRuntimeLease {
  atomicWrite(path.join(runtimeRoot(), 'leases', `${lease.missionId}.json`), lease)
  return lease
}

export function loadRuntimeLease(missionId: string): FoundryRuntimeLease | null {
  return readJson(path.join(runtimeRoot(), 'leases', `${missionId}.json`))
}

export function tryCreateRuntimeLease(lease: FoundryRuntimeLease): { ok: true; lease: FoundryRuntimeLease } | { ok: false; existing: FoundryRuntimeLease | null } {
  const dest = path.join(runtimeRoot(), 'leases', `${lease.missionId}.json`)
  mkdirSync(path.dirname(dest), { recursive: true })
  try {
    const fd = openSync(dest, 'wx')
    try {
      writeFileSync(fd, JSON.stringify(lease, null, 2))
    } finally {
      closeSync(fd)
    }
    return { ok: true, lease }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EEXIST') return { ok: false, existing: loadRuntimeLease(lease.missionId) }
    throw error
  }
}

export function releaseRuntimeLease(missionId: string, expectedLeaseId?: string): void {
  const current = loadRuntimeLease(missionId)
  if (expectedLeaseId && current && current.leaseId !== expectedLeaseId) return
  const dest = path.join(runtimeRoot(), 'leases', `${missionId}.json`)
  if (existsSync(dest)) {
    try { unlinkSync(dest) } catch { /* ignore */ }
  }
}

export function saveRuntimeCheckpoint(checkpoint: FoundryRuntimeCheckpoint): FoundryRuntimeCheckpoint {
  const dir = path.join(runtimeRoot(), 'checkpoints', checkpoint.runtimeId)
  mkdirSync(dir, { recursive: true })
  atomicWrite(path.join(dir, `${checkpoint.checkpointId}.json`), checkpoint)
  return checkpoint
}

export function loadLatestRuntimeCheckpoint(runtimeId: string): FoundryRuntimeCheckpoint | null {
  const dir = path.join(runtimeRoot(), 'checkpoints', runtimeId)
  if (!existsSync(dir)) return null
  const rows = readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .map(name => readJson<FoundryRuntimeCheckpoint>(path.join(dir, name)))
    .filter((item): item is FoundryRuntimeCheckpoint => Boolean(item))
    .sort((a, b) => b.at.localeCompare(a.at))
  return rows[0] ?? null
}

export function saveDurableRuntimeAction(action: FoundryDurableRuntimeAction): FoundryDurableRuntimeAction {
  atomicWrite(path.join(runtimeRoot(), 'actions', `${action.actionId}.json`), action)
  return action
}

export function loadDurableRuntimeAction(actionId: string): FoundryDurableRuntimeAction | null {
  return readJson(path.join(runtimeRoot(), 'actions', `${actionId}.json`))
}

export function listDurableRuntimeActions(missionId?: string): FoundryDurableRuntimeAction[] {
  const dir = path.join(runtimeRoot(), 'actions')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .map(name => readJson<FoundryDurableRuntimeAction>(path.join(dir, name)))
    .filter((item): item is FoundryDurableRuntimeAction => Boolean(item && (!missionId || item.missionId === missionId)))
}

function wakeIndexPath(): string {
  return path.join(runtimeRoot(), 'wake-index.json')
}

export function loadWakeIndex(): FoundryWakeEntry[] {
  return readJson<FoundryWakeEntry[]>(wakeIndexPath()) ?? []
}

export function saveWakeIndex(entries: FoundryWakeEntry[]): FoundryWakeEntry[] {
  atomicWrite(wakeIndexPath(), entries)
  return entries
}
