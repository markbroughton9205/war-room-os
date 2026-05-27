import type { RepairHistoryEntry, RepairLifecycleState, SelfRepairRecord } from './types'

export function transitionRepairState(
  record: SelfRepairRecord,
  next: RepairLifecycleState,
  note?: string,
): SelfRepairRecord {
  const at = new Date().toISOString()
  const history: RepairHistoryEntry[] = [...record.history, { state: next, at, note }]
  return {
    ...record,
    state: next,
    history,
    plan: { ...record.plan, updatedAt: at },
  }
}

export function canTransition(from: RepairLifecycleState, to: RepairLifecycleState): boolean {
  const allowed: Record<RepairLifecycleState, RepairLifecycleState[]> = {
    DETECTED: ['PROPOSED', 'ARCHIVED'],
    PROPOSED: ['APPROVED', 'DETECTED', 'ARCHIVED'],
    APPROVED: ['IN_PROGRESS', 'HANDED_OFF', 'PROPOSED', 'ARCHIVED'],
    IN_PROGRESS: ['APPLIED', 'HANDED_OFF', 'FAILED', 'ARCHIVED'],
    HANDED_OFF: ['APPLIED', 'IN_PROGRESS', 'FAILED', 'ARCHIVED'],
    APPLIED: ['VALIDATED', 'FAILED', 'IN_PROGRESS', 'ARCHIVED'],
    VALIDATED: ['ARCHIVED'],
    FAILED: ['PROPOSED', 'IN_PROGRESS', 'ARCHIVED'],
    ARCHIVED: [],
  }
  return allowed[from]?.includes(to) ?? false
}

export function lifecycleLabel(state: RepairLifecycleState): string {
  const labels: Record<RepairLifecycleState, string> = {
    DETECTED: 'Detected',
    PROPOSED: 'Proposed',
    APPROVED: 'Approved',
    IN_PROGRESS: 'In progress',
    HANDED_OFF: 'Sent to Cursor',
    APPLIED: 'Applied (manual)',
    VALIDATED: 'Verified',
    FAILED: 'Failed verify',
    ARCHIVED: 'Archived',
  }
  return labels[state]
}
