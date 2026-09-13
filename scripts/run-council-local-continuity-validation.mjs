import { runCouncilLocalContinuityValidation } from '../lib/council/live-orchestration/councilContinuity.validation.ts'

const results = await runCouncilLocalContinuityValidation()
for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
}

const passCount = results.filter(result => result.pass).length
console.log(`\nCouncil local continuity validation: ${passCount}/${results.length} PASS`)
if (passCount !== results.length) {
  process.exitCode = 1
}
