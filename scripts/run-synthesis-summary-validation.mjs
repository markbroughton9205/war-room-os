import { runSynthesisSummaryValidation } from '../lib/conversation-runtime/synthesisSummary.validation.ts'

const results = runSynthesisSummaryValidation()
for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
}

const passCount = results.filter(result => result.pass).length
console.log(`Synthesis summary validation: ${passCount}/${results.length} PASS`)
if (passCount !== results.length) {
  process.exitCode = 1
}
