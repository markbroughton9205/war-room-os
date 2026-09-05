import { runCouncilLiveRoutingValidation } from '../lib/council/live-orchestration/backends/councilLiveRouting.validation.ts'

const results = await runCouncilLiveRoutingValidation()
for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
}

const passCount = results.filter(result => result.pass).length
console.log(`\nCouncil live routing validation: ${passCount}/${results.length} PASS`)
if (passCount !== results.length) {
  process.exitCode = 1
}
