import { runCouncilContinuityLiveProof } from '../lib/council/live-orchestration/councilContinuity.live-validation.ts'

const results = await runCouncilContinuityLiveProof()
for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
}

const passCount = results.filter(result => result.pass).length
console.log(`\nCouncil continuity live proof: ${passCount}/${results.length} PASS`)
if (passCount !== results.length) {
  process.exitCode = 1
}
