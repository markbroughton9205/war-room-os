/**
 * Local .hvsproj persistence + EditCommandLog. Authoritative current state is the .hvsproj file.
 * Versions are snapshots, never silent overwrites.
 */
import { appendFile, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { mediaCommandDataHierarchy, projectFilePath, projectLogPath, projectRedoDir, projectUndoDir, projectVersionsDir } from './paths'
import { parseHvsProject, serializeHvsProject } from './project-format'
import { cloneProject, emptyProject, findClip, type HvsProject, type ProjectVersion } from './types'
import { toSeconds } from './time'
import { applyEditCommand } from './edit-ops'
import type { EditCommand } from './edit-commands'
import { validateEditCommandSchema } from './edit-commands'
import { trackPersonInClip } from './track-subject'
import { extractFreezeStill } from './freeze-frame'
import {
  applySnapshotAuthoring,
  compareVersionProjects,
  findVersion,
  populateVersionFacts,
  safetyRestoreLabel,
  summarizeVersion,
  type VersionCompare,
  type VersionSummary,
} from './versions'

function catalogPath(): string {
  return path.join(mediaCommandDataHierarchy().projects, 'catalog.json')
}

type CatalogEntry = { id: string; name: string; updatedAt: string; productionMode: string; starrdom: boolean }

async function readCatalog(): Promise<CatalogEntry[]> {
  const file = catalogPath()
  if (!existsSync(file)) return []
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as { projects?: CatalogEntry[] }
    return parsed.projects ?? []
  } catch {
    return []
  }
}

async function writeCatalog(entries: CatalogEntry[]): Promise<void> {
  await mkdir(mediaCommandDataHierarchy().projects, { recursive: true })
  await writeFile(catalogPath(), JSON.stringify({ projects: entries }, null, 2), 'utf8')
}

async function upsertCatalog(project: HvsProject): Promise<void> {
  const entries = await readCatalog()
  const next = entries.filter(e => e.id !== project.id)
  next.unshift({
    id: project.id,
    name: project.name,
    updatedAt: project.updatedAt,
    productionMode: project.productionMode,
    starrdom: project.starrdom,
  })
  await writeCatalog(next)
}

export async function listProjects(): Promise<CatalogEntry[]> {
  return readCatalog()
}

