import { runPasswordRecoveryValidation } from '../lib/auth/recoveryValidation.ts'

const results = await runPasswordRecoveryValidation()
for (const result of results) {
  const status = result.passed ? 'PASS' : 'FAIL'
  console.log(`${status} ${result.caseId}: ${result.observed}`)
  for (const note of result.notes) {
    console.log(`  - ${note}`)
  }
}

const passed = results.filter(result => result.passed).length
console.log(`Password recovery validation: ${passed}/${results.length} PASS`)

if (passed !== results.length) {
  process.exit(1)
}
