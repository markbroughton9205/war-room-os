/**
 * Regression suite: pre-existing sessionStorage records may hold the legacy validation shape
 * ({ verified: boolean, checkedAt, evidence, gapStillOpen?, knownGapVerified? } — no `outcome`
 * field). Display must never show a legacy passed record as failed, must treat `outcome ===
 * undefined` explicitly rather than falling through to a fixed default, and must keep the legacy
 * display states distinct from `cannot_verify`.
 */
import { pathToFileURL } from 'node:url'
import { describeValidationForDisplay, validationDisplayLabel } from './validation'
import type { LegacyRepairValidationResult, RepairValidationResult } from './types'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const LEGACY_PASSED: LegacyRepairValidationResult = {
  verified: true,
  checkedAt: '2026-01-01T00:00:00.000Z',
  evidence: ['Self-audit: gap "X" marked fixed'],
  gapStillOpen: false,
  knownGapVerified: false,
}

const LEGACY_FAILED: LegacyRepairValidationResult = {
  verified: false,
  checkedAt: '2026-01-01T00:00:00.000Z',
  evidence: ['Self-audit: gap still open (open)'],
  gapStillOpen: true,
  knownGapVerified: false,
}

const CURRENT_VERIFIED: RepairValidationResult = {
  outcome: 'verified',
  checkedAt: '2026-07-30T00:00:00.000Z',
  evidence: ['Gap no longer reported by self-audit heuristics'],
  gapStillOpen: false,
  knownGapVerified: false,
}

const CURRENT_FAILED: RepairValidationResult = {
  outcome: 'failed',
  checkedAt: '2026-07-30T00:00:00.000Z',
  evidence: ['Self-audit: gap still open (open)'],
  gapStillOpen: true,
  knownGapVerified: false,
}

const CURRENT_CANNOT_VERIFY: RepairValidationResult = {
  outcome: 'cannot_verify',
  checkedAt: '2026-07-30T00:00:00.000Z',
  evidence: ['Runtime status could not be refreshed before validation — result withheld rather than reported pass or fail.'],
  gapStillOpen: null,
  knownGapVerified: false,
}

export function runLegacyValidationDisplayValidation(): CaseResult[] {
  const results: CaseResult[] = []

  // --- Required case 1: legacy verified: true must never read as failed ----------------------
  results.push(
    check(
      'legacy_display_01_legacy_passed_is_not_shown_as_failed',
      describeValidationForDisplay(LEGACY_PASSED) === 'legacy_passed'
        && validationDisplayLabel(LEGACY_PASSED) !== 'failed',
      `state=${describeValidationForDisplay(LEGACY_PASSED)} label="${validationDisplayLabel(LEGACY_PASSED)}"`,
    ),
  )
  results.push(
    check(
      'legacy_display_01b_legacy_passed_distinct_from_current_verified',
      describeValidationForDisplay(LEGACY_PASSED) !== describeValidationForDisplay(CURRENT_VERIFIED),
      `legacy=${describeValidationForDisplay(LEGACY_PASSED)} current=${describeValidationForDisplay(CURRENT_VERIFIED)}`,
    ),
  )

  // --- Required case 2: legacy verified: false -------------------------------------------------
  results.push(
    check(
      'legacy_display_02_legacy_failed_reads_as_legacy_failed_not_cannot_verify',
      describeValidationForDisplay(LEGACY_FAILED) === 'legacy_failed'
        && describeValidationForDisplay(LEGACY_FAILED) !== 'cannot_verify',
      `state=${describeValidationForDisplay(LEGACY_FAILED)} label="${validationDisplayLabel(LEGACY_FAILED)}"`,
    ),
  )

  // --- Required case 3: current outcome: verified ----------------------------------------------
  results.push(
    check(
      'legacy_display_03_current_verified_reads_as_verified',
      describeValidationForDisplay(CURRENT_VERIFIED) === 'verified'
        && validationDisplayLabel(CURRENT_VERIFIED) === 'passed',
      `state=${describeValidationForDisplay(CURRENT_VERIFIED)} label="${validationDisplayLabel(CURRENT_VERIFIED)}"`,
    ),
  )

  // --- Required case 4: current outcome: failed ------------------------------------------------
  results.push(
    check(
      'legacy_display_04_current_failed_reads_as_failed',
      describeValidationForDisplay(CURRENT_FAILED) === 'failed'
        && validationDisplayLabel(CURRENT_FAILED) === 'failed',
      `state=${describeValidationForDisplay(CURRENT_FAILED)} label="${validationDisplayLabel(CURRENT_FAILED)}"`,
    ),
  )

  // --- Required case 5: current outcome: cannot_verify -----------------------------------------
  results.push(
    check(
      'legacy_display_05_current_cannot_verify_stays_distinct_from_legacy_and_failed',
      describeValidationForDisplay(CURRENT_CANNOT_VERIFY) === 'cannot_verify'
        && describeValidationForDisplay(CURRENT_CANNOT_VERIFY) !== 'legacy_failed'
        && describeValidationForDisplay(CURRENT_CANNOT_VERIFY) !== 'failed',
      `state=${describeValidationForDisplay(CURRENT_CANNOT_VERIFY)} label="${validationDisplayLabel(CURRENT_CANNOT_VERIFY)}"`,
    ),
  )

  // --- Extra: no validation ever run (undefined) — must say unavailable, not fabricate either
  // pass or fail. --------------------------------------------------------------------------------
  results.push(
    check(
      'legacy_display_06_no_validation_reports_unavailable_not_a_fabricated_result',
      describeValidationForDisplay(undefined) === 'unavailable',
      `state=${describeValidationForDisplay(undefined)}`,
    ),
  )

  // --- Extra: neither `outcome` nor `verified` present (malformed/unknown shape) — must fall to
  // unavailable, never silently to 'failed'. -----------------------------------------------------
  const malformed = { checkedAt: '2026-01-01T00:00:00.000Z', evidence: [] } as unknown as RepairValidationResult
  results.push(
    check(
      'legacy_display_07_malformed_shape_reports_unavailable_not_failed',
      describeValidationForDisplay(malformed) === 'unavailable',
      `state=${describeValidationForDisplay(malformed)}`,
    ),
  )

  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runLegacyValidationDisplayValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Legacy validation display validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
