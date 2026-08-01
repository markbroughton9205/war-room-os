import { runInterruptedProviderCallsValidation } from '../lib/council/hardening/interruptedProviderCalls.validation.ts'

const results = await runInterruptedProviderCallsValidation()
for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
}

const passCount = results.filter(result => result.pass).length
console.log(`\nInterrupted provider calls validation: ${passCount}/${results.length} PASS`)
if (passCount !== results.length) {
  process.exitCode = 1
}
