import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { ProviderFamilyOutcomeStatus } from '@/lib/council/providerIsolation'
import type { CouncilProviderRuntimeDetails, CouncilProviderRuntimeStates } from '@/lib/council/renderPacket'

/**
 * Commander-facing outcome for one family in the *current* Council operation — distinct from
 * provider connectivity (whether the API is configured/reachable at all). A family can be
 * connected and still time out, fail, or simply not be part of this round's roster.
 */
export type FamilyOperationStatus =
  | 'ready'
  | 'queued'
  | 'thinking'
  | 'responded'
  | 'degraded'
  | 'provider_error'
  | 'timed_out'
  | 'empty_response'
  | 'unavailable'
  | 'not_called'

export type FamilyOperationTone = 'green' | 'neutral' | 'amber' | 'red'

export const FAMILY_OPERATION_STATUS_PRESENTATION: Record<
  FamilyOperationStatus,
  { label: string; tone: FamilyOperationTone }
> = {
  ready: { label: 'Ready', tone: 'green' },
  queued: { label: 'Queued', tone: 'neutral' },
  thinking: { label: 'Thinking', tone: 'neutral' },
  responded: { label: 'Responded', tone: 'green' },
  degraded: { label: 'Degraded', tone: 'amber' },
  provider_error: { label: 'Provider error', tone: 'red' },
  timed_out: { label: 'Timed out', tone: 'red' },
  empty_response: { label: 'Empty response', tone: 'amber' },
  unavailable: { label: 'Unavailable', tone: 'amber' },
  not_called: { label: 'Not called', tone: 'amber' },
}

/** Runtime-detail strings that mean "this family was never actually attempted this round",
 * as opposed to an attempt that ran and failed. */
const NOT_CALLED_DETAILS = new Set([
  'superseded',
  'aborted',
  'missing_gather_slot',
  'governor_silent_skip',
  'missing_direct_invocation_result',
])

/**
 * Maps the canonical per-family runtime outcome (already produced by the gather pipeline) to a
 * Commander-facing operation status. Never fabricates an outcome: a family with no runtime entry
 * gets `not_called` only when an operation has concluded (`operationConcluded: true`); while an
 * operation is still running, an absent entry means the family hasn't reported back yet, so it
 * maps to `thinking` (loading) or `queued` (not yet started) via `inProgress`/`hasStarted`, not to
 * any terminal state.
 */
export function mapFamilyOperationStatus(args: {
  runtime: ProviderFamilyOutcomeStatus | undefined
  runtimeDetail?: string
  operationConcluded: boolean
  operationInProgress: boolean
}): FamilyOperationStatus {
  const { runtime, runtimeDetail, operationConcluded, operationInProgress } = args

  if (runtime === 'RESPONDED') return 'responded'
  if (runtime === 'DEGRADED') return 'degraded'
  if (runtime === 'TIMED_OUT') return 'timed_out'
  if (runtime === 'FAILED') {
    // `runtimeDetail` is either the fixed 'empty_response' constant (direct-invocation path) or a
    // free-text server error message (parallel-gather path, e.g. "Claude returned empty content") —
    // match both so the same real failure gets the same honest label regardless of which path hit it.
    const isEmptyResponse = runtimeDetail === 'empty_response' || (runtimeDetail && /empty\s+(content|response)/i.test(runtimeDetail))
    return isEmptyResponse ? 'empty_response' : 'provider_error'
  }
  if (runtime === 'IN_FLIGHT') return 'thinking'
  if (runtime === 'SKIPPED') {
    if (runtimeDetail === 'preflight_unavailable') return 'unavailable'
    if (runtimeDetail && NOT_CALLED_DETAILS.has(runtimeDetail)) return 'not_called'
    return 'not_called'
  }
  if (runtime === 'READY') return 'ready'

  // No runtime entry at all for this family this round.
  if (operationConcluded) return 'not_called'
  if (operationInProgress) return 'thinking'
  return 'ready'
}

