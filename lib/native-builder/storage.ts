/**
 * Server-side persistence for native-builder issues and repair records. File-based JSON under
 * .war-room/native-builder/, mirroring the exact pattern already proven safe in
 * lib/repo/checkpoint-store.ts (mkdir + writeFile / readdir + parse) rather than introducing a
 * new Supabase table/migration for what is, for now, local dev-runtime state. Every read here is
 * a plain parse — no function in this file calls back into runtime.ts (same lesson as the
 * self-repair recursion fix: storage stays a leaf, never re-enters the orchestrator).
 */
import { mkdir, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { parseJsonRecovering, quarantineCopy, writeFileAtomic, type AtomicWriteHooks } from './foundryAtomicJson'
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
      // A record torn by the pre-atomic writer still carries one complete record; list it rather than lose the mission.
      const parsed = parseJsonRecovering(raw)
      if (parsed.ok && isValid(parsed.value)) out.push(parsed.value)
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
  await writeFileAtomic(path.join(dir, `${issue.id}.json`), JSON.stringify(issue, null, 2))
}

export async function listRepairs(): Promise<NativeRepairRecord[]> {
  return readJsonFiles(repairsDir(), isRepairRecord)
}

export type RepairReadStatus = 'ok' | 'recovered' | 'absent' | 'corrupt'

/**
 * Reads ONE repair record directly (never the whole directory). A torn record from the pre-atomic writer is recovered to its
 * first complete value: the damaged bytes are kept in a `.torn-*` quarantine copy and the recovered record is atomically
 * rewritten, so the mission stays readable. `absent` and `corrupt` are different answers: the UI must not call a
 * recoverable or still-loading mission "history unavailable".
 */
export async function readRepairDetailed(id: string): Promise<{ record: NativeRepairRecord | null; status: RepairReadStatus; detail?: string }> {
  const file = path.join(repairsDir(), `${id}.json`)
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { record: null, status: 'absent' }
    return { record: null, status: 'corrupt', detail: error instanceof Error ? error.message : String(error) }
  }
  const parsed = parseJsonRecovering(raw)
  if (!parsed.ok || !isRepairRecord(parsed.value)) return { record: null, status: 'corrupt', detail: parsed.ok ? 'not a repair record' : parsed.error }
  if (parsed.recovered) {
    try {
      // No record lock here: callers may already hold it. The rewrite is atomic, and only ever runs for a torn legacy record.
      await quarantineCopy(file, raw)
      await writeFileAtomic(file, JSON.stringify(parsed.value, null, 2))
    } catch { /* recovery write is best effort; the recovered value is still returned */ }
    return { record: parsed.value, status: 'recovered', detail: `${parsed.discardedBytes} torn bytes set aside` }
  }
  return { record: parsed.value, status: 'ok' }
}

export async function getRepair(id: string): Promise<NativeRepairRecord | null> {
  const detailed = await readRepairDetailed(id)
  if (detailed.record) return detailed.record
  // Fall back to the directory scan for records whose file name is not `<id>.json` (legacy layouts).
  if (detailed.status === 'absent') {
    const all = await listRepairs()
    return all.find(r => r.id === id) ?? null
  }
  return null
}

export async function listRepairsForIssue(issueId: string): Promise<NativeRepairRecord[]> {
  const all = await listRepairs()
  return all.filter(r => r.issueId === issueId)
}

/** Atomic: readers and crashes see the whole previous record or the whole new one, never a partial file. */
export async function saveRepair(repair: NativeRepairRecord, hooks: AtomicWriteHooks = {}): Promise<void> {
  const dir = repairsDir()
  await mkdir(dir, { recursive: true })
  await writeFileAtomic(path.join(dir, `${repair.id}.json`), JSON.stringify(repair, null, 2), hooks)
}

/** Truthful badge count: unresolved OFFICIAL issues only (status === 'open'), never a raw event
 * count and never inflated by dismissed/resolved records. */
export async function countUnresolvedIssues(): Promise<number> {
  const all = await listIssues()
  return all.filter(i => i.status === 'open').length
}
