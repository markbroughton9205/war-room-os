import { runCouncilDocumentScanValidation } from '../lib/documents/councilDocumentScan.validation.ts'

const results = runCouncilDocumentScanValidation()
for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.id} ${result.detail}`)
const failed = results.filter(result => !result.pass)
console.log(`Council document scan validation: ${results.length - failed.length}/${results.length} PASS`)
if (failed.length) process.exit(1)
