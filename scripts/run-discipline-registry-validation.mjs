import { runDisciplineRegistryValidation } from '../lib/discipline/disciplineRegistryValidation.ts'

const results = runDisciplineRegistryValidation()
const failed = results.filter(result => !result.ok)

for (const result of results) {
  console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.caseId}: ${result.detail}`)
}

console.log(`Discipline registry validation: ${results.length - failed.length}/${results.length} PASS`)

if (failed.length) {
  process.exitCode = 1
}
