/**
 * Production completion gate for a War Room APPLICATION mission. Extended in PASS 003: PASS 002's
 * flags proved an install exists and *some* installed runtime is live and healthy — they did NOT
 * prove the exact newly-produced install is the one actually running. An unrelated, already-live
 * War Room instance (e.g. concurrent Terra work on a shared machine) could otherwise satisfy
 * INSTALLED_RUNTIME_RUNNING/VERIFIED without the mission's own build ever being exercised. PASS
 * 003 closes that gap with explicit ACTIVE/RUNNING identity-match flags — this is a pure
 * aggregator; every flag must come from real evidence (a build.run/package.run/installer result,
 * a live runtime.verify, real browser/console/network reads), never inferred or assumed true.
 */
export type CompletionEvidence = {
  sourceChanged: boolean
  validationOk: boolean
  buildOk: boolean
  packageOk: boolean
  installOk: boolean
  /** PASS 003: installer.active_status's activeInstallId, and whether it equals this mission's
   * own newly-installed installId — the "did activation target OUR build" check. */
  activeInstallId: string | null
  missionInstallId: string | null
  /** PASS 003: runtime.verify's runningInstallId, and the ownership-derived health/identity
   * evidence — replaces the PASS 002 "something on 3848" proxy. */
  runningInstallId: string | null
  uiHealthOk: boolean
  coreHealthOk: boolean
  identityMatch: boolean | null
  browserAcceptanceOk: boolean
  consoleAcceptanceOk: boolean
  networkAcceptanceOk: boolean
  /** Optional: activation-only proofs omit these; the full PASS 003 gate supplies them. */
  computerUseAcceptance?: 'PASS' | 'VERIFIED_HARD_BLOCKER' | 'FAIL'
  localDeploymentAcceptanceOk?: boolean
}

export type CompletionGateResult = {
  flags: {
    SOURCE_DONE: boolean
    VALIDATION_DONE: boolean
    BUILD_DONE: boolean
    PACKAGE_DONE: boolean
    INSTALL_DONE: boolean
    ACTIVE_INSTALL_MATCHES_MISSION: boolean
    RUNNING_INSTALL_MATCHES_MISSION: boolean
    ACTIVE_RUNNING_IDENTITY_MATCH: boolean
    UI_HEALTH: boolean
    CORE_HEALTH: boolean
    BROWSER_ACCEPTANCE: boolean
    CONSOLE_ACCEPTANCE: boolean
    NETWORK_ACCEPTANCE: boolean
    COMPUTER_USE_ACCEPTANCE: boolean
    LOCAL_DEPLOYMENT_ACCEPTANCE: boolean
  }
  complete: boolean
  headline: 'COMPLETE' | 'NOT COMPLETE'
  missing: string[]
  detail: string
}

export function evaluateCompletionGate(evidence: CompletionEvidence): CompletionGateResult {
  const activeMatchesMission = evidence.activeInstallId !== null && evidence.activeInstallId === evidence.missionInstallId
  const runningMatchesMission = evidence.runningInstallId !== null && evidence.runningInstallId === evidence.missionInstallId
  const flags = {
    SOURCE_DONE: evidence.sourceChanged,
    VALIDATION_DONE: evidence.validationOk,
    BUILD_DONE: evidence.buildOk,
    PACKAGE_DONE: evidence.packageOk,
    INSTALL_DONE: evidence.installOk,
    ACTIVE_INSTALL_MATCHES_MISSION: activeMatchesMission,
    RUNNING_INSTALL_MATCHES_MISSION: runningMatchesMission,
    ACTIVE_RUNNING_IDENTITY_MATCH: evidence.identityMatch === true && activeMatchesMission && runningMatchesMission,
    UI_HEALTH: evidence.uiHealthOk,
    CORE_HEALTH: evidence.coreHealthOk,
    BROWSER_ACCEPTANCE: evidence.browserAcceptanceOk,
    CONSOLE_ACCEPTANCE: evidence.consoleAcceptanceOk,
    NETWORK_ACCEPTANCE: evidence.networkAcceptanceOk,
    COMPUTER_USE_ACCEPTANCE: evidence.computerUseAcceptance === undefined || evidence.computerUseAcceptance === 'PASS' || evidence.computerUseAcceptance === 'VERIFIED_HARD_BLOCKER',
    LOCAL_DEPLOYMENT_ACCEPTANCE: evidence.localDeploymentAcceptanceOk === undefined || evidence.localDeploymentAcceptanceOk === true,
  }
  const missing = Object.entries(flags).filter(([, v]) => !v).map(([k]) => k)
  const complete = missing.length === 0
  const detail = complete
    ? `ACTIVE_INSTALL_ID=${evidence.activeInstallId} RUNNING_INSTALL_ID=${evidence.runningInstallId} MATCH=YES — the exact mission-produced build is active, running, and verified.`
    : `ACTIVE_INSTALL_ID=${evidence.activeInstallId ?? 'null'} RUNNING_INSTALL_ID=${evidence.runningInstallId ?? 'null'} MISSION_INSTALL_ID=${evidence.missionInstallId ?? 'null'} MATCH=${evidence.identityMatch === null ? 'N/A' : evidence.identityMatch ? 'YES' : 'NO'} — missing: ${missing.join(', ') || 'none'}.`
  return { flags, complete, headline: complete ? 'COMPLETE' : 'NOT COMPLETE', missing, detail }
}
