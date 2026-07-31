import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { CommanderOperationEvent, CommanderOperationEventType } from './types'

export type OperationFamilyContributionCounts = {
  respondedCount: number
  failedCount: number
  unavailableCount: number
  skippedCount: number
}

const FAMILY_TERMINAL_EVENT_TYPES: ReadonlySet<CommanderOperationEventType> = new Set([
  'family_responded',
  'family_failed',
  'family_timed_out',
  'family_unavailable',
  'family_skipped',
])

function isRealFamilyId(
  familyId: CommanderOperationEvent['familyId'],
): familyId is CouncilOrchestrationFamily {
  return Boolean(familyId) && familyId !== 'system' && familyId !== 'unknown'
}

/**
 * Counts distinct provider-family contributions from an operation's event log — never raw event
 * volume. Each family's outcome is decided by its LAST terminal event (by sequence order), so a
 * retry that ultimately fails is not counted as a success just because an earlier attempt looked
 * OK, and a family reported twice (e.g. a premature "responded" event later corrected by a
 * "failed" event) is counted once. `synthesis_completed` is an operation-level milestone, never a
 * provider contribution, so it never appears here. Events with no resolvable family identity
 * (`null` / `'unknown'` / `'system'`) are never counted as a successful contribution.
 */
export function countOperationFamilyContributions(
  events: readonly CommanderOperationEvent[],
): OperationFamilyContributionCounts {
  const lastEventByFamily = new Map<CouncilOrchestrationFamily, CommanderOperationEvent>()
  for (const event of events) {
    if (!FAMILY_TERMINAL_EVENT_TYPES.has(event.type) || !isRealFamilyId(event.familyId)) continue
    const existing = lastEventByFamily.get(event.familyId)
    if (!existing || event.sequence >= existing.sequence) {
      lastEventByFamily.set(event.familyId, event)
    }
  }

  const counts: OperationFamilyContributionCounts = {
    respondedCount: 0,
    failedCount: 0,
    unavailableCount: 0,
    skippedCount: 0,
  }
  for (const event of lastEventByFamily.values()) {
    if (event.type === 'family_responded') counts.respondedCount += 1
    else if (event.type === 'family_failed' || event.type === 'family_timed_out') counts.failedCount += 1
    else if (event.type === 'family_unavailable') counts.unavailableCount += 1
    else if (event.type === 'family_skipped') counts.skippedCount += 1
  }
  return counts
}
