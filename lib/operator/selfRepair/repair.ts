import { enqueueApprovedUpgrade } from '../upgradeQueue'
import { createLessonCandidateFromRepair } from '../repairLessons'
import type { OperatorGap } from '../gapFinder'
import type { OperatorInboxItem } from '../inbox'
import { transitionRepairState } from './lifecycle'
import { repairPlanFromGap, repairPlanFromInboxItem } from './templates'
import { findRepairBySourceId, loadSelfRepairSnapshot, upsertSelfRepairRecord } from './storage'
import type { RepairLifecycleState, RepairValidationResult, SelfRepairRecord, SelfRepairSnapshot } from './types'
import { validateRepairAgainstGaps } from './validation'
import type { GapFinderContext, RuntimeRefreshResult } from '../gapFinder'

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

export type ValidateRepairOutcome = { snapshot: SelfRepairSnapshot; result: RepairValidationResult }

/** Keyed by record id — a second Validate Repair click (or a second mounted copy of the same
 * repair item, e.g. GapFinderPanel and OperatorInboxPanel both rendering it at once) while a
 * refresh+check is already in flight joins that same in-flight promise instead of starting a
 * second, independently-racing refresh. */
const inFlightValidations = new Map<string, Promise<ValidateRepairOutcome>>()

function cannotVerifyResult(evidence: string[]): RepairValidationResult {
  return {
    outcome: 'cannot_verify',
    checkedAt: new Date().toISOString(),
    evidence,
    gapStillOpen: null,
    knownGapVerified: false,
  }
}

/** Merges an on-demand refresh result into a context, field by field. A field counts as
 * "supplied by this refresh" only when the property both exists on the result AND its value is
 * not `undefined` — `undefined` always means "this refresh didn't touch this field," whether that
 * property is entirely absent or explicitly set to `undefined`. A present `canonicalStatus: null`
 * is different: `null` is not `undefined`, so it still counts as supplied — a legitimate
 * authoritative result (a checked-and-empty answer, not "not checked"). Only a field this
 * specific refresh actually supplied may be marked 'ready' or replace the cached value — anything
 * else keeps its prior value AND prior readiness untouched, so a partial refresh (e.g. one that
 * only re-checks providerConnection) can never silently relabel a stale cached canonicalStatus as
 * freshly verified. Exported for direct, precise regression testing independent of gap-evaluation
 * semantics. */
export function mergeRefreshedContext(ctx: GapFinderContext, refreshed: RuntimeRefreshResult): GapFinderContext {
  const providerConnectionSupplied =
    Object.prototype.hasOwnProperty.call(refreshed, 'providerConnection') && refreshed.providerConnection !== undefined
  const canonicalStatusSupplied =
    Object.prototype.hasOwnProperty.call(refreshed, 'canonicalStatus') && refreshed.canonicalStatus !== undefined

  return {
    ...ctx,
    providerConnection: providerConnectionSupplied ? refreshed.providerConnection : ctx.providerConnection,
    canonicalStatus: canonicalStatusSupplied ? refreshed.canonicalStatus : ctx.canonicalStatus,
    canonicalStatusUnavailable: canonicalStatusSupplied
      ? (refreshed.canonicalStatusUnavailable ?? false)
      : ctx.canonicalStatusUnavailable,
    runtimeReadiness: {
      ...ctx.runtimeReadiness,
      ...(providerConnectionSupplied ? { providerConnection: 'ready' as const } : {}),
      ...(canonicalStatusSupplied ? { canonicalStatus: 'ready' as const } : {}),
    },
  }
}

async function runValidation(record: SelfRepairRecord, ctx: GapFinderContext): Promise<ValidateRepairOutcome> {
  const at = new Date().toISOString()

  // No refresh function supplied (e.g. a test/embedding that doesn't support one) — fall back to
  // evaluating the context as given, matching the previous (pre-fresh-validation) behavior.
  if (!ctx.refreshRuntimeData) {
    const result = validateRepairAgainstGaps(record, ctx)
    const nextState: RepairLifecycleState = result.outcome === 'verified' ? 'VALIDATED' : 'FAILED'
    const updated: SelfRepairRecord = {
      ...transitionRepairState(record, nextState, result.outcome === 'verified' ? 'Validation passed' : 'Validation failed'),
      validation: result,
      plan: { ...record.plan, updatedAt: at },
    }
    return { snapshot: upsertSelfRepairRecord(updated), result }
  }

  let refreshed: Awaited<ReturnType<NonNullable<GapFinderContext['refreshRuntimeData']>>>
  try {
    refreshed = await ctx.refreshRuntimeData()
  } catch {
    refreshed = { ok: false }
  }

  if (!refreshed.ok) {
    const result = cannotVerifyResult([
      'Runtime status could not be refreshed before validation — result withheld rather than reported pass or fail.',
    ])
    const updated: SelfRepairRecord = { ...record, validation: result, plan: { ...record.plan, updatedAt: at } }
    return { snapshot: upsertSelfRepairRecord(updated), result }
  }

  const freshCtx = mergeRefreshedContext(ctx, refreshed)

  const result = validateRepairAgainstGaps(record, freshCtx)
  const nextState: RepairLifecycleState = result.outcome === 'verified' ? 'VALIDATED' : 'FAILED'
  const updated: SelfRepairRecord = {
    ...transitionRepairState(record, nextState, result.outcome === 'verified' ? 'Validation passed (fresh check)' : 'Validation failed (fresh check)'),
    validation: result,
    plan: { ...record.plan, updatedAt: at },
  }
  return { snapshot: upsertSelfRepairRecord(updated), result }
}

export function validateRepair(
  record: SelfRepairRecord,
  ctx: GapFinderContext,
): Promise<ValidateRepairOutcome> {
  const existing = inFlightValidations.get(record.id)
  if (existing) return existing

  const promise = runValidation(record, ctx).finally(() => {
    if (inFlightValidations.get(record.id) === promise) inFlightValidations.delete(record.id)
  })
  inFlightValidations.set(record.id, promise)
  return promise
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
