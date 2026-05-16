import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { DiagnosticIntentMode } from '@/lib/council/diagnosticMode'
import type { ProviderFamilyOutcomeStatus } from '@/lib/council/providerIsolation'
import type { RuntimeIntegrityPartial } from '@/lib/runtime/finalizeRuntimeIntegrityResponse'
import type { ProviderIntegritySlot } from '@/lib/runtime/runtimeIntegrityTypes'

export type RuntimeAttendanceSummary = {
  capturedAt: string
  providerRuntimeStates: Partial<Record<CouncilOrchestrationFamily, ProviderFamilyOutcomeStatus>>
  providerRuntimeDetails?: Partial<Record<CouncilOrchestrationFamily, string>>
}

export type DiagnosticHistoryEvent =
  | {
      kind: 'diagnostic_session_complete'
      at: string
      intentMode?: DiagnosticIntentMode
      order: CouncilOrchestrationFamily[]
      outcomes: { family: CouncilOrchestrationFamily; runtime: ProviderFamilyOutcomeStatus }[]
    }
  | {
      kind: 'red_team_hold'
      at: string
      reason?: string
    }
  | {
      kind: 'runtime_warning'
      at: string
      subsystemId: string
      label: string
      message: string
      severity: string
    }
  | {
      kind: 'repair_recommendation'
      at: string
      subsystemId: string
      label: string
      recommendation: string
    }

export type DiagnosticModeSummary = {
  at: string
  intentMode: DiagnosticIntentMode
  label: string
}

export type RedTeamHoldUnresolvedPayload = {
  capturedAt: string
  holdReason?: string
  /** Frozen panel shape for operator awareness only — never used to auto-resume. */
  panel: {
    order: CouncilOrchestrationFamily[]
    turnIndex: number
    outcomes: { family: CouncilOrchestrationFamily; runtime: ProviderFamilyOutcomeStatus }[]
    intentMode?: DiagnosticIntentMode
  }
}

export type RuntimeContinuityRecoveryBundle = {
  recoveredFromStorageAt: string
  integrityPartial: RuntimeIntegrityPartial | null
  providerSlots: ProviderIntegritySlot[] | null
  attendanceSummary: RuntimeAttendanceSummary | null
  diagnosticHistory: DiagnosticHistoryEvent[]
  diagnosticModeSummary: DiagnosticModeSummary | null
  redTeamHoldUnresolved: RedTeamHoldUnresolvedPayload | null
}
