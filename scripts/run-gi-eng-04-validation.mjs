import { runGiEng04Unit } from '../lib/council/gi/gi.eng04.validation.ts'

const unit = runGiEng04Unit()
for (const row of unit) {
  console.log(`${row.result} ${row.lane} ${row.caseId}: ${row.description}`)
  if (row.result === 'FAIL') console.log(`  ${row.details}`)
}
const failed = unit.filter(row => row.result === 'FAIL')
console.log(`GI-ENG-04 UNIT: ${unit.length - failed.length}/${unit.length} PASS`)
process.exit(failed.length ? 1 : 0)
