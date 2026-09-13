import { runCouncilIdentityRestorationValidation } from '../lib/council/nebula/identityRestoration.validation.ts'
import { runCouncilIdentityRestorationLiveProof } from '../lib/council/nebula/identityRestoration.live-validation.ts'

const results = [
  ...runCouncilIdentityRestorationValidation(),
  ...await runCouncilIdentityRestorationLiveProof(),
]
for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
}

const passCount = results.filter(result => result.pass).length
console.log(`\nCouncil identity restoration validation: ${passCount}/${results.length} PASS`)
if (passCount !== results.length) {
  process.exitCode = 1
}
