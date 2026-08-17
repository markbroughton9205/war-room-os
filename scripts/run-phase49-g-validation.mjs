import { runPhase49GValidation } from '../lib/income-loot/phase49g.validation.ts'
const results=runPhase49GValidation()
for(const result of results)console.log(`${result.pass?'PASS':'FAIL'} ${result.id}: ${result.detail}`)
if(results.some(result=>!result.pass))process.exitCode=1
