import { runGiEng03Unit, runGiEng03Integration } from '../lib/council/gi/gi.eng03.validation.ts'
import { runGiEng03Live } from '../lib/council/gi/gi.eng03.live.ts'

const unit = runGiEng03Unit()
const integration = await runGiEng03Integration()
let liveCases = []
let liveSummary = null
try {
  const live = await runGiEng03Live()
  liveCases = live.cases
  liveSummary = live.summary
} catch (error) {
  liveCases = [{
    lane: 'LIVE',
    caseId: 'LIVE-CRASH',
    description: 'live harness crashed',
    result: 'FAIL',
    details: error instanceof Error ? error.message : String(error),
  }]
}

const all = [...unit, ...integration, ...liveCases]
for (const row of all) {
  console.log(`${row.result} ${row.lane} ${row.caseId}: ${row.description}`)
  if (row.result === 'FAIL') console.log(`  ${row.details}`)
}

const byLane = lane => {
  const rows = all.filter(row => row.lane === lane)
  const pass = rows.filter(row => row.result === 'PASS').length
  const skip = rows.filter(row => row.result === 'SKIP').length
  return `${pass}/${rows.length} PASS${skip ? ` (${skip} SKIP)` : ''}`
}

const failed = all.filter(row => row.result === 'FAIL')
console.log(`GI-ENG-03 UNIT: ${byLane('UNIT')}`)
console.log(`GI-ENG-03 INTEGRATION: ${byLane('INTEGRATION')}`)
console.log(`GI-ENG-03 LIVE: ${byLane('LIVE')}`)
if (liveSummary) {
  console.log(`GI-ENG-03 LIVE SUMMARY: ${JSON.stringify({
    available: liveSummary.live_available,
    placement: liveSummary.placement,
    family: liveSummary.family,
    local_model: liveSummary.local_model,
    p50: liveSummary.p50,
    p95: liveSummary.p95,
    proposed_gate_ms: liveSummary.proposed_gate_ms,
    n: liveSummary.latencies.length,
  })}`)
}
console.log(`GI-ENG-03 validation: ${all.length - failed.length}/${all.length} PASS`)
process.exit(failed.length ? 1 : 0)
