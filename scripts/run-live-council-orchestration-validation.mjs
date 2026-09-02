import { runLiveCouncilOrchestrationValidation } from '../lib/council/live-orchestration/validation.ts'

const results = runLiveCouncilOrchestrationValidation()
const failed = results.filter(r => !r.pass)
for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
}
console.log(`Live council orchestration validation: ${results.length - failed.length}/${results.length} PASS`)
if (failed.length) process.exit(1)
