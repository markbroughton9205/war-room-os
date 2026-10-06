/**
 * Legacy execution-path classification for ENGINE-03P.
 * Do not delete proven fallbacks until the production owner is validated.
 */
export const ENGINE03P_LEGACY_PATHS = [
  { path: 'runCouncilIntelligenceMission → runLiveExecution (this mission)', classification: 'ROUTE_THROUGH_ENGINE03' as const, notes: 'Canonical Home Send owner for EBC-terminating missions' },
  { path: 'runEvidenceBoardCouncil worker tools', classification: 'ROUTE_THROUGH_ENGINE03' as const, notes: 'Wrapped to reuse Engine-03 dispatches; leftover tools KEEP if Engine-03 did not own them' },
  { path: 'execute.ts runTurnLiveResearchIfNeeded on SYSTEM_STATUS/DEEP_RESEARCH', classification: 'DEPRECATE' as const, notes: 'Skipped when Engine-03 owns the mission to prevent duplicate broker calls' },
  { path: 'execute.ts runTurnLiveResearchIfNeeded on family-deliberation missions', classification: 'KEEP' as const, notes: 'Family seat loop is not EBC-terminating; remains prior-aware research owner' },
  { path: 'family-to-family deliberation after evidenceBoardTerminates=false', classification: 'KEEP' as const, notes: 'Proven seat loop; not replaced' },
  { path: 'family-to-family internal intelligence call', classification: 'KEEP' as const, notes: 'Engine-03 skipped so prior-aware live research remains the single tool owner' },
  { path: 'scout swarm / RAEL isolation path', classification: 'KEEP' as const, notes: 'Separate mission runtime; not the EBC-terminating Home Send owner' },
  { path: 'GI front door', classification: 'KEEP' as const, notes: 'Non-Council GI short circuit' },
  { path: 'tmp/council-engine-03 live-acceptance harness', classification: 'TEST_ONLY' as const, notes: 'Must not be required for production invocation' },
  { path: 'input.liveExecution injection on runCouncilExecutive', classification: 'TEST_ONLY' as const, notes: 'Production pipeline now supplies liveExecution itself' },
] as const
