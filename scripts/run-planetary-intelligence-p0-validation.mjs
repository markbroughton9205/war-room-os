import { runPlanetaryIntelligenceP0Validation } from '../lib/planetary-intelligence/planetaryIntelligence.validation.ts'

const results = await runPlanetaryIntelligenceP0Validation()
const failed = results.filter(result => !result.pass)

for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} [${result.proof}] ${result.detail}`)
}

console.log(`Planetary Intelligence P0 validation: ${results.length - failed.length}/${results.length} PASS`)

if (failed.length) {
  process.exitCode = 1
}
