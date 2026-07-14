import { runSignupInvitationValidation } from '../lib/signup-invitations/validation.ts'

const results = await runSignupInvitationValidation()
for (const result of results) {
  const status = result.passed ? 'PASS' : 'FAIL'
  console.log(`${status} ${result.caseId}: ${result.observed}`)
  for (const note of result.notes) {
    console.log(`  - ${note}`)
  }
}

const passed = results.filter(result => result.passed).length
console.log(`Signup invitation validation: ${passed}/${results.length} PASS`)

if (passed !== results.length) {
  process.exit(1)
}
