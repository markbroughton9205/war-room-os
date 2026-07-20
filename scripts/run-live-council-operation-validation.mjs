import { runLiveCouncilOperationValidation } from '../lib/council/unified-experience/live-validation.ts'

const results = runLiveCouncilOperationValidation()
const pass = results.filter(result => result.result === 'PASS').length

console.log(`Live Council operation validation: ${pass}/${results.length} PASS`)

for (const result of results) {
  if (result.result === 'FAIL') {
    console.error(`${result.caseId}: ${result.description}`)
    for (const detail of result.details) console.error(`  - ${detail}`)
  }
}

if (pass !== results.length) process.exitCode = 1
