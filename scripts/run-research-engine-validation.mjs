import { runResearchEngineValidation } from '../lib/research-engine/diagnostics/validation.ts'

const results = await runResearchEngineValidation()
const failed = results.filter(result => !result.pass)

for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.id}: ${result.detail}`)
}

console.log(`Research Engine validation: ${results.length - failed.length}/${results.length} PASS`)

if (failed.length) {
  process.exitCode = 1
}
