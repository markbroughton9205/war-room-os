import { runCouncilSessionIntelligenceValidation } from '../lib/council/session-intelligence/validation.ts'

const results = runCouncilSessionIntelligenceValidation()
const failed = results.filter(result => !result.pass)

for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name}: ${result.detail}`)
}

console.log(`#17 council session intelligence validation: ${results.length - failed.length}/${results.length} PASS`)
if (failed.length) process.exitCode = 1