export type FamilyOperationStatusMap = Partial<Record<CouncilOrchestrationFamily, FamilyOperationStatus>>

/**
 * Projects the canonical `providerRuntimeStates`/`providerRuntimeDetails` (plus the full directed
 * roster, when known) into a per-family status map covering every targeted family — including
 * ones absent from `providerRuntimeStates` entirely (shown as `not_called` once the operation has
 * concluded, never fabricated as an error).
 */
export function projectFamilyOperationStatuses(args: {
  directedFamilies?: CouncilOrchestrationFamily[]
  providerRuntimeStates?: CouncilProviderRuntimeStates
  providerRuntimeDetails?: CouncilProviderRuntimeDetails
  operationConcluded: boolean
  operationInProgress: boolean
}): FamilyOperationStatusMap {
  const families = new Set<CouncilOrchestrationFamily>([
    ...(args.directedFamilies ?? []),
    ...(Object.keys(args.providerRuntimeStates ?? {}) as CouncilOrchestrationFamily[]),
  ])
  const out: FamilyOperationStatusMap = {}
  for (const family of families) {
    out[family] = mapFamilyOperationStatus({
      runtime: args.providerRuntimeStates?.[family],
      runtimeDetail: args.providerRuntimeDetails?.[family],
      operationConcluded: args.operationConcluded,
      operationInProgress: args.operationInProgress,
    })
  }
  return out
}

/** Kept in sync with `isActionableProviderRuntime`/`packetHasActionableProviderIssues` in
 * `attendanceReadiness.ts`, which decide whether the provider-issue banner shows at all — this
 * list decides what the banner *says* once it's showing, so the two must agree on which
 * outcomes count as an issue. Exported (export-only change, no behavior change) so
 * `familyOperationStatus.validation.ts` can cross-check against the real constant instead of a
 * duplicated copy — see the `status_sync_*` cases below. */
export const ISSUE_STATUSES: readonly FamilyOperationStatus[] = [
  'provider_error',
  'timed_out',
  'empty_response',
  'unavailable',
  'degraded',
]

function describeFamilyOperationIssue(status: FamilyOperationStatus): string | null {
  switch (status) {
    case 'timed_out':
      return 'timed out'
    case 'empty_response':
      return 'returned an empty response'
    case 'degraded':
      return 'returned a degraded response'
    case 'provider_error':
      return null // reason unknown beyond "did not complete" — handled by caller fallback
    case 'unavailable':
      return 'was unavailable'
    default:
      return null
  }
}

/**
 * Builds the Commander-facing provider-issue banner from real per-family outcomes — never the
 * generic "see family status badges" placeholder. Returns null when nothing is actionable.
 */
export function buildProviderIssueBanner(
  statuses: FamilyOperationStatusMap,
  familyLabel: (family: CouncilOrchestrationFamily) => string,
): string | null {
  const issues = (Object.entries(statuses) as [CouncilOrchestrationFamily, FamilyOperationStatus][])
    .filter(([, status]) => ISSUE_STATUSES.includes(status))

  if (!issues.length) return null

  const fragments = issues.map(([family, status]) => {
    const label = familyLabel(family)
    const reason = describeFamilyOperationIssue(status)
    return reason ? `${label} ${reason}` : `${label} did not complete this Council round`
  })

  if (fragments.length === 1) return `${fragments[0]}.`
  return `Provider issues — ${fragments.join('; ')}.`
}

/** Counts real responses (RESPONDED + DEGRADED — both produced content) against the directed
 * roster size, for an honest "3 of 5 responded" progress readout. Returns null when there's no
 * directed roster to count against (nothing to report yet). */
export function countFamilyResponses(
  statuses: FamilyOperationStatusMap,
  directedFamilies: CouncilOrchestrationFamily[] | undefined,
): { responded: number; total: number } | null {
  if (!directedFamilies || !directedFamilies.length) return null
  const responded = directedFamilies.filter(f => statuses[f] === 'responded' || statuses[f] === 'degraded').length
  return { responded, total: directedFamilies.length }
}
