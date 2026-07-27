/**
 * Content-level rollback. lib/repo/rollback.ts (existing) only stores checkpoint *metadata*
 * (branch, commit hash, changed-file list) — there was no mechanism anywhere in this repo to
 * actually restore a file's prior content (confirmed absent by the Phase 1 audit). This module
 * fills that specific gap, scoped narrowly to native-builder's own patches: before
 * patchApplier.ts writes anything, it snapshots the pre-patch content here; rollbackRepair()
 * restores exactly that content (or deletes a file that didn't exist before the patch created it).
 *
 * Storage mirrors the existing lib/repo/checkpoint-store.ts pattern (mkdir + writeFile JSON under
 * .war-room/) rather than inventing a new persistence mechanism.
 */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { resolveRepoRelativePath } from './repositoryInspector'

export const NATIVE_BUILDER_SNAPSHOTS_REL = path.join('.war-room', 'native-builder', 'snapshots')

function snapshotDirFor(repairId: string): string {
  return path.join(resolveRepoRoot(), NATIVE_BUILDER_SNAPSHOTS_REL, repairId)
}

function safeSnapshotFileName(relPath: string, index: number): string {
  const flattened = relPath.replace(/[\\/]/g, '__')
  return `${String(index).padStart(3, '0')}_${flattened}.json`
}

export type FileSnapshot = {
  relPath: string
  /** Content before the patch, or null if the patch created a file that didn't exist. */
  originalContent: string | null
  existedBefore: boolean
  snapshotAt: string
}

/** Called by patchApplier.ts immediately before writing, once per file, in apply order. */
export async function snapshotFileBeforePatch(
  repairId: string,
  relPath: string,
  originalContent: string | null,
  existedBefore: boolean,
): Promise<void> {
  const dir = snapshotDirFor(repairId)
  await mkdir(dir, { recursive: true })
  const existing = await readdir(dir).catch(() => [] as string[])
  const snapshot: FileSnapshot = { relPath, originalContent, existedBefore, snapshotAt: new Date().toISOString() }
  const fileName = safeSnapshotFileName(relPath, existing.length)
  await writeFile(path.join(dir, fileName), JSON.stringify(snapshot, null, 2), 'utf8')
}

export async function listSnapshots(repairId: string): Promise<FileSnapshot[]> {
  const dir = snapshotDirFor(repairId)
  let names: string[]
  try {
    names = (await readdir(dir)).filter(n => n.endsWith('.json')).sort()
  } catch {
    return []
  }
  const out: FileSnapshot[] = []
  for (const name of names) {
    try {
      const raw = await readFile(path.join(dir, name), 'utf8')
      const parsed = JSON.parse(raw) as FileSnapshot
      if (typeof parsed.relPath === 'string') out.push(parsed)
    } catch {
      /* skip unreadable snapshot */
    }
  }
  return out
}

export type RollbackResult = {
  repairId: string
  restoredFiles: string[]
  deletedFiles: string[]
  errors: string[]
  rolledBackAt: string
}

/**
 * Restores every snapshotted file for this repair to its pre-patch state, in reverse apply order
 * (last-applied-first, so a create_file that a later replace_range depended on isn't deleted
 * before the dependent restore runs). Approval enforcement is the caller's responsibility (route
 * layer calls assertAutoOrApproval with actionKind 'rollback' before invoking this).
 */
export async function rollbackRepair(repairId: string): Promise<RollbackResult> {
  const snapshots = await listSnapshots(repairId)
  const restoredFiles: string[] = []
  const deletedFiles: string[] = []
  const errors: string[] = []

  for (const snapshot of [...snapshots].reverse()) {
    try {
      const abs = resolveRepoRelativePath(snapshot.relPath)
      if (snapshot.existedBefore) {
        await writeFile(abs, snapshot.originalContent ?? '', 'utf8')
        restoredFiles.push(snapshot.relPath)
      } else {
        await rm(abs, { force: true })
        deletedFiles.push(snapshot.relPath)
      }
    } catch (error) {
      errors.push(`${snapshot.relPath}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return {
    repairId,
    restoredFiles,
    deletedFiles,
    errors,
    rolledBackAt: new Date().toISOString(),
  }
}
