import { runOperationGroupKeyValidation } from '../lib/council/hardening/operationGroupKey.validation.ts'

const results = runOperationGroupKeyValidation()
for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
}

const passCount = results.filter(result => result.pass).length
console.log(`\nOperation group key validation: ${passCount}/${results.length} PASS`)
if (passCount !== results.length) {
  process.exitCode = 1
}
