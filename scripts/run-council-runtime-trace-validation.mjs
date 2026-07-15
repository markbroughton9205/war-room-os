import { runCouncilRuntimeTraceValidation } from '../lib/council/runtimeTraceValidation.ts'

const results = runCouncilRuntimeTraceValidation()
const failed = results.filter(result => !result.ok)

for (const result of results) {
  console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.caseId}: ${result.detail}`)
}

console.log(`Council runtime trace validation: ${results.length - failed.length}/${results.length} PASS`)

if (failed.length) {
  process.exitCode = 1
}
