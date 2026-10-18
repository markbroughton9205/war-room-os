/**
 * Isolated execution workspaces: git worktree when possible, otherwise a source snapshot.
 * Persistent user data stays on the project; tests use runtime-data copies.
 */
import { existsSync, mkdirSync, cpSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { foundryDataHierarchy } from './foundryPaths'
import { resolveBaseRepoRoot } from '@/lib/repo/paths'
import type { FoundryWorkspaceKind, FoundryWorkspaceRecord } from './foundryAgentTypes'

const SKIP = new Set(['node_modules', 'data', '.foundry-workspaces', '.git'])

function workspaceBase(workspaceId: string): string {
  const root = process.env.FOUNDRY_AGENT_WORKSPACES_ROOT?.trim() || foundryDataHierarchy().agentWorkspaces
  mkdirSync(root, { recursive: true })
  return path.join(root, workspaceId)
}

export function isGitRepository(projectRoot: string): boolean {
  return existsSync(path.join(projectRoot, '.git'))
}

export function createIsolatedWorkspace(input: {
  projectId: string
  projectRoot: string
  missionId: string
  taskId: string
  agentId: string
  graphId: string
  mutating: boolean
}): FoundryWorkspaceRecord {
  const workspaceId = randomUUID()
  const base = workspaceBase(workspaceId)
  mkdirSync(base, { recursive: true })
  const sourceRoot = path.join(base, 'source')
  const runtimeDataRoot = path.join(base, 'runtime-data')
  mkdirSync(runtimeDataRoot, { recursive: true })
  const persistentDataRoot = path.join(input.projectRoot, 'data')
  mkdirSync(persistentDataRoot, { recursive: true })

  let kind: FoundryWorkspaceKind = 'snapshot'
  let baseRevision: string | null = null
  if (!input.mutating) {
    kind = 'project-root'
    return persistMeta({
      workspaceId,
      kind,
      projectId: input.projectId,
      missionId: input.missionId,
      taskId: input.taskId,
      agentId: input.agentId,
      graphId: input.graphId,
      sourceRoot: input.projectRoot,
      runtimeDataRoot,
      persistentDataRoot,
      baseRevision: gitRev(input.projectRoot),
      filesChanged: [],
      mergeStatus: 'UNMERGED',
      createdAt: new Date().toISOString(),
      cleaned: false,
    }, base)
  }

  if (isGitRepository(input.projectRoot)) {
    const added = spawnSync('git', ['-C', input.projectRoot, 'worktree', 'add', '--detach', sourceRoot, 'HEAD'], {
      encoding: 'utf8',
      timeout: 20_000,
    })
    if (added.status === 0 && existsSync(sourceRoot)) {
      kind = 'git-worktree'
      baseRevision = gitRev(sourceRoot)
    }
  }
  if (kind !== 'git-worktree') {
    mkdirSync(sourceRoot, { recursive: true })
    snapshotCopy(input.projectRoot, sourceRoot)
    kind = 'snapshot'
    baseRevision = gitRev(input.projectRoot)
  }
  seedRuntimeData(persistentDataRoot, runtimeDataRoot)
  return persistMeta({
    workspaceId,
    kind,
    projectId: input.projectId,
    missionId: input.missionId,
    taskId: input.taskId,
    agentId: input.agentId,
    graphId: input.graphId,
    sourceRoot,
    runtimeDataRoot,
    persistentDataRoot,
    baseRevision,
    filesChanged: [],
    mergeStatus: 'UNMERGED',
    createdAt: new Date().toISOString(),
    cleaned: false,
  }, base)
}

export function cleanupWorkspace(workspace: FoundryWorkspaceRecord, opts?: { force?: boolean }): FoundryWorkspaceRecord {
  if (workspace.cleaned) return workspace
  if (!opts?.force && (workspace.mergeStatus === 'UNMERGED' || workspace.mergeStatus === 'CONFLICT')) return workspace
  const base = path.dirname(workspace.sourceRoot)
  if (workspace.kind === 'git-worktree') {
    spawnSync('git', ['worktree', 'remove', '--force', workspace.sourceRoot], { encoding: 'utf8', timeout: 15_000 })
  }
  if (workspace.kind !== 'project-root' && existsSync(base) && base !== workspace.persistentDataRoot && !base.startsWith(path.resolve(workspace.persistentDataRoot))) {
    rmSync(base, { recursive: true, force: true })
  }
  return { ...workspace, cleaned: true, mergeStatus: workspace.mergeStatus === 'MERGED' ? 'MERGED' : 'PRESERVED' }
}

function snapshotCopy(from: string, to: string): void {
  cpSync(from, to, {
    recursive: true,
    filter: (src) => {
      const name = path.basename(src)
      if (SKIP.has(name)) return false
      if (name.endsWith('.sqlite') || name.endsWith('.sqlite-wal') || name.endsWith('.sqlite-shm')) return false
      return true
    },
  })
}

function seedRuntimeData(persistent: string, runtime: string): void {
  if (!existsSync(persistent)) return
  cpSync(persistent, runtime, {
    recursive: true,
    filter: (src) => !path.basename(src).startsWith('.'),
  })
}

function gitRev(root: string): string | null {
  if (!isGitRepository(root)) return null
  const rev = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 5000 })
  return rev.status === 0 ? rev.stdout.trim() : null
}

