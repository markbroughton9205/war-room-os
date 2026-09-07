import { runTokenizerPipelineValidation } from '../lib/sovereign-model-lab/tokenizerPipeline.validation.ts'

const results = await runTokenizerPipelineValidation()
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail}`)
const passCount = results.filter(r => r.pass).length
console.log(`\nTokenizer pipeline validation: ${passCount}/${results.length} PASS`)
if (passCount !== results.length) process.exitCode = 1
