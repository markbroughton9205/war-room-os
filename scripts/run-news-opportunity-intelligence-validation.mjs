import { runNewsOpportunityIntelligenceValidation } from '../lib/news-opportunity-intelligence/validation.ts'

const results = await runNewsOpportunityIntelligenceValidation()
for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.id} ${result.detail}`)
const failed = results.filter(result => !result.pass)
console.log(`News Opportunity Intelligence validation: ${results.length - failed.length}/${results.length} PASS`)
if (failed.length) process.exit(1)
