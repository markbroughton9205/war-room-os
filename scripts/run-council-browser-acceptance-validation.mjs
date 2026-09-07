import { runCouncilBrowserAcceptanceFixtureValidation } from '../lib/council/nebula/browserAcceptance.validation.ts'

const results = runCouncilBrowserAcceptanceFixtureValidation()
for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail} [fixture]`)
}
const passCount = results.filter(result => result.pass).length
console.log(`\nFIXTURE ACCEPTANCE (not a browser test — no page was ever opened): ${passCount}/${results.length} PASS`)
console.log('For REAL BROWSER ACCEPTANCE proof, run: pnpm run validate:council-browser-live')
if (passCount !== results.length) process.exitCode = 1
