import { runGiEng02Validation } from '../lib/council/gi/gi.eng02.validation.ts'

const results = await runGiEng02Validation()
const failed = results.filter(result => result.result !== 'PASS')

for (const result of results) {
  console.log(`${result.result} ${result.caseId}: ${result.description}`)
  if (result.result === 'FAIL') console.log(`  ${result.details}`)
}

console.log(`GI-ENG-02 validation: ${results.length - failed.length}/${results.length} PASS`)
if (failed.length) process.exitCode = 1
