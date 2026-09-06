import { runCouncilNaturalPresentationValidation } from '../lib/council/nebula/streamingRuntime.validation.ts'

const results = runCouncilNaturalPresentationValidation()
for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
}
const passCount = results.filter(result => result.pass).length
console.log(`\nCouncil natural presentation validation: ${passCount}/${results.length} PASS`)
if (passCount !== results.length) process.exitCode = 1
