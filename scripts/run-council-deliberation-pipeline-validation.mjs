import { runDeliberationPipelineValidation } from '../lib/council/family-deliberation/pipeline.validation.ts'

const results = runDeliberationPipelineValidation()
const failed = results.filter(result => !result.pass)

for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name}: ${result.detail}`)
}

console.log(`#16 deliberation pipeline validation: ${results.length - failed.length}/${results.length} PASS`)
if (failed.length) process.exitCode = 1
