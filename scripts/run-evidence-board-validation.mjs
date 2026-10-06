import { runEvidenceBoardValidation } from '../lib/council/evidence-board/evidenceBoard.validation.ts'

const results = await runEvidenceBoardValidation()
const failed = results.filter(result => result.result !== 'PASS')

for (const result of results) {
  console.log(`${result.result} ${result.caseId}: ${result.description}`)
  if (result.result === 'FAIL') console.log(`  ${result.details}`)
}

console.log(`Evidence-Board Council validation: ${results.length - failed.length}/${results.length} PASS`)
if (failed.length) process.exitCode = 1
