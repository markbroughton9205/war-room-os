import { runTranscriptReconciliationValidation } from '../lib/conversation-runtime/transcriptReconciliation.validation.ts'

const results = runTranscriptReconciliationValidation()
for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
}

const passCount = results.filter(result => result.pass).length
console.log(`Transcript reconciliation validation: ${passCount}/${results.length} PASS`)
if (passCount !== results.length) {
  process.exitCode = 1
}
