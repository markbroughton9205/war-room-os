import { runEarthIntelligenceValidation } from '../lib/earth-intelligence/validation.ts'

const results = runEarthIntelligenceValidation()
const failed = results.filter(result => !result.pass)

for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.id}: ${result.detail}`)
}

console.log(`Earth Intelligence validation: ${results.length - failed.length}/${results.length} PASS`)

if (failed.length) {
  process.exitCode = 1
}
