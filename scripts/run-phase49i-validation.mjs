import { runPhase49iValidation } from '../lib/opportunity-mission-bridge/phase49i.validation.ts'
const results = runPhase49iValidation()
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.id}: ${r.detail}`)
console.log(`\n${results.filter(r => r.pass).length}/${results.length} passed`)
if (results.some(r => !r.pass)) process.exitCode = 1
