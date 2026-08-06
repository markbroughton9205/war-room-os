import { runUiTruthValidation } from '../lib/opportunity-agents/uiTruthValidation.ts'

const results = runUiTruthValidation()
for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.id} ${result.detail}`)
const failed = results.filter(result => !result.pass)
console.log(`UI truth validation: ${results.length - failed.length}/${results.length} PASS`)
if (failed.length) process.exit(1)
