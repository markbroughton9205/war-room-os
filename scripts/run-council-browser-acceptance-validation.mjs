import { runCouncilBrowserAcceptanceFixtureValidation } from '../lib/council/nebula/browserAcceptance.validation.ts'

const results = runCouncilBrowserAcceptanceFixtureValidation()
for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail} [fixture]`)
}
const passCount = results.filter(result => result.pass).length
console.log(`\nCouncil browser acceptance (fixtures): ${passCount}/${results.length} PASS`)
console.log('Live Playwright/browser proof is separate and must not be claimed from this fixture suite.')
if (passCount !== results.length) process.exitCode = 1
