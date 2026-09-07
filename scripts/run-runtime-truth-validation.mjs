import { runOperationalClaimGuardValidation } from '../lib/council/runtimeTruth/operationalClaimGuard.validation.ts'

const results = runOperationalClaimGuardValidation()
for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
}
const passCount = results.filter(result => result.pass).length
console.log(`\nRuntime truth (operational claim guard) validation: ${passCount}/${results.length} PASS`)
if (passCount !== results.length) process.exitCode = 1
