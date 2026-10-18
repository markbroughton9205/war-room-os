/**
 * Durable log of workspace-boundary violations (path traversal, symlink escape, unapproved roots).
 * Lives on the process base repo so it is visible even when the offending workspace is rejected.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveBaseRepoRoot } from '@/lib/repo/paths'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'

export type BoundaryViolation = {
  at: string
  action: string
  attemptedPath: string
  reason: string
}

const REL = path.join('.war-room', 'engineer', 'boundary-violations.json')

function filePath(): string {
  return path.join(resolveBaseRepoRoot(), REL)
}

export async function recordBoundaryViolation(input: Omit<BoundaryViolation, 'at'>): Promise<void> {
  const entry: BoundaryViolation = { ...input, at: new Date().toISOString() }
  let existing: BoundaryViolation[] = []
  try {
    existing = JSON.parse(await readFile(filePath(), 'utf8')) as BoundaryViolation[]
    if (!Array.isArray(existing)) existing = []
  } catch {
    existing = []
  }
  existing.push(entry)
  const trimmed = existing.slice(-200)
  const dest = filePath()
  await mkdir(path.dirname(dest), { recursive: true })
  await writeFile(dest, JSON.stringify(trimmed, null, 2), 'utf8')
  await logWarRoomRepoAudit('engineer: workspace boundary violation', {
    action: input.action,
    reason: input.reason,
  })
}

export async function listBoundaryViolations(): Promise<BoundaryViolation[]> {
  try {
    const parsed = JSON.parse(await readFile(filePath(), 'utf8')) as unknown
    return Array.isArray(parsed) ? (parsed as BoundaryViolation[]) : []
  } catch {
    return []
  }
}
