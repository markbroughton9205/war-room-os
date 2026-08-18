import { runOpportunityReadinessValidation, runOpportunityReadinessAsyncValidation } from '../lib/opportunity-readiness/validation.ts'
const syncResults = runOpportunityReadinessValidation()
const asyncResults = await runOpportunityReadinessAsyncValidation()
const results = [...syncResults, ...asyncResults]
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.id}: ${r.detail}`)
if (results.some(r => !r.pass)) process.exitCode = 1
