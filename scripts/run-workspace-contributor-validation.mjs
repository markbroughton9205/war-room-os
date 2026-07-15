import { runWorkspaceContributorValidation } from '../lib/workspace-contributor/validation.ts'

const results = await runWorkspaceContributorValidation()
for (const result of results) {
  console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.caseId}: ${result.observed}`)
  for (const note of result.notes) console.log(`  - ${note}`)
}

const passed = results.filter(result => result.passed).length
console.log(`Workspace contributor validation: ${passed}/${results.length} PASS`)
if (passed !== results.length) process.exit(1)
