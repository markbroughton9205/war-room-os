import { runRoundStressValidation } from '../lib/council/hardening/roundSimulator.validation.ts'

const { results, batches } = runRoundStressValidation()
for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
}
console.log('')
for (const b of batches) {
  console.log(
    `Batch ${b.size}: totalMs=${b.totalMs} avgMsPerRound=${b.avgMsPerRound.toFixed(2)} `
    + `finalMessages=${b.finalMessageCount} clippedMessages=${b.clippedMessageCount}`,
  )
}

const passCount = results.filter(result => result.pass).length
console.log(`\nRound stress validation: ${passCount}/${results.length} PASS`)
if (passCount !== results.length) {
  process.exitCode = 1
}
