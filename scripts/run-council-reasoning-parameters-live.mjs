import { runCouncilReasoningParameterLiveAcceptance } from '../lib/council/reasoning-parameters/live-acceptance.ts'

const { results } = await runCouncilReasoningParameterLiveAcceptance()
const failed = results.filter(item => !item.pass)
for (const item of results) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
}
console.log(`Council reasoning-parameter live acceptance: ${results.length - failed.length}/${results.length} PASS`)
if (failed.length) process.exitCode = 1
