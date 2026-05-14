import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ChangedFileMetadata, RollbackCheckpoint } from './types'

export const WAR_ROOM_CHECKPOINTS_REL = path.join('.war-room', 'checkpoints')

export function checkpointsAbsolutePath(repoRoot: string): string {
  return path.join(repoRoot, WAR_ROOM_CHECKPOINTS_REL)
}

function isChangedFileMetadata(v: unknown): v is ChangedFileMetadata {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.path === 'string' && typeof o.porcelain === 'string'
}

function normalizeChangedFiles(raw: unknown): ChangedFileMetadata[] {
  if (!Array.isArray(raw)) return []
  if (raw.length === 0) return []
  if (typeof raw[0] === 'string') {
    return (raw as string[]).map(pathStr => ({
      path: pathStr,
      indexStatus: '',
      workTreeStatus: '',
      porcelain: '??',
    }))
  }
  return raw.filter(isChangedFileMetadata)
}

function isLastCommitHash(v: unknown): v is RollbackCheckpoint['commitHash'] {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.short === 'string' && typeof o.full === 'string'
}

export function parseRollbackCheckpointJson(raw: string): RollbackCheckpoint | null {
  try {
    const v = JSON.parse(raw) as Record<string, unknown>
    if (typeof v.checkpointId !== 'string' || typeof v.timestamp !== 'string') return null
    if (typeof v.branch !== 'string') return null
    const workingTreeStatus = v.workingTreeStatus
    if (workingTreeStatus !== 'clean' && workingTreeStatus !== 'dirty' && workingTreeStatus !== 'unknown') return null
    const commitHashRaw = v.commitHash
    let commitHash: RollbackCheckpoint['commitHash'] = null
    if (commitHashRaw === null || commitHashRaw === undefined) {
      commitHash = null
    } else if (typeof commitHashRaw === 'string') {
      const full = commitHashRaw.trim()
      commitHash = full ? { short: full.slice(0, 7), full } : null
    } else if (isLastCommitHash(commitHashRaw)) {
      commitHash = commitHashRaw
    }
    return {
      checkpointId: v.checkpointId,
      timestamp: v.timestamp,
      branch: v.branch,
      commitHash,
      workingTreeStatus,
      changedFiles: normalizeChangedFiles(v.changedFiles),
      diffSummaryHash: typeof v.diffSummaryHash === 'string' ? v.diffSummaryHash : v.diffSummaryHash === null ? null : undefined,
    }
  } catch {
    return null
  }
}

async function readCheckpointFile(absPath: string): Promise<RollbackCheckpoint | null> {
  try {
    const raw = await readFile(absPath, 'utf8')
    return parseRollbackCheckpointJson(raw)
  } catch {
    return null
  }
}

export async function anyValidCheckpointExists(repoRoot: string): Promise<boolean> {
  const latest = await readLatestCheckpointRecord(repoRoot)
  return Boolean(latest)
}

export async function readLatestCheckpointRecord(repoRoot: string): Promise<RollbackCheckpoint | null> {
  const dir = checkpointsAbsolutePath(repoRoot)
  let names: string[]
  try {
    names = (await readdir(dir)).filter(n => n.endsWith('.json')).sort()
  } catch {
    return null
  }
  const latest = names.at(-1)
  if (!latest) return null
  return readCheckpointFile(path.join(dir, latest))
}

export async function appendCheckpointJson(repoRoot: string, fileName: string, jsonBody: string): Promise<void> {
  const dir = checkpointsAbsolutePath(repoRoot)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, fileName), jsonBody, 'utf8')
}
