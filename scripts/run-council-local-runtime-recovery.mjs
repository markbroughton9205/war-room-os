import { runCouncilLocalRuntimeRecoveryValidation } from '../lib/native-builder/localModelArbiter.validation.ts'

const results = await runCouncilLocalRuntimeRecoveryValidation()
for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
}

const passCount = results.filter(result => result.pass).length
console.log(`\nCouncil local runtime recovery validation: ${passCount}/${results.length} PASS`)
if (passCount !== results.length) {
  process.exitCode = 1
}
