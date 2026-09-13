/**
 * Per-project engineering memory. Scoped to the active workspace root (resolveRepoRoot).
 * Never mixed into global Commander memory.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'

export type ProjectMemory = {
  architecture: string[]
  importantPaths: string[]
  commands: string[]
  dependencies: string[]
  decisions: string[]
  knownIssues: string[]
  commanderRequirements: string[]
  completedMissions: string[]
  unresolvedTasks: string[]
  updatedAt: string
}

const REL = path.join('.war-room', 'engineer', 'project-memory.json')

function memoryPath(): string {
  return path.join(resolveRepoRoot(), REL)
}

const EMPTY: Omit<ProjectMemory, 'updatedAt'> = {
  architecture: [],
  importantPaths: [],
  commands: [],
  dependencies: [],
  decisions: [],
  knownIssues: [],
  commanderRequirements: [],
  completedMissions: [],
  unresolvedTasks: [],
}

export async function readProjectMemory(): Promise<ProjectMemory> {
  try {
    const parsed = JSON.parse(await readFile(memoryPath(), 'utf8')) as Partial<ProjectMemory>
    return {
      ...EMPTY,
      ...parsed,
      architecture: parsed.architecture ?? [],
      importantPaths: parsed.importantPaths ?? [],
      commands: parsed.commands ?? [],
      dependencies: parsed.dependencies ?? [],
      decisions: parsed.decisions ?? [],
      knownIssues: parsed.knownIssues ?? [],
      commanderRequirements: parsed.commanderRequirements ?? [],
      completedMissions: parsed.completedMissions ?? [],
      unresolvedTasks: parsed.unresolvedTasks ?? [],
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    }
  } catch {
    return { ...EMPTY, updatedAt: new Date().toISOString() }
  }
}

export async function writeProjectMemory(patch: Partial<ProjectMemory>): Promise<ProjectMemory> {
  const current = await readProjectMemory()
  const next: ProjectMemory = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  }
  const dest = memoryPath()
  await mkdir(path.dirname(dest), { recursive: true })
  await writeFile(dest, JSON.stringify(next, null, 2), 'utf8')
  return next
}

export async function appendProjectMemory(field: keyof Omit<ProjectMemory, 'updatedAt'>, value: string): Promise<ProjectMemory> {
  const current = await readProjectMemory()
  const list = current[field]
  if (!Array.isArray(list)) return current
  if (list.includes(value)) return current
  return writeProjectMemory({ [field]: [...list, value].slice(-80) })
}
