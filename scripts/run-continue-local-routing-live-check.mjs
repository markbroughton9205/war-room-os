import { runContinueLocalRoutingLiveCheck } from '../lib/council/nebula/continueLocalRouting.live-validation.ts'

const results = await runContinueLocalRoutingLiveCheck()
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail}`)
const passCount = results.filter(r => r.pass).length
console.log(`\nContinue local routing live check: ${passCount}/${results.length} PASS`)
if (passCount !== results.length) process.exitCode = 1
