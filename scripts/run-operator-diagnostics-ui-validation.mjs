import { runOperatorDiagnosticsUiValidation } from '../lib/war-room/operatorDiagnosticsUi.validation.ts'

const results = runOperatorDiagnosticsUiValidation()
for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
}

const passCount = results.filter(result => result.pass).length
console.log(`Operator diagnostics UI validation: ${passCount}/${results.length} PASS`)
if (passCount !== results.length) {
  process.exitCode = 1
}
