import { runCommanderApprovalRoutesValidation } from '../lib/sovereign-model-lab/commanderApprovalRoutes.validation.ts'

const results = runCommanderApprovalRoutesValidation()
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail}`)
const passCount = results.filter(r => r.pass).length
console.log(`\nSovereign Model Lab Commander approval routes validation: ${passCount}/${results.length} PASS`)
if (passCount !== results.length) process.exitCode = 1
