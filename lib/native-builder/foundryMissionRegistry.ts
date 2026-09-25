import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { resolveBaseRepoRoot } from '@/lib/repo/paths'
import { foundryDataHierarchy } from './foundryPaths'
import type { FoundryMissionRecord } from './foundryMissionTypes'
import {
  PRIORITY_RANK,
  type FoundryMissionPriority,
  type FoundryRegistryEntry,
} from './foundryOperationsTypes'
import { listMissions } from './foundryMissionStore'

function registryPath(): string {
  return path.join(foundryDataHierarchy().registry, 'missions.json')
}

export function toRegistryEntry(mission: FoundryMissionRecord): FoundryRegistryEntry {
  return {
    missionId: mission.missionId,
    title: mission.title,
    goal: mission.goal,
    priority: mission.priority ?? 'NORMAL',
    createdAt: mission.createdAt,
    updatedAt: mission.updatedAt,
    status: mission.status,
    phase: mission.phase,
    owner: mission.owner ?? 'commander',
    workspace: mission.workspace ?? resolveBaseRepoRoot(),
    repoIdentity: mission.repoIdentity ?? resolveBaseRepoRoot(),
    modelProvider: mission.pinnedModel?.provider ?? mission.modelState?.activeProvider ?? null,
    modelId: mission.pinnedModel?.modelId ?? mission.modelState?.activeModel ?? null,
    authorizationWaiting: Boolean(mission.authorization?.waiting),
    currentAction: mission.currentAction ?? mission.modelState?.lastExpectedObservation ?? null,
    activeToolCall: mission.activeToolCallId ?? null,
    lockClaims: (mission.lockClaims ?? []).map(claim => claim.resource),
    runtimeClaims: mission.runtimeClaims ?? [],
    lastHeartbeat: mission.lastHeartbeat ?? null,
    resumeToken: mission.resumeToken ?? mission.missionId,
    stateVersion: mission.stateVersion ?? 1,
    completionGate: mission.completionGate,
    blockedReason: mission.blocker?.blocker ?? null,
    recovered: Boolean(mission.recovery?.recovered),
    recoveryDisposition: mission.recovery?.disposition ?? null,
    visibility: mission.visibility ?? 'commander',
    archived: Boolean(mission.archived),
    superseded: Boolean(mission.superseded),
    resumeEligible: mission.resumeEligible !== false && !mission.archived && !mission.superseded,
    testArtifact: Boolean(mission.testArtifact),
    classification: mission.classification,
  }
}

export async function loadRegistry(): Promise<FoundryRegistryEntry[]> {
  if (!existsSync(registryPath())) return []
  try {
    const parsed = JSON.parse(await readFile(registryPath(), 'utf8')) as FoundryRegistryEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function upsertRegistry(mission: FoundryMissionRecord): Promise<FoundryRegistryEntry> {
  const entries = await loadRegistry()
  const next = toRegistryEntry(mission)
  const index = entries.findIndex(item => item.missionId === mission.missionId)
  if (index >= 0) entries[index] = next
  else entries.unshift(next)
  entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  await mkdir(path.dirname(registryPath()), { recursive: true })
  await writeFile(registryPath(), JSON.stringify(entries.slice(0, 200), null, 2), 'utf8')
  return next
}

export async function rebuildRegistry(): Promise<FoundryRegistryEntry[]> {
  const missions = await listMissions(500)
  const entries = missions.map(toRegistryEntry)
  await mkdir(path.dirname(registryPath()), { recursive: true })
  await writeFile(registryPath(), JSON.stringify(entries, null, 2), 'utf8')
  return entries
}

export function sortByPriority(entries: FoundryRegistryEntry[]): FoundryRegistryEntry[] {
  return [...entries].sort((a, b) => {
    const rank = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    if (rank !== 0) return rank
    return a.createdAt.localeCompare(b.createdAt)
  })
}

export function groupOperationsQueue(entries: FoundryRegistryEntry[]) {
  return {
    active: entries.filter(item => !['COMPLETE', 'FAILED', 'CANCELLED', 'QUEUED', 'PAUSED', 'BLOCKED', 'WAITING_AUTHORIZATION', 'WAITING_RESOURCE', 'ACTIVATION_PENDING'].includes(item.status)),
    queued: entries.filter(item => item.status === 'QUEUED'),
    blocked: entries.filter(item => item.status === 'BLOCKED'),
    waitingAuthorization: entries.filter(item => item.status === 'WAITING_AUTHORIZATION' || item.authorizationWaiting),
    waitingResource: entries.filter(item => item.status === 'WAITING_RESOURCE' || item.status === 'ACTIVATION_PENDING'),
    paused: entries.filter(item => item.status === 'PAUSED'),
    recovering: entries.filter(item => item.status === 'RECOVERING' || item.recovered && item.recoveryDisposition === 'RECONCILING'),
    complete: entries.filter(item => item.status === 'COMPLETE'),
  }
}

export function nextPriority(value: FoundryMissionPriority | undefined): FoundryMissionPriority {
  return value ?? 'NORMAL'
}
