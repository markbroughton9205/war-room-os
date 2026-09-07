import { runSessionBarrierValidation } from '../lib/council/sessionBarrier.validation.ts'

const results = runSessionBarrierValidation()
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} :: ${r.detail}`)
const passCount = results.filter(r => r.pass).length
console.log(`\nSession barrier / stale-decree validation: ${passCount}/${results.length} PASS`)
if (passCount !== results.length) process.exitCode = 1
