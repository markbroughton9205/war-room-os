import { runGiEng01Validation } from '../lib/council/gi/gi.validation.ts'
import { runWrGaFixtures } from '../tests/gi/wr-ga/harness.ts'

const results = await runGiEng01Validation()
const fixtures = await runWrGaFixtures()
const failed = results.filter(result => result.result !== 'PASS')
const fixtureFailed = fixtures.filter(row => !row.pass)

for (const result of results) {
  console.log(`${result.result} ${result.caseId}: ${result.description}`)
  if (result.result === 'FAIL') console.log(`  ${result.details}`)
}

for (const fixture of fixtures) {
  console.log(`${fixture.pass ? 'PASS' : 'FAIL'} ${fixture.id}`)
}

console.log(`GI-ENG-01 validation: ${results.length - failed.length}/${results.length} PASS`)
console.log(`WR-GA fixtures: ${fixtures.length - fixtureFailed.length}/${fixtures.length} PASS`)
if (failed.length || fixtureFailed.length) process.exitCode = 1
