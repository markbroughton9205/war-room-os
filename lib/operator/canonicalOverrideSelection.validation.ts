/**
 * Regression suite for GapFinderPanel's manual-override selection/reset logic
 * (canonicalOverrideSelection.ts) — the component-level bug found during final independent
 * review: gating the merged canonicalStatusUnavailable on the override *value's* truthiness
 * (rather than on whether an override attempt happened at all) silently dropped a failed manual
 * recheck and let stale/healthy-looking base data reappear.
 */
import { pathToFileURL } from 'node:url'
import { baseSnapshotChanged, baseSnapshotFromContext, selectCanonicalStatus } from './canonicalOverrideSelection'
import type { CanonicalGapSnapshot } from './gapFinder'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const HEALTHY_BASE: CanonicalGapSnapshot = {
  providers: [{ family: 'claude', label: 'Anthropic · Claude · live connected', configured: true, availability: 'CONNECTED', health: 'healthy', connectionStatus: 'online' }],
}

const FRESH_SCAN_RESULT: CanonicalGapSnapshot = {
  providers: [{ family: 'claude', label: 'Anthropic · Claude · live connected (rechecked)', configured: true, availability: 'CONNECTED', health: 'healthy', connectionStatus: 'online' }],
}

export function runCanonicalOverrideSelectionValidation(): CaseResult[] {
  const results: CaseResult[] = []

  // --- 1: no manual scan has happened — selection uses the base unchanged ---------------------
  const noOverrideBase = baseSnapshotFromContext(HEALTHY_BASE, false)
  const noOverrideSelected = selectCanonicalStatus(
    { override: null, overrideFailed: false, hasOverride: false },
    noOverrideBase,
  )
  results.push(
    check(
      'canonical_override_01_no_scan_uses_base_unchanged',
      noOverrideSelected.canonicalStatus === HEALTHY_BASE && noOverrideSelected.canonicalStatusUnavailable === false,
      `selected=${JSON.stringify({ status: noOverrideSelected.canonicalStatus === HEALTHY_BASE ? 'HEALTHY_BASE' : noOverrideSelected.canonicalStatus, unavailable: noOverrideSelected.canonicalStatusUnavailable })}`,
    ),
  )

  // --- 2: successful manual scan overrides the base --------------------------------------------
  const successSelected = selectCanonicalStatus(
    { override: FRESH_SCAN_RESULT, overrideFailed: false, hasOverride: true },
    baseSnapshotFromContext(HEALTHY_BASE, false),
  )
  results.push(
    check(
      'canonical_override_02_successful_scan_overrides_base',
      successSelected.canonicalStatus === FRESH_SCAN_RESULT && successSelected.canonicalStatusUnavailable === false,
      `selected canonicalStatus is the fresh scan result, not the base`,
    ),
  )

  // --- 3 (the discovered defect): a failed manual scan overrides a HEALTHY cached base with
  // unavailable — this is exactly the bug: override=null must not fall through to the base. ----
  const failedScanSelected = selectCanonicalStatus(
    { override: null, overrideFailed: true, hasOverride: true },
    baseSnapshotFromContext(HEALTHY_BASE, false),
  )
  results.push(
    check(
      'canonical_override_03_failed_scan_overrides_healthy_base_with_unavailable',
      failedScanSelected.canonicalStatus === null && failedScanSelected.canonicalStatusUnavailable === true,
      `selected=${JSON.stringify(failedScanSelected)} (must report unavailable, must NOT silently show the healthy cached base)`,
    ),
  )

  // --- 4: exception after an earlier successful scan does not retain the old snapshot ---------
  // Simulates the component's catch block, which now clears the override on any failure — the
  // "current" override state passed in must already be null/failed by the time selection runs.
  const afterExceptionSelected = selectCanonicalStatus(
    { override: null, overrideFailed: true, hasOverride: true },
    baseSnapshotFromContext(HEALTHY_BASE, false),
  )
  results.push(
    check(
      'canonical_override_04_exception_after_prior_success_does_not_retain_old_snapshot',
      afterExceptionSelected.canonicalStatus === null,
      `selected canonicalStatus=${JSON.stringify(afterExceptionSelected.canonicalStatus)} (must not still be the earlier successful snapshot)`,
    ),
  )

  // --- 5: newer base data clears the manual override (reset-detection function) ----------------
  const staleLastSeen = baseSnapshotFromContext(HEALTHY_BASE, false)
  const newerBase = baseSnapshotFromContext(FRESH_SCAN_RESULT, false)
  results.push(
    check(
      'canonical_override_05_newer_base_snapshot_detected_as_changed',
      baseSnapshotChanged(newerBase, staleLastSeen),
      `changed=${baseSnapshotChanged(newerBase, staleLastSeen)} (a new base object must be detected so the override gets dropped)`,
    ),
  )
  results.push(
    check(
      'canonical_override_05b_unchanged_base_not_flagged_as_changed',
      !baseSnapshotChanged(staleLastSeen, staleLastSeen),
      `changed=${baseSnapshotChanged(staleLastSeen, staleLastSeen)} (the identical base must not be flagged as changed — this is what prevents the render-time reset from looping)`,
    ),
  )
  results.push(
    check(
      'canonical_override_05c_unavailable_flag_change_alone_is_detected',
      baseSnapshotChanged(baseSnapshotFromContext(null, true), baseSnapshotFromContext(null, false)),
      `canonicalStatusUnavailable flipping (status staying null both times) must still count as a base change`,
    ),
  )

  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runCanonicalOverrideSelectionValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Canonical override selection validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
