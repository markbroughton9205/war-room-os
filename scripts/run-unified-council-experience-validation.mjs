import { runUnifiedCouncilExperienceValidation } from '../lib/council/unified-experience/validation.ts'

const results = runUnifiedCouncilExperienceValidation()
for (const result of results) {
  console.log(`${result.result} ${result.caseId}: ${result.description} (${result.observed})`)
  for (const detail of result.details) console.log(`  ${detail}`)
}

const passCount = results.filter(result => result.result === 'PASS').length
console.log(`Unified Council experience validation: ${passCount}/${results.length} PASS`)
if (passCount !== results.length) {
  process.exitCode = 1
}

