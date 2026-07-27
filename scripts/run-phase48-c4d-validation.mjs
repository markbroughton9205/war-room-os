import { runAttendanceReleaseValidation } from '../lib/council/attendanceRelease.validation.ts'
import { runContextRelevanceValidation } from '../lib/council/contextRelevance.validation.ts'
import { runFamilyOperationStatusValidation } from '../lib/council/familyOperationStatus.validation.ts'
import { runIntentScopeValidation } from '../lib/council/intentScope.validation.ts'
import { runLiveResponseExtractionValidation } from '../lib/council/liveResponseExtraction.validation.ts'
import { runRetryOrchestrationValidation } from '../lib/providers/retryOrchestration.validation.ts'

// Phase 48-C4D aggregate runner. Each suite below keeps its own standalone runner script
// (scripts/run-<suite>-validation.mjs) working unchanged; this file only imports and calls the
// same exported functions those scripts call, so there is exactly one implementation of each
// suite. No suite here calls a live provider or touches the network — every provider invocation
// inside these suites goes through a caller-supplied in-memory mock (`InvokeProviderFn`), never
// a real fetch. No file or runtime state is mutated beyond process.env flags the suites
// themselves set and restore.
const suites = [
  ['Attendance late-release integrity', () => runAttendanceReleaseValidation()],
  ['Decree-context relevance filtering', () => runContextRelevanceValidation()],
  ['Family operation-status projection (incl. status-sync regression)', () => runFamilyOperationStatusValidation()],
  ['Intent-scope regression protection', () => runIntentScopeValidation()],
  ['Live Council response extraction', () => runLiveResponseExtractionValidation()],
  ['Provider retry orchestration (incl. retry-budget verification)', () => runRetryOrchestrationValidation()],
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

console.log(`\nPhase 48-C4D validation: ${passed}/${total} PASS across ${suites.length} suites`)
if (anySuiteFailed || failed > 0) process.exit(1)
