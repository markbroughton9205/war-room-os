/** Single deployment-wide scope until multi-tenant keys are introduced. */
export const WAR_ROOM_RUNTIME_STATE_SCOPE = 'war_room'

export const RUNTIME_STATE_KEYS = {
  integritySnapshot: 'integrity_snapshot',
  providerSlots: 'provider_slots',
  attendanceSummary: 'attendance_summary',
  diagnosticHistory: 'diagnostic_history',
  redTeamHoldUnresolved: 'red_team_hold_unresolved',
  diagnosticModeSummary: 'diagnostic_mode_summary',
} as const

export type RuntimeStateKey = (typeof RUNTIME_STATE_KEYS)[keyof typeof RUNTIME_STATE_KEYS]
