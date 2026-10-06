import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { describeSourceWorkspaceState } from './foundryWorkspaceIdentity'
import type { FoundryMissionRecord } from './foundryMissionTypes'
import type { FoundrySourceBaseline } from './foundryOperationsTypes'
import { listResourceClaims } from './foundryResourceLocks'
import { missionRepoWriteRoot, repoWriteScope, repoWriteScopesOverlap } from './foundryRepoWriteScope'
import { listMissions } from './foundryMissionStore'

function fileHash(abs: string): string | null {
  if (!existsSync(abs)) return null
  try {
    return createHash('sha256').update(readFileSync(abs)).digest('hex')
  } catch {
    return null
  }
}

export async function recordMissionBaseline(
  mission: FoundryMissionRecord,
  files: string[] = [],
): Promise<FoundrySourceBaseline> {
  const root = resolveRepoRoot()
  const git = describeSourceWorkspaceState(root)
  const dirty = existsSync(path.join(root, '.git'))
    ? (await readFile(path.join(root, '.git', 'HEAD'), 'utf8').catch(() => '')).trim()
    : ''
  const fileHashes: Record<string, string> = { ...(mission.baseline?.fileHashes ?? {}) }
  for (const rel of files) {
    const hash = fileHash(path.join(root, rel))
    if (hash) fileHashes[rel] = hash
  }
  const baseline: FoundrySourceBaseline = {
    recordedAt: new Date().toISOString(),
    branch: git.branch,
    head: git.head,
    dirtyFiles: git.dirty ? [dirty || 'dirty'] : [],
    fileHashes,
    activeInstallId: mission.runtimeState.activeInstallId,
    runningInstallId: mission.runtimeState.runningInstallId,
  }
  mission.baseline = baseline
  return baseline
}

export function intendedWritePaths(input: Record<string, unknown>): string[] {
  const paths: string[] = []
  if (typeof input.path === 'string') paths.push(input.path)
  if (typeof input.from === 'string') paths.push(input.from)
  if (typeof input.to === 'string') paths.push(input.to)
  const proposal = input.proposal as { plannedChanges?: Array<{ file?: string }> } | undefined
  if (Array.isArray(proposal?.plannedChanges)) {
    for (const change of proposal.plannedChanges) {
      if (change.file) paths.push(change.file)
    }
  }
  return [...new Set(paths)]
}

export async function detectWriteConflict(
  mission: FoundryMissionRecord,
  paths: string[],
): Promise<{ conflict: boolean; reason?: string; holders?: string[] }> {
  const scope = await repoWriteScope(await missionRepoWriteRoot(mission), paths)
  const claims = await listResourceClaims()
  const writeHolders = claims.filter(claim => claim.resource === 'REPO_WRITE' && claim.missionId !== mission.missionId)
  const overlappingHolders = writeHolders.filter(claim => repoWriteScopesOverlap(scope, claim.repoWriteScope))
  if (overlappingHolders.length) {
    return {
      conflict: true,
      reason: `REPO_WRITE held by ${overlappingHolders.map(item => item.missionId).join(', ')} for overlapping or unverified physical workspace scope; requested paths ${paths.join(', ')}`,
      holders: overlappingHolders.map(item => item.missionId),
    }
  }
  const activeWriteStates = new Set([
    'EXECUTING', 'UNDERSTANDING', 'INSPECTING', 'PLANNING', 'VALIDATING',
    'BUILDING', 'PACKAGING', 'INSTALLING', 'VERIFYING', 'REPLANNING', 'RECOVERING',
  ])
  const peers: FoundryMissionRecord[] = []
  for (const peer of await listMissions(80)) {
    if (peer.missionId === mission.missionId || !activeWriteStates.has(peer.status) || !peer.sourceState.changedFiles.length) continue
    try {
      // An unbound peer has unknown physical scope. Do not borrow the requesting mission's async workspace.
      if (!peer.workspaceBinding) { peers.push(peer); continue }
      const peerScope = await repoWriteScope(await missionRepoWriteRoot(peer), peer.sourceState.changedFiles)
      if (repoWriteScopesOverlap(scope, peerScope)) peers.push(peer)
    } catch { peers.push(peer) } // invalid/retargeted peer binding retains exclusion
  }
  if (peers.length) {
    return {
      conflict: true,
      reason: `Peer mission has overlapping or unverified physical workspace scope; requested paths ${paths.join(', ')}: ${peers.map(item => item.missionId).join(', ')}`,
      holders: peers.map(item => item.missionId),
    }
  }
  return { conflict: false }
}

export function reconcileWriteBaseline(
  mission: FoundryMissionRecord,
  relPath: string,
): { ok: true } | { ok: false; reason: string } {
  const root = resolveRepoRoot()
  const current = fileHash(path.join(root, relPath))
  const expected = mission.baseline?.fileHashes[relPath]
  if (!expected || !current) return { ok: true }
  if (current !== expected && !mission.sourceState.changedFiles.includes(relPath)) {
    return {
      ok: false,
      reason: `File ${relPath} changed externally after mission baseline. Re-read and replan; do not blindly patch.`,
    }
  }
  return { ok: true }
}

export function rememberTouchedHash(mission: FoundryMissionRecord, relPath: string): void {
  const hash = fileHash(path.join(resolveRepoRoot(), relPath))
  if (!hash) return
  mission.baseline ??= {
    recordedAt: new Date().toISOString(),
    branch: null,
    head: null,
    dirtyFiles: [],
    fileHashes: {},
    activeInstallId: mission.runtimeState.activeInstallId,
    runningInstallId: mission.runtimeState.runningInstallId,
  }
  mission.baseline.fileHashes[relPath] = hash
}
