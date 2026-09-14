/**
 * Workspace registry — canonical Engineer project identity.
 *
 * Extends Phase B: still stores JSON under the process base repo (resolveBaseRepoRoot),
 * still uses realpath to close traversal/symlink tricks at registration. Adds:
 *   - configurable projects root (WAR_ROOM_PROJECTS_ROOT, default C:\\Users\\markb\\WarRoomProjects)
 *   - prefix allowlist (War Room root exact + projects root children)
 *   - New Project (empty directory under projects root)
 *   - Open existing non-git directories that sit inside the allowlist
 *   - richer records (git/package/runtime/memory pointers)
 *
 * CODE_OPERATOR_ALLOWED_ROOTS is retained as a historical extra root (if it exists on disk).
 * It is no longer the sole allowlist.
 */
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolveBaseRepoRoot } from '@/lib/repo/paths'
import { recordBoundaryViolation } from './boundaryLog'
import {
  WAR_ROOM_CANONICAL_WORKSPACE_ID,
  classifyWorkspaceRoot,
  decorateWorkspaceIdentity,
  getCanonicalWarRoomSourceRoot,
  type FoundryWorkspaceType,
} from './foundryWorkspaceIdentity'

const execFileAsync = promisify(execFile)

export interface WorkspaceRecord {
  id: string
  root: string
  label: string
  createdAt: string
  name?: string
  path?: string
  projectType?: 'war_room' | 'new_project' | 'existing_project' | 'external_repository'
  lastOpenedAt?: string
  gitRepository?: boolean
  gitBranch?: string
  allowedScope?: string
  validationCommands?: string[]
  packageManager?: 'pnpm' | 'npm' | 'yarn' | 'pip' | 'uv' | 'cargo' | 'dotnet' | 'none'
  runtime?: string
  framework?: string
  projectMemoryRel?: string
  missionHistory?: string[]
  workspaceType?: FoundryWorkspaceType
  displayTitle?: string
  displayKind?: string
}

const REGISTRY_REL = path.join('.war-room', 'workspaces', 'registry.json')
/** Historical exact-root allowlist — still honored if the path exists. */
export const CODE_OPERATOR_ALLOWED_ROOTS = ['/Users/markbroughton/Developer/war-room-os'] as const

function registryPath(): string {
  return path.join(resolveBaseRepoRoot(), REGISTRY_REL)
}

export function getProjectsRoot(): string {
  const env = process.env.WAR_ROOM_PROJECTS_ROOT?.trim()
  if (env) return path.resolve(env)
  if (process.platform === 'win32') return 'C:\\Users\\markb\\WarRoomProjects'
  return path.join(os.homedir(), 'WarRoomProjects')
}

export async function getEngineerAllowedRoots(): Promise<string[]> {
  const roots: string[] = []
  const add = async (candidate: string) => {
    try {
      const canonical = await realpath(candidate)
      if (!roots.includes(canonical)) roots.push(canonical)
    } catch {
      /* not present on this machine — skip, never fabricate */
    }
  }
  await add(getCanonicalWarRoomSourceRoot())
  const base = resolveBaseRepoRoot()
  if (classifyWorkspaceRoot(base) !== 'INSTALLED_RUNTIME') await add(base)
  try {
    await mkdir(getProjectsRoot(), { recursive: true })
    await add(getProjectsRoot())
  } catch {
    /* projects root could not be created */
  }
  for (const historical of CODE_OPERATOR_ALLOWED_ROOTS) {
    await add(historical)
  }
  const extra = process.env.WAR_ROOM_ENGINEER_ALLOWED_ROOTS?.split(path.delimiter) ?? []
  for (const item of extra) {
    if (item.trim()) await add(item.trim())
  }
  return roots
}

