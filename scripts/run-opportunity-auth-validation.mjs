import { runOpportunityAuthValidation } from '../lib/opportunity-agents/authValidation.ts'

const results = runOpportunityAuthValidation()
for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.id} ${result.detail}`)
const failed = results.filter(result => !result.pass)
console.log(`Opportunity Commander auth validation: ${results.length - failed.length}/${results.length} PASS`)
if (failed.length) process.exit(1)
