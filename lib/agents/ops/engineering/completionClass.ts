/**
 * The four completion classes stay separate, and none is ever derived from another:
 *   CLEAN            workflow completed, independently verified, no test quarantined and no assertion disabled
 *   WITH_QUARANTINE  workflow completed, independently verified, but at least one model-written test/assertion was quarantined
 *   UNVERIFIED       workflow completed but the independent verification did not pass (or was not run)
 *   FAILED           the workflow did not complete
 * `cleanBlockers` (required criteria without a grounded passing test, ungrounded tests, unresolved ambiguity, order dependence) also keep a run out of CLEAN and are reported in the same class.
 * A deterministic contract correction is NOT a quarantine (no test coverage is removed); it is reported separately as `correctedTests` and never hidden.
 */
export type CompletionClass = 'CLEAN' | 'WITH_QUARANTINE' | 'UNVERIFIED' | 'FAILED'
export function completionClass(r: { status: string; quarantinedTests?: number; cleanBlockers?: string[] }, verifierPassed: boolean | null): CompletionClass {
  if (r.status !== 'COMPLETED') return 'FAILED'
  if (verifierPassed !== true) return 'UNVERIFIED'
  return (r.quarantinedTests ?? 0) > 0 || (r.cleanBlockers?.length ?? 0) > 0 ? 'WITH_QUARANTINE' : 'CLEAN'
}