export function isPathInsideRoot(canonicalPath: string, canonicalRoot: string): boolean {
  const rel = path.relative(canonicalRoot, canonicalPath)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

export async function assertPathInsideAllowedRoots(canonicalPath: string): Promise<{ ok: true; root: string } | { ok: false; reason: string }> {
  const allowed = await getEngineerAllowedRoots()
  const warRoomRoot = allowed[0]
  for (const root of allowed) {
    if (!isPathInsideRoot(canonicalPath, root)) continue
    // War Room: only the repository root itself, not arbitrary subdirectories (work/, WRIM, …).
    if (warRoomRoot && root === warRoomRoot && canonicalPath !== warRoomRoot) {
      continue
    }
    return { ok: true, root }
  }
  return { ok: false, reason: 'Path is outside the Engineer allowlist (War Room root or configured projects root).' }
}

function isWorkspaceRecord(v: unknown): v is WorkspaceRecord {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.id === 'string' && typeof o.root === 'string' && typeof o.label === 'string' && typeof o.createdAt === 'string'
}

async function readRegistry(): Promise<WorkspaceRecord[]> {
  try {
    const raw = await readFile(registryPath(), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isWorkspaceRecord)
  } catch {
    return []
  }
}

async function writeRegistry(records: WorkspaceRecord[]): Promise<void> {
  const p = registryPath()
  await mkdir(path.dirname(p), { recursive: true })
  await writeFile(p, JSON.stringify(records, null, 2), 'utf8')
}

export class WorkspaceValidationError extends Error {}

async function gitMeta(root: string): Promise<{ gitRepository: boolean; gitBranch?: string }> {
  try {
    const gitStat = await stat(path.join(root, '.git'))
    if (!gitStat.isDirectory() && !gitStat.isFile()) return { gitRepository: false }
  } catch {
    return { gitRepository: false }
  }
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: root,
      timeout: 8_000,
      windowsHide: true,
    })
    return { gitRepository: true, gitBranch: stdout.trim() || undefined }
  } catch {
    return { gitRepository: true }
  }
}

function detectPackageManager(rootHintFiles: { hasPnpm: boolean; hasNpm: boolean; hasYarn: boolean }): WorkspaceRecord['packageManager'] {
  if (rootHintFiles.hasPnpm) return 'pnpm'
  if (rootHintFiles.hasYarn) return 'yarn'
  if (rootHintFiles.hasNpm) return 'npm'
  return 'none'
}

async function enrich(record: WorkspaceRecord): Promise<WorkspaceRecord> {
  const meta = await gitMeta(record.root)
  let hasPnpm = false
  let hasNpm = false
  let hasYarn = false
  try {
    await stat(path.join(record.root, 'pnpm-lock.yaml'))
    hasPnpm = true
  } catch { /* */ }
  try {
    await stat(path.join(record.root, 'package-lock.json'))
    hasNpm = true
  } catch { /* */ }
  try {
    await stat(path.join(record.root, 'yarn.lock'))
    hasYarn = true
  } catch { /* */ }
  try {
    await stat(path.join(record.root, 'package.json'))
    hasNpm = hasNpm || true
  } catch { /* */ }
  return {
    ...record,
    name: record.name ?? record.label,
    path: record.root,
    gitRepository: meta.gitRepository,
    gitBranch: meta.gitBranch,
    packageManager: record.packageManager ?? detectPackageManager({ hasPnpm, hasNpm, hasYarn }),
    allowedScope: record.allowedScope ?? record.root,
    projectMemoryRel: record.projectMemoryRel ?? '.war-room/engineer/project-memory.json',
  }
}

async function canonicalExistingDir(candidate: string): Promise<string> {
  if (!path.isAbsolute(candidate)) {
    throw new WorkspaceValidationError('Workspace path must be absolute.')
  }
  let canonical: string
  try {
    canonical = await realpath(candidate)
  } catch {
    await recordBoundaryViolation({ action: 'open_workspace', attemptedPath: candidate, reason: 'path does not exist' })
    throw new WorkspaceValidationError('Workspace path does not exist.')
  }
  const st = await stat(canonical)
  if (!st.isDirectory()) {
    throw new WorkspaceValidationError('Workspace path is not a directory.')
  }
  const allowed = await assertPathInsideAllowedRoots(canonical)
  if (!allowed.ok) {
    await recordBoundaryViolation({ action: 'open_workspace', attemptedPath: canonical, reason: allowed.reason })
    throw new WorkspaceValidationError(allowed.reason)
  }
  return canonical
}

async function upsert(record: WorkspaceRecord): Promise<WorkspaceRecord> {
  const all = await readRegistry()
  const existing = all.find(w => w.root === record.root)
  if (existing) {
    const merged = await enrich({ ...existing, ...record, id: existing.id, lastOpenedAt: new Date().toISOString() })
    const next = all.map(w => (w.id === existing.id ? merged : w))
    await writeRegistry(next)
    return merged
  }
  const created = await enrich({ ...record, lastOpenedAt: new Date().toISOString() })
  all.push(created)
  await writeRegistry(all)
  return created
}

