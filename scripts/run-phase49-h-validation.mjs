import { runPhase49HValidation } from '../lib/income-loot/phase49h.validation.ts'
const results=await runPhase49HValidation()
for(const result of results)console.log(`${result.pass?'PASS':'FAIL'} ${result.id}: ${result.detail}`)
if(results.some(result=>!result.pass))process.exitCode=1
