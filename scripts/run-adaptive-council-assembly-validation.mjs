import { runAdaptiveCouncilAssemblyValidation } from '../lib/council/adaptive-assembly/validation.ts'

const results = runAdaptiveCouncilAssemblyValidation()
const failed = results.filter(result => result.result !== 'PASS')

for (const result of results) {
  console.log(`${result.result} ${result.caseId}: ${result.description} (${result.observed})`)
  if (result.result === 'FAIL') {
    for (const detail of result.details) console.log(`  ${detail}`)
  }
}

console.log(`Adaptive Council assembly validation: ${results.length - failed.length}/${results.length} PASS`)

if (failed.length) {
  process.exitCode = 1
}

