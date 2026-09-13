import { runCouncilFullLiveFunctionValidation } from '../lib/council/live-orchestration/councilFullLiveFunction.validation.ts'

const results = await runCouncilFullLiveFunctionValidation()
for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
}

const passCount = results.filter(result => result.pass).length
console.log(`\nCouncil full-live function validation: ${passCount}/${results.length} PASS`)
if (passCount !== results.length) {
  process.exitCode = 1
}