export async function loadProject(id: string): Promise<HvsProject | null> {
  const file = projectFilePath(id)
  if (!existsSync(file)) return null
  try {
    return parseHvsProject(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

export async function saveProject(project: HvsProject): Promise<HvsProject> {
  project.updatedAt = new Date().toISOString()
  await mkdir(mediaCommandDataHierarchy().projects, { recursive: true })
  await writeFile(projectFilePath(project.id), serializeHvsProject(project), 'utf8')
  await upsertCatalog(project)
  return project
}

export async function createProject(input: {
  name: string
  productionMode?: HvsProject['productionMode']
  starrdom?: boolean
}): Promise<HvsProject> {
  const id = `hvs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const project = emptyProject({
    id,
    name: input.name.trim() || 'Untitled Project',
    productionMode: input.productionMode,
    starrdom: input.starrdom,
  })
  const saved = await saveProject(project)
  return ensureVersionSnapshot(saved, saved.currentVersionId)
}

async function writeSnapshotFile(project: HvsProject, versionId: string): Promise<string> {
  const dir = projectVersionsDir(project.id)
  await mkdir(dir, { recursive: true })
  const snapshotFile = path.join(dir, `${versionId}.hvsproj`)
  await writeFile(snapshotFile, serializeHvsProject(project), 'utf8')
  return snapshotFile
}

export async function loadVersionSnapshot(project: HvsProject, versionId: string): Promise<HvsProject | null> {
  const version = findVersion(project, versionId)
  if (!version) return null
  const candidates = [
    version.snapshotPath,
    path.join(projectVersionsDir(project.id), `${version.id}.hvsproj`),
  ].filter(Boolean)
  for (const file of candidates) {
    if (!existsSync(file)) continue
    try {
      return parseHvsProject(await readFile(file, 'utf8'))
    } catch {
      continue
    }
  }
  return null
}

export async function compareProjectVersions(
  project: HvsProject,
  aId: string,
  bId: string,
): Promise<{ compare: VersionCompare } | { error: string }> {
  const aVersion = findVersion(project, aId)
  const bVersion = findVersion(project, bId)
  if (!aVersion || !bVersion) return { error: 'Both versions must exist in this project.' }
  const aSnap = aId === project.currentVersionId ? project : await loadVersionSnapshot(project, aId)
  const bSnap = bId === project.currentVersionId ? project : await loadVersionSnapshot(project, bId)
  if (!aSnap) return { error: `Version "${aVersion.label}" has no snapshot to compare.` }
  if (!bSnap) return { error: `Version "${bVersion.label}" has no snapshot to compare.` }
  return { compare: compareVersionProjects(project, aSnap, aVersion, bSnap, bVersion) }
}

export async function ensureVersionSnapshot(project: HvsProject, versionId: string): Promise<HvsProject> {
  const version = findVersion(project, versionId)
  if (!version) return project
  if (version.snapshotPath && existsSync(version.snapshotPath)) return project
  const next = cloneProject(project)
  const found = findVersion(next, versionId)
  if (!found) return project
  found.snapshotPath = await writeSnapshotFile(next, versionId)
  Object.assign(found, populateVersionFacts(found, next))
  return saveProject(next)
}

export async function versionSummaries(project: HvsProject): Promise<VersionSummary[]> {
  const out: VersionSummary[] = []
  for (const version of project.versions) {
    const snapshot = await loadVersionSnapshot(project, version.id)
    const source = version.id === project.currentVersionId ? project : snapshot
    out.push(summarizeVersion(project, version, source ?? snapshot, { live: project }))
  }
  return out
}

export async function snapshotVersion(
  project: HvsProject,
  label: string,
  createdBy: ProjectVersion['createdBy'],
  extra?: { description?: string; parentVersionId?: string | null; makeCurrent?: boolean },
): Promise<HvsProject> {
  const next = cloneProject(project)
  const parentId = extra?.parentVersionId === undefined ? next.currentVersionId : extra.parentVersionId
  const index = next.versions.length + 1
  const version: ProjectVersion = populateVersionFacts({
    id: `ver-${next.id}-${index}-${Math.random().toString(36).slice(2, 6)}`,
    projectId: next.id,
    index,
    label,
    createdAt: new Date().toISOString(),
    createdBy,
    parentVersionId: parentId,
    snapshotPath: '',
    aspect: project.timeline.aspect,
    role: project.timeline.aspect === '9:16' ? 'derived' : 'master',
    derivedFromVersionId: parentId,
    description: extra?.description ?? '',
  }, next)
  version.snapshotPath = await writeSnapshotFile(next, version.id)
  next.versions.push(version)
  if (extra?.makeCurrent !== false) next.currentVersionId = version.id
  return saveProject(next)
}

export async function restoreVersion(
  project: HvsProject,
  versionId: string,
  options: { confirmed: boolean; actor: ProjectVersion['createdBy'] },
): Promise<{ project: HvsProject; error?: string }> {
  if (!options.confirmed) return { project, error: 'Restore requires explicit Commander confirmation.' }
  const target = findVersion(project, versionId)
  if (!target) return { project, error: 'Version not found.' }
  const snapshot = await loadVersionSnapshot(project, versionId)
  if (!snapshot) return { project, error: `Version "${target.label}" has no snapshot to restore.` }
  const safety = await snapshotVersion(project, safetyRestoreLabel(), 'system', {
    description: `Safety snapshot before restore of ${target.label}`,
    makeCurrent: false,
  })
  const next = applySnapshotAuthoring(safety, snapshot)
  next.currentVersionId = versionId
  next.undoStack = []
  next.redoStack = []
  return { project: await saveProject(next) }
}

export async function createVersionFrom(
  project: HvsProject,
  sourceVersionId: string,
  label: string,
  createdBy: ProjectVersion['createdBy'],
  description?: string,
): Promise<{ project: HvsProject; error?: string }> {
  const source = findVersion(project, sourceVersionId)
  if (!source) return { project, error: 'Source version not found.' }
  const snapshot = await loadVersionSnapshot(project, sourceVersionId)
  if (!snapshot) return { project, error: `Version "${source.label}" has no snapshot to branch from.` }
  const next = cloneProject(project)
  const index = next.versions.length + 1
  const version: ProjectVersion = populateVersionFacts({
    id: `ver-${next.id}-${index}-${Math.random().toString(36).slice(2, 6)}`,
    projectId: next.id,
    index,
    label,
    createdAt: new Date().toISOString(),
    createdBy,
    parentVersionId: sourceVersionId,
    snapshotPath: '',
    aspect: snapshot.timeline.aspect,
    role: snapshot.timeline.aspect === '9:16' ? 'derived' : 'master',
    derivedFromVersionId: sourceVersionId,
    description: description ?? `Branched from ${source.label}`,
  }, snapshot)
  version.snapshotPath = path.join(projectVersionsDir(next.id), `${version.id}.hvsproj`)
  await mkdir(projectVersionsDir(next.id), { recursive: true })
  if (source.snapshotPath && existsSync(source.snapshotPath)) {
    await copyFile(source.snapshotPath, version.snapshotPath)
  } else {
    await writeFile(version.snapshotPath, serializeHvsProject(snapshot), 'utf8')
  }
  next.versions.push(version)
  return { project: await saveProject(next) }
}

export async function appendCommandLog(projectId: string, command: EditCommand, extra?: Record<string, unknown>): Promise<void> {
  await mkdir(path.dirname(projectLogPath(projectId)), { recursive: true })
  await appendFile(projectLogPath(projectId), `${JSON.stringify({ ...command, ...extra, loggedAt: new Date().toISOString() })}\n`, 'utf8')
}

export async function commitCommands(project: HvsProject, commands: EditCommand[], options?: { preview?: boolean }): Promise<{
  project: HvsProject
  warnings: string[]
  errors: string[]
  preview: boolean
}> {
  let current = cloneProject(project)
  const warnings: string[] = []
  const errors: string[] = []
  const commandIds: string[] = []
  for (const raw of commands) {
    const schema = validateEditCommandSchema(raw)
    if (!schema.ok) {
      errors.push(schema.error)
      continue
    }
    if (schema.command.kind === 'createVersion') {
      if (options?.preview) {
        warnings.push('createVersion is not preview-only; no snapshot written.')
        continue
      }
      current = await snapshotVersion(current, schema.command.versionLabel, schema.command.createdBy, {
        description: schema.command.description,
      })
      commandIds.push(schema.command.id)
      await appendCommandLog(current.id, schema.command)
      continue
    }
    if (schema.command.kind === 'restoreVersion') {
      if (options?.preview) {
        errors.push('Restore is not preview-only. Confirm Restore in the Version Browser.')
        continue
      }
      const restored = await restoreVersion(current, schema.command.versionId, {
        confirmed: schema.command.confirmed,
        actor: schema.command.actor,
      })
      if (restored.error) {
        errors.push(restored.error)
        continue
      }
      current = restored.project
      commandIds.push(schema.command.id)
      await appendCommandLog(current.id, schema.command, {
        restoredFromVersionId: schema.command.versionId,
        currentVersionId: current.currentVersionId,
        safetyVersionId: current.versions.find(v => v.label.startsWith('PRE-RESTORE'))?.id ?? null,
      })
      continue
    }
    if (schema.command.kind === 'createVersionFrom') {
      if (options?.preview) {
        errors.push('Branch-from-version is not preview-only.')
        continue
      }
      const branched = await createVersionFrom(
        current,
        schema.command.sourceVersionId,
        schema.command.versionLabel,
        schema.command.createdBy,
        schema.command.description,
      )
      if (branched.error) {
        errors.push(branched.error)
        continue
      }
      current = branched.project
      commandIds.push(schema.command.id)
      await appendCommandLog(current.id, schema.command)
      continue
    }
    if (schema.command.kind === 'undo') {
      const lastId = current.undoStack.at(-1)
      if (!lastId) {
        errors.push('Nothing to undo.')
        continue
      }
      const snapPath = path.join(projectUndoDir(current.id), `${lastId}.hvsproj`)
      if (!existsSync(snapPath)) {
        errors.push('Undo snapshot missing.')
        continue
      }
      if (!options?.preview) {
        await mkdir(projectRedoDir(current.id), { recursive: true })
        await writeFile(path.join(projectRedoDir(current.id), `${lastId}.hvsproj`), serializeHvsProject(current), 'utf8')
      }
      const restored = parseHvsProject(await readFile(snapPath, 'utf8'))
      restored.redoStack = [...current.redoStack, lastId]
      current = restored
      commandIds.push(schema.command.id)
      if (!options?.preview) await appendCommandLog(current.id, schema.command, { undid: lastId })
      continue
    }
    if (schema.command.kind === 'redo') {
      const lastId = current.redoStack.at(-1)
      if (!lastId) {
        errors.push('Nothing to redo.')
        continue
      }
      const snapPath = path.join(projectRedoDir(current.id), `${lastId}.hvsproj`)
      if (!existsSync(snapPath)) {
        errors.push('Redo snapshot missing.')
        continue
      }
      const restored = parseHvsProject(await readFile(snapPath, 'utf8'))
      restored.redoStack = current.redoStack.slice(0, -1)
      current = restored
      commandIds.push(schema.command.id)
      if (!options?.preview) await appendCommandLog(current.id, schema.command, { redid: lastId })
      continue
    }
    let command = schema.command
    if (command.kind === 'trackSubject' && !command.keyframes?.length && !options?.preview) {
      const tracked = await trackPersonInClip(current, {
        clipId: command.clipId,
        seedBox: command.seedBox,
      })
      command = {
        ...command,
        keyframes: tracked.keyframes,
        status: tracked.status,
        confidence: tracked.confidence,
      }
      warnings.push(...tracked.warnings)
    }
    if (command.kind === 'reacquireTrack' && !command.keyframes?.length && !options?.preview) {
      const existing = current.timeline.subjects.find(s => s.clipId === command.clipId)
      const found = findClip(current, command.clipId)
      const fromSec = found ? Math.max(0, toSeconds(command.from) - toSeconds(found.clip.start)) : toSeconds(command.from)
      const tracked = await trackPersonInClip(current, {
        clipId: command.clipId,
        seedBox: command.seedBox,
        fromSec,
      })
      const keepUntil = command.from.ticks
      const prior = (existing?.keyframes ?? []).filter(kf => kf.time.ticks < keepUntil)
      command = {
        ...command,
        keyframes: [...prior, ...tracked.keyframes],
        status: tracked.status === 'lost' ? 'lost' : 'reacquired',
        confidence: tracked.confidence,
      }
      warnings.push(...tracked.warnings)
      if (existing) warnings.push(`Preserved ${prior.length} tracking keys before reacquisition.`)
    }
    if (command.kind === 'createFreezeFrame' && !options?.preview) {
      try {
        const found = command.clipId ? findClip(current, command.clipId) : null
        const at = command.at ?? found?.clip.sourceIn
        const assetId = command.assetId ?? found?.clip.assetId
        if (assetId && at) {
          const still = await extractFreezeStill(current, { clipId: command.clipId, assetId, at })
          warnings.push(...still.warnings)
          if (still.assetId) command = { ...command, assetId: still.assetId }
        }
      } catch (err) {
        warnings.push(`${err instanceof Error ? err.message : 'Freeze still extract failed.'} Using source-video freeze clip.`)
      }
    }
    if (!options?.preview) {
      await mkdir(projectUndoDir(current.id), { recursive: true })
      await writeFile(path.join(projectUndoDir(current.id), `${command.id}.hvsproj`), serializeHvsProject(current), 'utf8')
    }
    const applied = applyEditCommand(current, command)
    if (!applied.ok) {
      errors.push(applied.error)
      continue
    }
    current = applied.project
    warnings.push(...applied.warnings)
    commandIds.push(command.id)
    if (!options?.preview) await appendCommandLog(current.id, command)
  }
  current.transactions.push({
    id: `tx-${Date.now().toString(36)}`,
    projectId: current.id,
    versionId: current.currentVersionId,
    createdAt: new Date().toISOString(),
    actor: commands[0]?.actor ?? 'human',
    label: commands.map(c => c.kind).join(', '),
    commandIds,
    committed: !options?.preview,
    previewOnly: Boolean(options?.preview),
  })
  if (options?.preview) return { project: current, warnings, errors, preview: true }
  const saved = await saveProject(current)
  return { project: saved, warnings, errors, preview: false }
}

export async function listVersionSnapshots(projectId: string): Promise<string[]> {
  const dir = projectVersionsDir(projectId)
  if (!existsSync(dir)) return []
  const names = await readdir(dir)
  return names.filter(n => n.endsWith('.hvsproj')).map(n => path.join(dir, n))
}
