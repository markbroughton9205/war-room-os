import { runOpportunitySourceValidation } from '../lib/opportunity-agents/sources/validation.ts'

const results = await runOpportunitySourceValidation()
for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.id} ${result.detail}`)
const failed = results.filter(result => !result.pass)
console.log(`Opportunity Source validation: ${results.length - failed.length}/${results.length} PASS`)
if (failed.length) process.exit(1)
