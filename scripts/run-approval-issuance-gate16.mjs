import { runGate16ApprovalIssuanceValidation } from '../lib/council/approval-issuance/validation.ts'

const results = await runGate16ApprovalIssuanceValidation()
const failed = results.filter(result => result.result !== 'PASS')

for (const result of results) {
  console.log(`${result.result} ${result.caseId}: ${result.observed}`)
  for (const note of result.notes) {
    console.log(`  - ${note}`)
  }
}

console.log(`Gate 16 approval issuance: ${results.length - failed.length}/${results.length} PASS`)

if (failed.length) {
  process.exitCode = 1
}
