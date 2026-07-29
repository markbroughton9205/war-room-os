import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { CouncilShadowSelectionReport } from '@/lib/council/adaptive-assembly'
import type { CouncilProgressRuntimeSnapshot } from '@/lib/council/progress-events/runtime'
import type { ProviderFamilyOutcomeStatus } from '@/lib/council/providerIsolation'

export type AttendanceReleaseCell = {
  family: CouncilOrchestrationFamily
  textOut: string | null
  runtime: ProviderFamilyOutcomeStatus
  runtimeDetail?: string
  transientMessageIds?: string[]
  shadowCouncilAssembly?: CouncilShadowSelectionReport
  councilProgress?: CouncilProgressRuntimeSnapshot
}

export type AttendanceLateLine = {
  family: CouncilOrchestrationFamily
  textOut: string
  transientMessageIds?: string[]
  shadowCouncilAssembly?: CouncilShadowSelectionReport
  councilProgress?: CouncilProgressRuntimeSnapshot
}

export type AttendanceLateSlotStatus = 'DEGRADED' | 'FAILED' | 'UNAVAILABLE'

/**
 * Builds the late-reveal batch after the attendance hard-close settles. Each family not
 * already present in `alreadyRevealedFamilies` (the soft-cap batch) appears in the result
 * exactly once — with its real late-arriving content when it has one, or an honest,
 * never-fabricated fallback line from `buildFallbackLine` when it genuinely has none.
 * Families already revealed are skipped outright so no family is ever released twice.
 * Output order follows `cells`'s order (the packet's directed family order).
 */
export function buildAttendanceLateLines(
  cells: readonly AttendanceReleaseCell[],
  alreadyRevealedFamilies: ReadonlySet<CouncilOrchestrationFamily>,
  buildFallbackLine: (family: CouncilOrchestrationFamily, slotStatus: AttendanceLateSlotStatus) => string,
): AttendanceLateLine[] {
  const lateLines: AttendanceLateLine[] = []
  for (const cell of cells) {
    if (alreadyRevealedFamilies.has(cell.family)) continue
    if (cell.textOut?.trim()) {
      lateLines.push({
        family: cell.family,
        textOut: cell.textOut.trim(),
        transientMessageIds: cell.transientMessageIds,
        shadowCouncilAssembly: cell.shadowCouncilAssembly,
        councilProgress: cell.councilProgress,
      })
      continue
    }
    const slotStatus: AttendanceLateSlotStatus =
      cell.runtime === 'DEGRADED' ? 'DEGRADED' : cell.runtime === 'FAILED' ? 'FAILED' : 'UNAVAILABLE'
    lateLines.push({ family: cell.family, textOut: buildFallbackLine(cell.family, slotStatus) })
  }
  return lateLines
}
