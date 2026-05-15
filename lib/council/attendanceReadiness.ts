import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { orchestrationFamilyToLocalAgentId } from '@/components/council/councilOrchestration'
import type { CouncilCommand } from '@/lib/council/councilCommandTypes'
import { filterOrchestrationOrderByCommand } from '@/lib/council/commandParser'
import { decreeRequestsKimi } from '@/lib/council/familyRoster'
import type { CouncilParticipationToggles } from '@/lib/council/familyRoster'
import type { ProviderFamilyOutcomeStatus } from '@/lib/council/providerIsolation'
import { COUNCIL_ROSTER } from '@/lib/council/familyRoster'

/** Required cloud families for a full attendance roll call. */
export const ATTENDANCE_REQUIRED_CORE: CouncilOrchestrationFamily[] = [
  'chatgpt',
  'claude',
  'grok',
  'gemini',
  'red_team',
]

export type AttendanceSlotStatus = 'PRESENT' | 'IN_FLIGHT' | 'UNAVAILABLE' | 'DEGRADED' | 'FAILED'

export type AttendanceSlot = {
  status: AttendanceSlotStatus
  content?: string
  /** First valid confirmation wins for this session slot. */
  confirmed: boolean
}

export function isAttendanceIntent(
  cmd: CouncilCommand,
  intentKind: string,
): boolean {
  return cmd.mode === 'attendance' || intentKind === 'attendance'
}

export function buildAttendanceDirectedOrder(args: {
  cmd: CouncilCommand
  decree: string
  participationToggles: CouncilParticipationToggles
  localFamilyAgents: { familyAgents: { id: string; functional: boolean }[] }
}): CouncilOrchestrationFamily[] {
  const merged: CouncilOrchestrationFamily[] = [...ATTENDANCE_REQUIRED_CORE]
  const kimiId = orchestrationFamilyToLocalAgentId('kimi')
  const kimiFunctional = Boolean(
    kimiId && args.localFamilyAgents.familyAgents.find(a => a.id === kimiId)?.functional,
  )
  if (args.participationToggles.includeKimi || decreeRequestsKimi(args.decree) || kimiFunctional) {
    if (!merged.includes('kimi')) merged.push('kimi')
  }
  return filterOrchestrationOrderByCommand(merged, args.cmd, args.decree)
}

export function rosterLabelForAttendance(family: CouncilOrchestrationFamily): string {
  return COUNCIL_ROSTER.find(r => r.id === family)?.label ?? family
}

/** UI badge label — never "skipped" for in-flight / soft-cap families. */
export function attendanceBadgeLabel(runtime: ProviderFamilyOutcomeStatus): string {
  switch (runtime) {
    case 'RESPONDED':
    case 'READY':
      return 'present'
    case 'IN_FLIGHT':
      return 'confirming'
    case 'DEGRADED':
      return 'degraded'
    case 'TIMED_OUT':
    case 'SKIPPED':
      return 'unavailable'
    case 'FAILED':
      return 'failed'
    default:
      return String(runtime).toLowerCase()
  }
}

export function runtimeToAttendanceSlot(
  runtime: ProviderFamilyOutcomeStatus,
  hasContent: boolean,
): AttendanceSlotStatus {
  if (hasContent) return 'PRESENT'
  if (runtime === 'IN_FLIGHT') return 'IN_FLIGHT'
  if (runtime === 'DEGRADED') return 'DEGRADED'
  if (runtime === 'FAILED') return 'FAILED'
  if (runtime === 'SKIPPED' || runtime === 'TIMED_OUT') return 'UNAVAILABLE'
  return 'IN_FLIGHT'
}

/** After soft gather window: unsettled providers stay confirming, not skipped. */
export function runtimeAfterAttendanceSoftCap(args: {
  runtime: ProviderFamilyOutcomeStatus
  hasContent: boolean
  runtimeDetail?: string
}): ProviderFamilyOutcomeStatus {
  if (args.hasContent) return 'RESPONDED'
  if (args.runtime === 'SKIPPED') return 'SKIPPED'
  if (args.runtime === 'FAILED' || args.runtime === 'DEGRADED') return args.runtime
  return 'IN_FLIGHT'
}

/** Hard close: unsettled in-flight → timeout (unavailable), not skipped. */
export function runtimeAfterAttendanceHardClose(args: {
  runtime: ProviderFamilyOutcomeStatus
  hasContent: boolean
  runtimeDetail?: string
}): ProviderFamilyOutcomeStatus {
  if (args.hasContent) return 'RESPONDED'
  if (args.runtime === 'SKIPPED') return 'SKIPPED'
  if (args.runtime === 'FAILED') return 'FAILED'
  if (args.runtime === 'DEGRADED') return 'DEGRADED'
  if (args.runtime === 'IN_FLIGHT' || args.runtimeDetail === 'attendance_soft_cap') {
    return 'TIMED_OUT'
  }
  if (args.runtime === 'TIMED_OUT') return 'TIMED_OUT'
  return 'TIMED_OUT'
}

/** Runtime outcomes that should surface provider-issue UI for the current packet. */
export function isActionableProviderRuntime(
  runtime: ProviderFamilyOutcomeStatus,
  runtimeDetail?: string,
): boolean {
  if (runtime === 'FAILED' || runtime === 'TIMED_OUT' || runtime === 'DEGRADED') return true
  if (runtime === 'SKIPPED' && runtimeDetail === 'preflight_unavailable') return true
  return false
}

export function packetHasActionableProviderIssues(
  states: Partial<Record<CouncilOrchestrationFamily, ProviderFamilyOutcomeStatus>> | undefined,
  runtimeDetails?: Partial<Record<CouncilOrchestrationFamily, string>>,
): boolean {
  if (!states) return false
  return (Object.entries(states) as [CouncilOrchestrationFamily, ProviderFamilyOutcomeStatus][]).some(
    ([family, runtime]) => isActionableProviderRuntime(runtime, runtimeDetails?.[family]),
  )
}

export function attendancePresenceLine(
  family: CouncilOrchestrationFamily,
  status: AttendanceSlotStatus,
): string {
  const label = rosterLabelForAttendance(family)
  switch (status) {
    case 'PRESENT':
      return `${label} present.`
    case 'IN_FLIGHT':
      return `${label} confirming.`
    case 'DEGRADED':
      return `${label} degraded.`
    case 'FAILED':
      return `${label} failed.`
    case 'UNAVAILABLE':
    default:
      return `${label} unavailable.`
  }
}
