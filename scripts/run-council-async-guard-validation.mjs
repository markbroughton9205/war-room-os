import { runCouncilAsyncGuardValidation } from '../lib/conversation-runtime/asyncGuards.validation.ts'

const results = runCouncilAsyncGuardValidation()
for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
}

const passCount = results.filter(result => result.pass).length
console.log(`\nCouncil async guard validation: ${passCount}/${results.length} PASS`)
if (passCount !== results.length) {
  process.exitCode = 1
}
