import { runCouncilRenderGateValidation } from '../lib/council/councilRenderGate.validation.ts'

const results = runCouncilRenderGateValidation()
for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
}

const passCount = results.filter(result => result.pass).length
console.log(`Council render gate validation: ${passCount}/${results.length} PASS`)
if (passCount !== results.length) {
  process.exitCode = 1
}
