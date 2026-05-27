/**
 * Approved self-repair improvements waiting for manual apply (sessionStorage).
 */

import type { SelfRepairRecord } from './selfRepair/types'

export type UpgradeQueueEntry = {
  id: string
  repairId: string
  title: string
  risk: SelfRepairRecord['plan']['risk']
  cursorCommand: string
  approvedAt: string
  status: 'queued' | 'in_progress' | 'done' | 'skipped'
}

export type UpgradeQueueSnapshot = {
  version: 1
  entries: UpgradeQueueEntry[]
}

export const UPGRADE_QUEUE_STORAGE_KEY = 'war-room-upgrade-queue'

const EMPTY: UpgradeQueueSnapshot = { version: 1, entries: [] }

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof sessionStorage !== 'undefined'
}

export function loadUpgradeQueue(): UpgradeQueueSnapshot {
  if (!isBrowser()) return { ...EMPTY, entries: [] }
  try {
    const raw = sessionStorage.getItem(UPGRADE_QUEUE_STORAGE_KEY)
    if (!raw) return { ...EMPTY, entries: [] }
    const parsed = JSON.parse(raw) as Partial<UpgradeQueueSnapshot>
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return { ...EMPTY, entries: [] }
    return { version: 1, entries: parsed.entries.filter(e => typeof e.id === 'string') }
  } catch {
    return { ...EMPTY, entries: [] }
  }
}

export function saveUpgradeQueue(snapshot: UpgradeQueueSnapshot): void {
  if (!isBrowser()) return
  try {
    sessionStorage.setItem(UPGRADE_QUEUE_STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    /* private mode */
  }
}

export function enqueueApprovedUpgrade(record: SelfRepairRecord): UpgradeQueueSnapshot {
  const snapshot = loadUpgradeQueue()
  if (snapshot.entries.some(e => e.repairId === record.id)) return snapshot
  const entry: UpgradeQueueEntry = {
    id: `upgrade-${record.id}`,
    repairId: record.id,
    title: record.plan.title,
    risk: record.plan.risk,
    cursorCommand: record.plan.cursorCommand,
    approvedAt: new Date().toISOString(),
    status: 'queued',
  }
  const next: UpgradeQueueSnapshot = {
    version: 1,
    entries: [entry, ...snapshot.entries],
  }
  saveUpgradeQueue(next)
  return next
}

export function updateUpgradeQueueEntry(
  id: string,
  status: UpgradeQueueEntry['status'],
): UpgradeQueueSnapshot {
  const snapshot = loadUpgradeQueue()
  const next: UpgradeQueueSnapshot = {
    version: 1,
    entries: snapshot.entries.map(e => (e.id === id ? { ...e, status } : e)),
  }
  saveUpgradeQueue(next)
  return next
}

export function countQueuedUpgrades(snapshot = loadUpgradeQueue()): number {
  return snapshot.entries.filter(e => e.status === 'queued' || e.status === 'in_progress').length
}
