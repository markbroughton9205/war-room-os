import { runCouncilGeneralLocalActivationValidation } from '../lib/council/live-orchestration/backends/councilGeneralLocalActivation.validation.ts'

const results = await runCouncilGeneralLocalActivationValidation()
for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
}

const passCount = results.filter(result => result.pass).length
console.log(`\nCouncil GENERAL local activation validation: ${passCount}/${results.length} PASS`)
if (passCount !== results.length) {
  process.exitCode = 1
}
