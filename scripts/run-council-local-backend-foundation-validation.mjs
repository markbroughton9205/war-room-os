import { runCouncilLocalBackendFoundationValidation } from '../lib/council/live-orchestration/backends/localBackendFoundation.validation.ts'

const results = await runCouncilLocalBackendFoundationValidation()
for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
}

const passCount = results.filter(result => result.pass).length
console.log(`\nCouncil local backend foundation validation: ${passCount}/${results.length} PASS`)
if (passCount !== results.length) {
  process.exitCode = 1
}
