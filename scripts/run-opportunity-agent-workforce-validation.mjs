import { runOpportunityAgentValidation } from '../lib/opportunity-agents/validation.ts'

const results = runOpportunityAgentValidation()
for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.id} ${result.detail}`)
}
const failed = results.filter(result => !result.pass)
console.log(`Opportunity Agent Workforce validation: ${results.length - failed.length}/${results.length} PASS`)
if (failed.length > 0) process.exit(1)
