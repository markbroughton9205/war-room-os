import { runConcurrentRoundsValidation } from '../lib/council/hardening/concurrentRounds.validation.ts'

const results = runConcurrentRoundsValidation()
for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
}

const passCount = results.filter(result => result.pass).length
console.log(`\nConcurrent rounds validation: ${passCount}/${results.length} PASS`)
if (passCount !== results.length) {
  process.exitCode = 1
}