function withIdentity(record: WorkspaceRecord): WorkspaceRecord {
  const identity = decorateWorkspaceIdentity({
    id: record.id,
    root: record.root,
    label: record.label,
    name: record.name,
  })
  return {
    ...record,
    workspaceType: identity.workspaceType,
    displayTitle: identity.displayTitle,
    displayKind: identity.displayKind,
    label: identity.displayTitle,
  }
}

export async function listWorkspaces(): Promise<WorkspaceRecord[]> {
  const allowed = await getEngineerAllowedRoots()
  const listed = (await readRegistry()).filter(workspace => allowed.some(root => isPathInsideRoot(workspace.root, root)))
  let canonicalRoot = getCanonicalWarRoomSourceRoot()
  try {
    canonicalRoot = await realpath(canonicalRoot)
  } catch {
    /* canonical path may be unresolved on this machine */
  }
  const withoutCanonicalDupes = listed.filter(w => path.resolve(w.root).toLowerCase() !== path.resolve(canonicalRoot).toLowerCase())
  withoutCanonicalDupes.unshift(await enrich({
    id: WAR_ROOM_CANONICAL_WORKSPACE_ID,
    root: canonicalRoot,
    label: 'WAR ROOM OS',
    name: 'WAR ROOM OS',
    createdAt: '1970-01-01T00:00:00.000Z',
    projectType: 'war_room',
  }))
  return withoutCanonicalDupes.map(withIdentity)
}

export async function getWorkspace(id: string): Promise<WorkspaceRecord | null> {
  const all = await listWorkspaces()
  return all.find(w => w.id === id) ?? null
}

export async function touchWorkspace(id: string): Promise<WorkspaceRecord | null> {
  const current = await getWorkspace(id)
  if (!current) return null
  return upsert({ ...current, lastOpenedAt: new Date().toISOString() })
}

/** Phase B path — still requires a git repository. */
export async function openExistingRepositoryWorkspace(candidatePath: string, label?: string): Promise<WorkspaceRecord> {
  const root = await canonicalExistingDir(candidatePath)
  try {
    const gitStat = await stat(path.join(root, '.git'))
    if (!gitStat.isDirectory() && !gitStat.isFile()) {
      throw new WorkspaceValidationError('Workspace path is not a git repository.')
    }
  } catch (err) {
    if (err instanceof WorkspaceValidationError) throw err
    throw new WorkspaceValidationError('Workspace path is not a git repository (no .git found).')
  }
  return upsert({
    id: randomUUID(),
    root,
    label: label?.trim() || path.basename(root),
    createdAt: new Date().toISOString(),
    projectType: 'external_repository',
  })
}

/** Open an existing directory inside the allowlist. Git is optional. */
export async function openExistingProjectWorkspace(candidatePath: string, label?: string): Promise<WorkspaceRecord> {
  const root = await canonicalExistingDir(candidatePath)
  const meta = await gitMeta(root)
  return upsert({
    id: randomUUID(),
    root,
    label: label?.trim() || path.basename(root),
    createdAt: new Date().toISOString(),
    projectType: meta.gitRepository ? 'existing_project' : 'existing_project',
  })
}

const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/

export async function createNewProjectWorkspace(input: {
  name: string
  initializeGit?: boolean
  label?: string
}): Promise<WorkspaceRecord> {
  const name = input.name.trim()
  if (!NAME_PATTERN.test(name)) {
    throw new WorkspaceValidationError('Project name must be 1–63 characters: letters, digits, dot, underscore, hyphen.')
  }
  const projectsRoot = getProjectsRoot()
  await mkdir(projectsRoot, { recursive: true })
  const dest = path.join(projectsRoot, name)
  try {
    await stat(dest)
    throw new WorkspaceValidationError(`Project directory already exists: ${dest}`)
  } catch (err) {
    if (err instanceof WorkspaceValidationError) throw err
  }
  await mkdir(dest, { recursive: true })
  let canonical: string
  try {
    canonical = await realpath(dest)
  } catch {
    throw new WorkspaceValidationError('Created project path could not be resolved.')
  }
  const allowed = await assertPathInsideAllowedRoots(canonical)
  if (!allowed.ok) {
    await recordBoundaryViolation({ action: 'create_workspace', attemptedPath: canonical, reason: allowed.reason })
    throw new WorkspaceValidationError(allowed.reason)
  }
  if (input.initializeGit) {
    await execFileAsync('git', ['init', '--quiet'], { cwd: canonical, timeout: 15_000, windowsHide: true })
  }
  return upsert({
    id: randomUUID(),
    root: canonical,
    label: input.label?.trim() || name,
    name,
    createdAt: new Date().toISOString(),
    projectType: 'new_project',
  })
}
