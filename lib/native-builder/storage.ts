/**
 * Server-side persistence for native-builder issues and repair records. File-based JSON under
 * .war-room/native-builder/, mirroring the exact pattern already proven safe in
 * lib/repo/checkpoint-store.ts (mkdir + writeFile / readdir + parse) rather than introducing a
 * new Supabase table/migration for what is, for now, local dev-runtime state. Every read here is
 * a plain parse — no function in this file calls back into runtime.ts (same lesson as the
 * self-repair recursion fix: storage stays a leaf, never re-enters the orchestrator).
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import type { NativeIssueRecord, NativeRepairRecord } from './types'

const NATIVE_BUILDER_DATA_REL = path.join('.war-room', 'native-builder')

function issuesDir(): string {
  return path.join(resolveRepoRoot(), NATIVE_BUILDER_DATA_REL, 'issues')
}

function repairsDir(): string {
  return path.join(resolveRepoRoot(), NATIVE_BUILDER_DATA_REL, 'repairs')
}

async function readJsonFiles<T>(dir: string, isValid: (v: unknown) => v is T): Promise<T[]> {
  let names: string[]
  try {
    names = (await readdir(dir)).filter(n => n.endsWith('.json'))
  } catch {
    return []
  }
  const out: T[] = []
  for (const name of names) {
    try {
      const raw = await readFile(path.join(dir, name), 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (isValid(parsed)) out.push(parsed)
    } catch {
      /* skip unreadable/corrupt record rather than fail the whole list */
    }
  }
  return out
}

function isIssueRecord(v: unknown): v is NativeIssueRecord {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.id === 'string' && typeof o.fingerprint === 'string' && typeof o.status === 'string'
}

function isRepairRecord(v: unknown): v is NativeRepairRecord {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.id === 'string' && typeof o.issueId === 'string' && typeof o.state === 'string' && Array.isArray(o.history)
}

export async function listIssues(): Promise<NativeIssueRecord[]> {
  return readJsonFiles(issuesDir(), isIssueRecord)
}

export async function findIssueByFingerprint(fingerprint: string): Promise<NativeIssueRecord | null> {
  const all = await listIssues()
  return all.find(i => i.fingerprint === fingerprint) ?? null
}

export async function getIssue(id: string): Promise<NativeIssueRecord | null> {
  const all = await listIssues()
  return all.find(i => i.id === id) ?? null
}

export async function saveIssue(issue: NativeIssueRecord): Promise<void> {
  const dir = issuesDir()
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, `${issue.id}.json`), JSON.stringify(issue, null, 2), 'utf8')
}

export async function listRepairs(): Promise<NativeRepairRecord[]> {
  return readJsonFiles(repairsDir(), isRepairRecord)
}

export async function getRepair(id: string): Promise<NativeRepairRecord | null> {
  const all = await listRepairs()
  return all.find(r => r.id === id) ?? null
}

export async function listRepairsForIssue(issueId: string): Promise<NativeRepairRecord[]> {
  const all = await listRepairs()
  return all.filter(r => r.issueId === issueId)
}

export async function saveRepair(repair: NativeRepairRecord): Promise<void> {
  const dir = repairsDir()
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, `${repair.id}.json`), JSON.stringify(repair, null, 2), 'utf8')
}

/** Truthful badge count: unresolved OFFICIAL issues only (status === 'open'), never a raw event
 * count and never inflated by dismissed/resolved records. */
export async function countUnresolvedIssues(): Promise<number> {
  const all = await listIssues()
  return all.filter(i => i.status === 'open').length
}
