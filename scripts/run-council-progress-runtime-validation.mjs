import { runCouncilProgressRuntimeValidation } from '../lib/council/progress-events/runtimeValidation.ts'

const results = runCouncilProgressRuntimeValidation()
const failed = results.filter(result => result.result !== 'PASS')

for (const result of results) {
  console.log(`${result.result} ${result.caseId}: ${result.description} (${result.observed})`)
  if (result.result === 'FAIL') {
    for (const detail of result.details) console.log(`  ${detail}`)
  }
}

console.log(`Council progress-runtime validation: ${results.length - failed.length}/${results.length} PASS`)

if (failed.length) {
  process.exitCode = 1
}
