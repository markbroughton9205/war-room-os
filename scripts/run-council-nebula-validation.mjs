import { runNebulaValidation } from '../lib/council/nebula/validation.ts'
import { runNebulaSharedBrainLiveCheck } from '../lib/council/nebula/sharedBrain.live-validation.ts'

const results = [...await runNebulaValidation(), ...await runNebulaSharedBrainLiveCheck()]
for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
}

const passCount = results.filter(result => result.pass).length
console.log(`\nNebula Council validation: ${passCount}/${results.length} PASS`)
if (passCount !== results.length) {
  process.exitCode = 1
}
