import { runGapFinderReadinessValidation } from '../lib/operator/gapFinder.readiness.validation.ts'
import { runCanonicalStatusWiringValidation } from '../lib/operator/canonicalStatusWiring.validation.ts'
import { runFreshValidationValidation } from '../lib/operator/selfRepair/freshValidation.validation.ts'
import { runLegacyValidationDisplayValidation } from '../lib/operator/selfRepair/legacyValidationDisplay.validation.ts'
import { runRefreshMergeValidation } from '../lib/operator/selfRepair/refreshMerge.validation.ts'
import { runCanonicalOverrideSelectionValidation } from '../lib/operator/canonicalOverrideSelection.validation.ts'

// Self-Repair Validation Reliability, Phase 2 aggregate runner. Each suite below keeps its own
// standalone runner (run directly via `node --loader ./scripts/ts-extension-loader.mjs
// --experimental-transform-types <file>`); this file only imports and calls the same exported
// functions. No suite here reads sessionStorage, calls a live provider, or touches the network —
// every "refresh" in the fresh-validation suite is a caller-supplied in-memory mock.
const suites = [
  ['Workstream 1 — loading/unknown normalization', () => runGapFinderReadinessValidation()],
  ['Workstream 2 — canonical-status wiring', () => runCanonicalStatusWiringValidation()],
  ['Workstream 3 — fresh repair validation', () => runFreshValidationValidation()],
  ['Legacy validation display truthfulness', () => runLegacyValidationDisplayValidation()],
  ['Refresh merge field-specific readiness', () => runRefreshMergeValidation()],
  ['GapFinderPanel canonical override selection', () => runCanonicalOverrideSelectionValidation()],
]

let total = 0
let passed = 0
let failed = 0
let anySuiteFailed = false

for (const [name, run] of suites) {
  console.log(`\n== ${name} ==`)
  const results = await run()
  let suiteFailed = 0
  for (const result of results) {
    total += 1
    if (result.pass) {
      passed += 1
    } else {
      failed += 1
      suiteFailed += 1
    }
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  console.log(`-- ${name}: ${results.length - suiteFailed}/${results.length} PASS`)
  if (suiteFailed > 0) anySuiteFailed = true
}

console.log(`\nSelf-Repair Validation Reliability Phase 2: ${passed}/${total} PASS across ${suites.length} suites`)
if (anySuiteFailed || failed > 0) process.exit(1)