function persistMeta(record: FoundryWorkspaceRecord, base: string): FoundryWorkspaceRecord {
  writeFileSync(path.join(base, 'workspace.json'), JSON.stringify(record, null, 2), 'utf8')
  return record
}

export function readWorkspaceMeta(workspaceId: string): FoundryWorkspaceRecord | null {
  const dest = path.join(workspaceBase(workspaceId), 'workspace.json')
  if (!existsSync(dest)) return null
  try {
    return JSON.parse(readFileSync(dest, 'utf8')) as FoundryWorkspaceRecord
  } catch {
    return null
  }
}

export function writeWorkspaceFile(workspace: FoundryWorkspaceRecord, relPath: string, content: string): { ok: true; rel: string } | { ok: false; error: string } {
  const rel = relPath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (rel.includes('..') || path.isAbsolute(relPath)) return { ok: false, error: 'Path escapes workspace.' }
  if (rel === 'data' || rel.startsWith('data/')) {
    return { ok: false, error: 'Refusing persistent project data write from an isolated agent workspace.' }
  }
  const abs = path.resolve(workspace.sourceRoot, rel)
  const root = path.resolve(workspace.sourceRoot)
  if (!abs.startsWith(root + path.sep) && abs !== root) return { ok: false, error: 'Path escapes workspace.' }
  const warRoom = path.resolve(resolveBaseRepoRoot())
  if (abs === warRoom || abs.startsWith(warRoom + path.sep)) {
    return { ok: false, error: 'REFUSED_PROTECTED_SUBSYSTEM: cannot write War Room, Terra, or WRIM.' }
  }
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, content, 'utf8')
  if (!workspace.filesChanged.includes(rel)) workspace.filesChanged.push(rel)
  persistMeta(workspace, workspaceBase(workspace.workspaceId))
  return { ok: true, rel }
}

export function applyWorkspaceFilesToProject(input: {
  workspace: FoundryWorkspaceRecord
  projectRoot: string
  files?: string[]
}): { applied: string[]; skipped: string[] } {
  const applied: string[] = []
  const skipped: string[] = []
  const files = input.files ?? input.workspace.filesChanged
  for (const rel of files) {
    const from = path.join(input.workspace.sourceRoot, rel)
    if (!existsSync(from)) {
      skipped.push(rel)
      continue
    }
    const to = path.resolve(input.projectRoot, rel)
    const root = path.resolve(input.projectRoot)
    if (!to.startsWith(root + path.sep) && to !== root) {
      skipped.push(rel)
      continue
    }
    if (rel === 'data' || rel.startsWith('data/')) {
      skipped.push(rel)
      continue
    }
    mkdirSync(path.dirname(to), { recursive: true })
    writeFileSync(to, readFileSync(from), 'utf8')
    applied.push(rel)
  }
  return { applied, skipped }
}
