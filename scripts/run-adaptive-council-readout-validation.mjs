import { runAdaptiveCouncilReadoutValidation } from '../lib/council/adaptive-assembly/shadowReadout.validation.ts'

const results = runAdaptiveCouncilReadoutValidation()
for (const result of results) {
  console.log(`${result.result} ${result.caseId}: ${result.description} (${result.observed})`)
  for (const detail of result.details) console.log(`  ${detail}`)
}

const passCount = results.filter(result => result.result === 'PASS').length
console.log(`Adaptive Council readout validation: ${passCount}/${results.length} PASS`)
if (passCount !== results.length) {
  process.exitCode = 1
}
