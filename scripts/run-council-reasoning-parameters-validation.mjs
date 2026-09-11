import { runCouncilReasoningParameterValidation } from '../lib/council/reasoning-parameters/validation.ts'

const results = runCouncilReasoningParameterValidation()
const failed = results.filter(item => !item.pass)
for (const item of results) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
}
console.log(`Council reasoning-parameter validation: ${results.length - failed.length}/${results.length} PASS`)
if (failed.length) process.exitCode = 1
