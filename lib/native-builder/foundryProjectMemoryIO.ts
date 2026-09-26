/**
 * Filesystem side of Phase 4 engineering memory. One store per project, inside the project it describes
 * (`<project>/.war-room/engineer/engineering-memory.json`), so memory cannot leak between projects by construction. The stored identity is checked on every
 * load: a store that belongs to a different project (for example a copied file) is quarantined, never used.
 */
import { mkdir, readdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { emptyStore, identityStatus, makeIdentity, restoreStore, type MemoryStore, type ProjectIdentity } from './foundryProjectMemory'

const REL = path.join('.war-room', 'engineer', 'engineering-memory.json')

export function memoryPath(root: string): string {
  return path.join(root, REL)
}

/** The stable project id Foundry gave the project (foundry-memory.json), or null for a plain directory. */
export async function readProjectId(root: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(await readFile(path.join(root, 'foundry-memory.json'), 'utf8')) as { projectId?: unknown }
    return typeof parsed.projectId === 'string' && parsed.projectId.length >= 8 ? parsed.projectId : null
  } catch {
    return null
  }
}

export async function resolveProjectIdentity(root: string): Promise<ProjectIdentity> {
  let real = root
  try { real = await realpath(root) } catch { /* keep the given root */ }
  return makeIdentity({ root: real, projectId: await readProjectId(root) })
}

export type LoadedMemory = { store: MemoryStore; identity: ProjectIdentity; status: 'FRESH' | 'SAME' | 'QUARANTINED'; quarantinedTo?: string }

export async function loadMemory(root: string, at: string): Promise<LoadedMemory> {
  const identity = await resolveProjectIdentity(root)
  const file = memoryPath(root)
  let raw: string | null = null
  try { raw = await readFile(file, 'utf8') } catch { raw = null }
  if (raw === null) return { store: emptyStore(identity, at), identity, status: 'FRESH' }
  let stored: MemoryStore | null = null
  try { stored = restoreStore(JSON.parse(raw)) } catch { stored = null }
  if (!stored) return { store: emptyStore(identity, at), identity, status: 'FRESH' }
  if (identityStatus(stored, identity) === 'SAME') return { store: { ...stored, identity }, identity, status: 'SAME' }
  // Materially different project: set the file aside (kept for the human, never read again) and start clean.
  const quarantinedTo = path.join(path.dirname(file), `engineering-memory.quarantined-${at.replace(/[^0-9]/g, '').slice(0, 14)}.json`)
  try { await rename(file, quarantinedTo) } catch { /* best effort: the store is still not used */ }
  return { store: emptyStore(identity, at), identity, status: 'QUARANTINED', quarantinedTo }
}

export async function saveMemory(root: string, store: MemoryStore): Promise<void> {
  const file = memoryPath(root)
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  await writeFile(tmp, JSON.stringify(store, null, 2), 'utf8')
  await rename(tmp, file)
}

/** Names of the files at the project's top level (names only; contents are never read), for workflow knowledge such as the package manager. */
export async function listTopLevelNames(root: string): Promise<string[]> {
  try { return (await readdir(root)).filter(name => !/^\.env(\.|$)/.test(name) || /\.(example|sample|template)$/.test(name)) } catch { return [] }
}
