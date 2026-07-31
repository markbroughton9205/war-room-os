import { runOperationSummaryValidation } from '../lib/council/unified-experience/operationSummary.validation.ts'

const results = runOperationSummaryValidation()
for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
}

const passCount = results.filter(result => result.pass).length
console.log(`Operation summary validation: ${passCount}/${results.length} PASS`)
if (passCount !== results.length) {
  process.exitCode = 1
}
