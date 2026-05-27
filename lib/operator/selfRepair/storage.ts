import type { SelfRepairRecord, SelfRepairSnapshot } from './types'
import { SELF_REPAIR_STORAGE_KEY } from './types'

const EMPTY: SelfRepairSnapshot = { version: 1, records: [] }

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof sessionStorage !== 'undefined'
}

function isValidRecord(value: unknown): value is SelfRepairRecord {
  if (!value || typeof value !== 'object') return false
  const row = value as SelfRepairRecord
  return (
    typeof row.id === 'string' &&
    typeof row.state === 'string' &&
    typeof row.gapId === 'string' &&
    row.plan &&
    typeof row.plan.cursorCommand === 'string'
  )
}

export function loadSelfRepairSnapshot(): SelfRepairSnapshot {
  if (!isBrowser()) return { ...EMPTY, records: [] }
  try {
    const raw = sessionStorage.getItem(SELF_REPAIR_STORAGE_KEY)
    if (!raw) return { ...EMPTY, records: [] }
    const parsed = JSON.parse(raw) as Partial<SelfRepairSnapshot>
    if (parsed.version !== 1 || !Array.isArray(parsed.records)) {
      return { ...EMPTY, records: [] }
    }
    return {
      version: 1,
      records: parsed.records.filter(isValidRecord),
      lastUpdatedAt: typeof parsed.lastUpdatedAt === 'string' ? parsed.lastUpdatedAt : undefined,
    }
  } catch {
    return { ...EMPTY, records: [] }
  }
}

export function saveSelfRepairSnapshot(snapshot: SelfRepairSnapshot): void {
  if (!isBrowser()) return
  try {
    sessionStorage.setItem(SELF_REPAIR_STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    /* private mode */
  }
}

export function upsertSelfRepairRecord(record: SelfRepairRecord): SelfRepairSnapshot {
  const snapshot = loadSelfRepairSnapshot()
  const at = new Date().toISOString()
  const byId = new Map(snapshot.records.map(r => [r.id, r]))
  byId.set(record.id, record)
  const next: SelfRepairSnapshot = {
    version: 1,
    records: [...byId.values()].sort((a, b) => b.plan.updatedAt.localeCompare(a.plan.updatedAt)),
    lastUpdatedAt: at,
  }
  saveSelfRepairSnapshot(next)
  return next
}

export function findRepairBySourceId(sourceId: string): SelfRepairRecord | undefined {
  return loadSelfRepairSnapshot().records.find(
    r => r.plan.sourceId === sourceId || r.gapId === sourceId,
  )
}
