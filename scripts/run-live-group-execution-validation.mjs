import { runLiveGroupExecutionValidation } from '../lib/council/nebula/liveGroupExecution.validation.ts'
import { runLiveGroupExecutionLiveCheck } from '../lib/council/nebula/liveGroupExecution.live-validation.ts'

const results = [...runLiveGroupExecutionValidation(), ...await runLiveGroupExecutionLiveCheck()]
for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
}

const passCount = results.filter(result => result.pass).length
console.log(`\nLive Group execution validation: ${passCount}/${results.length} PASS`)
if (passCount !== results.length) {
  process.exitCode = 1
}
