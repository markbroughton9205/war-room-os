/**
 * Detects and later verifies the Phase 14 fixture's seeded bug. FAILS while the off-by-one loop
 * bound is present, PASSES once the native builder's patch is applied — this is what
 * 'validation_script' actually runs during the native-builder end-to-end proof.
 *
 * This script is NOT part of the standing Native Builder release gate (scripts/run-native-builder-
 * validation.mjs). It is intentionally expected to report FAIL when run standalone at rest: the
 * fixture's seeded bug (lib/native-builder/__fixtures__/knownIssueFixture.ts) is deliberately
 * restored after every real repair demonstration — see nativeBuilder.validation.ts's
 * testEndToEndFixtureRepair() (which runs this exact check as its direct-recheck evidence mid-test,
 * where it genuinely flips to PASS after a real patch is applied) and its final
 * resetFixtureToBroken() call, which unconditionally restores the seed regardless of outcome. A
 * standalone FAIL here means the fixture is correctly seeded and awaiting a live demonstration, not
 * that production code is broken. See docs/architecture/NATIVE_BUILDER_ARCHITECTURE_AND_GOVERNANCE.md
 * for the full explanation.
 */
import { sumFixtureValues } from './knownIssueFixture'
import { pathToFileURL } from 'node:url'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

/**
 * Near-miss coverage around the seeded off-by-one bug. Several of these are EXPECTED to fail at
 * rest for the same reason fixture_01 does (the bug drops the last element for any non-empty
 * array) — that is honest, correct, and by design; see the file header. A few (empty array, an
 * all-zero array, and the mutation check) are expected to PASS regardless of the bug, and are
 * included specifically to show the bug's blind spots — inputs a naive test suite might use that
 * would never actually catch this class of defect.
 */
function nearMissCases(): CaseResult[] {
  const emptyResult = sumFixtureValues([])
  const oneElementResult = sumFixtureValues([5])
  const twoElementResult = sumFixtureValues([3, 4])
  const lastElementResult = sumFixtureValues([1, 2, 3, 4, 100])
  const negativeResult = sumFixtureValues([-1, -2, -3])
  const zeroResult = sumFixtureValues([0, 0, 0])
  const repeatedResult = sumFixtureValues([2, 2, 2, 2])
  const inputBeforeCall = [7, 8, 9]
  const inputSnapshot = [...inputBeforeCall]
  sumFixtureValues(inputBeforeCall)
  const inputUnmutated = JSON.stringify(inputBeforeCall) === JSON.stringify(inputSnapshot)

  return [
    check('fixture_02_empty_array_sums_to_zero', emptyResult === 0, `sumFixtureValues([]) = ${emptyResult}, expected 0`),
    check('fixture_03_single_element_included', oneElementResult === 5, `sumFixtureValues([5]) = ${oneElementResult}, expected 5 (bug drops the only element)`),
    check('fixture_04_two_elements_included', twoElementResult === 7, `sumFixtureValues([3,4]) = ${twoElementResult}, expected 7 (bug drops the 2nd element)`),
    check('fixture_05_last_of_five_elements_included', lastElementResult === 110, `sumFixtureValues([1,2,3,4,100]) = ${lastElementResult}, expected 110 (bug drops the trailing 100, not a general miscount)`),
    check('fixture_06_negative_values_included', negativeResult === -6, `sumFixtureValues([-1,-2,-3]) = ${negativeResult}, expected -6`),
    check('fixture_07_all_zero_array_is_a_bug_blind_spot', zeroResult === 0, `sumFixtureValues([0,0,0]) = ${zeroResult}, expected 0 (passes with or without the bug — illustrates why an all-zero test would never catch this defect)`),
    check('fixture_08_repeated_values_included', repeatedResult === 8, `sumFixtureValues([2,2,2,2]) = ${repeatedResult}, expected 8 (bug drops the last 2)`),
    check('fixture_09_input_array_never_mutated', inputUnmutated, `input before=${JSON.stringify(inputSnapshot)} after=${JSON.stringify(inputBeforeCall)} (true regardless of the seeded bug)`),
  ]
}

export function runKnownIssueFixtureValidation(): CaseResult[] {
  const result = sumFixtureValues([1, 2, 3, 4])
  return [
    check('fixture_01_sum_includes_last_element', result === 10, `sumFixtureValues([1,2,3,4]) = ${result}, expected 10`),
    ...nearMissCases(),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runKnownIssueFixtureValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Native builder fixture validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
