import { MEMORY_AUTHORITY_VALIDATION_MODE, runMemoryAuthorityValidation } from '../lib/memory-authority/validation.ts'

const results = runMemoryAuthorityValidation()
console.log(`Memory authority validation mode: ${MEMORY_AUTHORITY_VALIDATION_MODE}`)
for (const row of results) {
  const detail = row.result === 'PASS' ? row.observed : `${row.observed} (expected: ${row.expected})`
  console.log(`${row.result} ${row.caseId}: ${detail}`)
}

const failed = results.filter(row => row.result !== 'PASS')
console.log(`Memory authority static validation: ${results.length - failed.length}/${results.length} PASS`)
if (failed.length) process.exit(1)
