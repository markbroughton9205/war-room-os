/**
 * Phase B — workspace registry. Tracks explicit workspace identities (currently: "Open Existing
 * Repository" only — New Project and Clone Repository are documented as the remaining bounded
 * capability, see the Phase B section of the completion report). Stored as a single JSON file
 * under the process's own base repo root (resolveBaseRepoRoot(), NOT resolveRepoRoot() — the
 * registry must always be discoverable regardless of which workspace is currently active),
 * mirroring the existing file-based JSON pattern in native-builder/storage.ts and
 * repo/checkpoint-store.ts. No new persistence system introduced.
 */
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveBaseRepoRoot } from '@/lib/repo/paths'

export interface WorkspaceRecord {
  id: string
  root: string
  label: string
  createdAt: string
}

const REGISTRY_REL = path.join('.war-room', 'workspaces', 'registry.json')
export const CODE_OPERATOR_ALLOWED_ROOTS = ['/Users/markbroughton/Developer/war-room-os'] as const

function registryPath(): string {
  return path.join(resolveBaseRepoRoot(), REGISTRY_REL)
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

/**
 * Validates a candidate "Open Existing Repository" path: must be absolute, must exist, must be a
 * directory, must contain a .git directory (i.e. actually be a repository), and is resolved
 * through fs.realpath so registration always stores a canonical, symlink/`..`-resolved path —
 * closing the path-traversal angle at registration time rather than trusting caller-supplied
 * strings.
 */
async function validateAndCanonicalizeRoot(candidate: string): Promise<string> {
  if (!path.isAbsolute(candidate)) {
    throw new WorkspaceValidationError('Workspace path must be absolute.')
  }
  let canonical: string
  try {
    canonical = await realpath(candidate)
  } catch {
    throw new WorkspaceValidationError('Workspace path does not exist.')
  }
  const allowedRoots = await Promise.all(CODE_OPERATOR_ALLOWED_ROOTS.map(root => realpath(root)))
  if (!allowedRoots.includes(canonical)) {
    throw new WorkspaceValidationError('Workspace is not in the Code Operator allowlist.')
  }
  const st = await stat(canonical)
  if (!st.isDirectory()) {
    throw new WorkspaceValidationError('Workspace path is not a directory.')
  }
  try {
    const gitStat = await stat(path.join(canonical, '.git'))
    if (!gitStat.isDirectory() && !gitStat.isFile()) {
      throw new WorkspaceValidationError('Workspace path is not a git repository.')
    }
  } catch (err) {
    if (err instanceof WorkspaceValidationError) throw err
    throw new WorkspaceValidationError('Workspace path is not a git repository (no .git found).')
  }
  return canonical
}

export async function listWorkspaces(): Promise<WorkspaceRecord[]> {
  const allowedRoots = new Set(await Promise.all(CODE_OPERATOR_ALLOWED_ROOTS.map(root => realpath(root))))
  return (await readRegistry()).filter(workspace => allowedRoots.has(workspace.root))
}

export async function getWorkspace(id: string): Promise<WorkspaceRecord | null> {
  const all = await listWorkspaces()
  return all.find(w => w.id === id) ?? null
}

/** "Open Existing Repository" — the one workspace-creation path implemented in Phase B. */
export async function openExistingRepositoryWorkspace(candidatePath: string, label?: string): Promise<WorkspaceRecord> {
  const root = await validateAndCanonicalizeRoot(candidatePath)
  const existing = (await readRegistry()).find(w => w.root === root)
  if (existing) return existing
  const record: WorkspaceRecord = {
    id: randomUUID(),
    root,
    label: label?.trim() || path.basename(root),
    createdAt: new Date().toISOString(),
  }
  const all = await readRegistry()
  all.push(record)
  await writeRegistry(all)
  return record
}
