import { enqueueApprovedUpgrade } from '../upgradeQueue'
import { createLessonCandidateFromRepair } from '../repairLessons'
import type { OperatorGap } from '../gapFinder'
import type { OperatorInboxItem } from '../inbox'
import { transitionRepairState } from './lifecycle'
import { repairPlanFromGap, repairPlanFromInboxItem } from './templates'
import { findRepairBySourceId, loadSelfRepairSnapshot, upsertSelfRepairRecord } from './storage'
import type { RepairLifecycleState, SelfRepairRecord, SelfRepairSnapshot } from './types'
import { validateRepairAgainstGaps } from './validation'
import type { GapFinderContext } from '../gapFinder'

function recordIdForSource(sourceId: string): string {
  return `self-repair-${sourceId}`
}

function detectedRecord(plan: SelfRepairRecord['plan'], gapId: string): SelfRepairRecord {
  const at = new Date().toISOString()
  return {
    id: recordIdForSource(gapId),
    plan,
    state: 'DETECTED',
    gapId,
    history: [{ state: 'DETECTED', at, note: 'Issue detected from operator surface' }],
  }
}

export function getOrDetectRepairFromGap(gap: OperatorGap): SelfRepairRecord {
  const existing = findRepairBySourceId(gap.id)
  if (existing) return existing
  const plan = repairPlanFromGap(gap)
  return detectedRecord(plan, gap.id)
}

export function getOrDetectRepairFromInbox(item: OperatorInboxItem): SelfRepairRecord {
  const existing = findRepairBySourceId(item.id)
  if (existing) return existing
  const plan = repairPlanFromInboxItem(item)
  return detectedRecord(plan, item.id)
}

function persistTransition(
  record: SelfRepairRecord,
  next: RepairLifecycleState,
  note?: string,
): SelfRepairSnapshot {
  return upsertSelfRepairRecord(transitionRepairState(record, next, note))
}

export function prepareRepairPlanFromGap(gap: OperatorGap): SelfRepairSnapshot {
  const base = getOrDetectRepairFromGap(gap)
  const plan = repairPlanFromGap(gap)
  const withPlan: SelfRepairRecord = {
    ...base,
    plan: { ...plan, id: base.plan.id, createdAt: base.plan.createdAt },
  }
  return persistTransition(withPlan, 'PROPOSED', 'Repair plan prepared')
}

export function prepareRepairPlanFromInbox(item: OperatorInboxItem): SelfRepairSnapshot {
  const base = getOrDetectRepairFromInbox(item)
  const plan = repairPlanFromInboxItem(item)
  const withPlan: SelfRepairRecord = {
    ...base,
    plan: { ...plan, id: base.plan.id, createdAt: base.plan.createdAt },
  }
  return persistTransition(withPlan, 'PROPOSED', 'Repair plan prepared from inbox')
}

export function approveRepair(record: SelfRepairRecord): SelfRepairSnapshot {
  const next = persistTransition(record, 'APPROVED', 'Commander approved repair plan')
  const approved = next.records.find(r => r.id === record.id)
  if (approved) enqueueApprovedUpgrade(approved)
  return next
}

export function markRepairInProgress(record: SelfRepairRecord): SelfRepairSnapshot {
  return persistTransition(record, 'IN_PROGRESS', 'Apply later — work queued for manual apply')
}

export function markRepairHandedOff(record: SelfRepairRecord): SelfRepairSnapshot {
  return persistTransition(record, 'HANDED_OFF', 'Cursor command copied — hand off to external editor')
}

export function markRepairApplied(record: SelfRepairRecord): SelfRepairSnapshot {
  return persistTransition(record, 'APPLIED', 'Commander marked applied manually')
}

export function validateRepair(
  record: SelfRepairRecord,
  ctx: GapFinderContext,
): { snapshot: SelfRepairSnapshot; result: ReturnType<typeof validateRepairAgainstGaps> } {
  const result = validateRepairAgainstGaps(record, ctx)
  const at = new Date().toISOString()
  const nextState: RepairLifecycleState = result.verified ? 'VALIDATED' : 'FAILED'
  const updated: SelfRepairRecord = {
    ...transitionRepairState(record, nextState, result.verified ? 'Validation passed' : 'Validation failed'),
    validation: result,
    plan: { ...record.plan, updatedAt: at },
  }
  const snapshot = upsertSelfRepairRecord(updated)
  return { snapshot, result }
}

export function learnFromRepair(record: SelfRepairRecord): SelfRepairSnapshot {
  const lesson = createLessonCandidateFromRepair(record)
  const withLesson: SelfRepairRecord = {
    ...record,
    lessonCandidateId: lesson.id,
  }
  const archived = transitionRepairState(withLesson, 'ARCHIVED', 'Lesson captured')
  return upsertSelfRepairRecord(archived)
}

export function archiveRepair(record: SelfRepairRecord): SelfRepairSnapshot {
  return persistTransition(record, 'ARCHIVED', 'Archived without lesson')
}

export type SystemHealthRepairSummary = {
  openIssues: number
  approvedUpgrades: number
  inProgress: number
  verified: number
  failed: number
  lessons: number
}

export function summarizeSelfRepairHealth(
  snapshot: SelfRepairSnapshot,
  openGapCount: number,
  upgradeApprovedCount: number,
  lessonCount: number,
): SystemHealthRepairSummary {
  const records = snapshot.records
  const inProgress = records.filter(r =>
    ['IN_PROGRESS', 'HANDED_OFF', 'APPLIED'].includes(r.state),
  ).length
  const verified = records.filter(r => r.state === 'VALIDATED').length
  const failed = records.filter(r => r.state === 'FAILED').length

  return {
    openIssues: openGapCount,
    approvedUpgrades: upgradeApprovedCount,
    inProgress,
    verified,
    failed,
    lessons: lessonCount,
  }
}

export function listActiveRepairs(snapshot = loadSelfRepairSnapshot()): SelfRepairRecord[] {
  return snapshot.records.filter(r => r.state !== 'ARCHIVED' && r.state !== 'APPROVED')
}
