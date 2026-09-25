/**
 * Commander project-index hygiene. Archives duplicate metadata without deleting project files.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { FoundryNewProjectRecord } from './foundryApplicationBuilderTypes'
import { preferredPreviewPort } from './foundryCommanderExperience'

export type ProjectDedupeCandidate = {
  projectId: string
  projectName: string
  projectRoot: string
  projectType: FoundryNewProjectRecord['projectType']
  createdAt: string
  lastSuccessAt?: string
  lastOpenedAt?: string
  previewPort?: number
  displayBrand: string
  hasMatchingMemory: boolean
  archived?: boolean
}

export function normalizeCommanderBrand(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function commanderProjectIdentity(item: { projectType: string; displayBrand: string }): string {
  return `${item.projectType}::${normalizeCommanderBrand(item.displayBrand)}`
}

export function projectBrandIdentityIsResolved(project: { status?: string }): boolean {
  return project.status !== 'NEW_PROJECT'
}

export function chooseCanonicalApplicationProject(group: ProjectDedupeCandidate[]): string {
  const live = group.filter(item => item.archived !== true)
  const pool = live.length ? live : group
  const scored = pool.map(item => {
    let score = 0
    if (item.hasMatchingMemory) score += 80
    if (item.lastSuccessAt) score += 20
    if (item.lastOpenedAt) score += 10
    if (item.previewPort && item.previewPort === preferredPreviewPort(item)) score += 15
    if (existsSync(item.projectRoot)) score += 5
    return { item, score }
  })
  scored.sort((a, b) => b.score - a.score || a.item.createdAt.localeCompare(b.item.createdAt))
  return scored[0]!.item.projectId
}

export async function readProjectDisplayBrand(projectRoot: string, fallback: string): Promise<string> {
  try {
    const facts = JSON.parse(await readFile(path.join(projectRoot, 'commander-facts.json'), 'utf8')) as { workingBrand?: string; brand?: string }
    if (typeof facts.workingBrand === 'string' && facts.workingBrand.trim()) return facts.workingBrand.trim()
    if (typeof facts.brand === 'string' && facts.brand.trim()) return facts.brand.trim()
  } catch {
    /* optional */
  }
  try {
    const readme = await readFile(path.join(projectRoot, 'README.md'), 'utf8')
    const heading = readme.match(/^#\s+(.+)$/m)?.[1]?.trim()
    if (heading) return heading
  } catch {
    /* optional */
  }
  return fallback
}

export async function projectHasMatchingMemory(projectRoot: string, projectId: string): Promise<boolean> {
  try {
    const memory = JSON.parse(await readFile(path.join(projectRoot, 'foundry-memory.json'), 'utf8')) as { projectId?: string }
    return memory.projectId === projectId
  } catch {
    return false
  }
}

export async function toDedupeCandidate(project: FoundryNewProjectRecord & {
  lastSuccessAt?: string
  lastOpenedAt?: string
  previewPort?: number
  archived?: boolean
}): Promise<ProjectDedupeCandidate> {
  return {
    projectId: project.projectId,
    projectName: project.projectName,
    projectRoot: project.projectRoot,
    projectType: project.projectType,
    createdAt: project.createdAt,
    lastSuccessAt: project.lastSuccessAt,
    lastOpenedAt: project.lastOpenedAt,
    previewPort: project.previewPort,
    displayBrand: await readProjectDisplayBrand(project.projectRoot, project.projectName),
    hasMatchingMemory: await projectHasMatchingMemory(project.projectRoot, project.projectId),
    archived: project.archived === true,
  }
}

export function archiveDuplicateProjectRecords<T extends FoundryNewProjectRecord & { archived?: boolean; supersededBy?: string | null; archivedReason?: string; archivedAt?: string }>(
  all: T[],
  canonicalId: string,
  duplicateIds: string[],
  at = new Date().toISOString(),
): T[] {
  return all.map(item => {
    if (!duplicateIds.includes(item.projectId)) return item
    return {
      ...item,
      archived: true,
      supersededBy: canonicalId,
      archivedReason: 'duplicate commander brand/type; metadata archived, project files preserved',
      archivedAt: at,
    }
  })
}

export async function reconcileDuplicateFoundryProjects(): Promise<Array<{ identity: string; canonicalId: string; archived: string[] }>> {
  const { listFoundryApplicationProjects, writeProjectIndex } = await import('./foundryProjectIsolation')
  const all = await listFoundryApplicationProjects({ includeArchived: true })
  const commander = all.filter(item => item.archived !== true)
  const candidates = await Promise.all(commander.map(item => toDedupeCandidate(item)))
  const groups = new Map<string, ProjectDedupeCandidate[]>()
  for (const candidate of candidates) {
    const key = commanderProjectIdentity(candidate)
    const bucket = groups.get(key) ?? []
    bucket.push(candidate)
    groups.set(key, bucket)
  }
  const actions: Array<{ identity: string; canonicalId: string; archived: string[] }> = []
  let next = all
  const recordById = new Map(all.map(item => [item.projectId, item]))
  for (const [identity, group] of groups) {
    const resolved = group.filter(item => projectBrandIdentityIsResolved(recordById.get(item.projectId) ?? item))
    if (resolved.length < 2) continue
    const canonicalId = chooseCanonicalApplicationProject(resolved)
    const duplicateIds = resolved.map(item => item.projectId).filter(id => id !== canonicalId)
    next = archiveDuplicateProjectRecords(next, canonicalId, duplicateIds)
    actions.push({ identity, canonicalId, archived: duplicateIds })
  }
  if (actions.length) await writeProjectIndex(next)
  return actions
}
