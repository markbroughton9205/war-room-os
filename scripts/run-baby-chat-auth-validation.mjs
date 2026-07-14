import { runBabyChatAuthorizationHardeningValidation } from '../lib/baby-ai/privateChatRouteValidation.ts'

const results = await runBabyChatAuthorizationHardeningValidation()
const failed = results.filter(result => result.result !== 'PASS')

for (const result of results) {
  console.log(`${result.result} ${result.caseId}: ${result.observed}`)
  for (const note of result.notes) {
    console.log(`  - ${note}`)
  }
}

console.log(`Baby chat authorization hardening: ${results.length - failed.length}/${results.length} PASS`)

if (failed.length) {
  process.exitCode = 1
}
