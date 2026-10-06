import { runPlanetaryIntelligenceP0LiveAcceptance } from '../lib/planetary-intelligence/liveAcceptance.ts'

const { classification, report } = await runPlanetaryIntelligenceP0LiveAcceptance()

console.log('# WAR ROOM PLANETARY P0 LIVE TRUTH-HARDENING REPORT')
for (let i = 1; i <= 41; i += 1) {
  console.log(`\n${i}.`)
  console.log(typeof report[i] === 'string' ? report[i] : JSON.stringify(report[i], null, 2))
}
console.log('\nQUERY_LANGUAGE_PROOF')
console.log(JSON.stringify(report[3], null, 2))
console.log('\nENGLISH_FALLBACK_TASK_IDS')
console.log(JSON.stringify(report.englishFallbackTaskIds, null, 2))
console.log('\nLIVE_TRACES')
console.log(JSON.stringify(report.traces, null, 2))
console.log('\nFIXTURE_VS_LIVE_LABELS')
console.log(JSON.stringify(report.fixtureReminder, null, 2))
console.log('\nPERSIST')
console.log(JSON.stringify(report.persist, null, 2))
console.log(`\nFINAL CLASSIFICATION:\n${classification}`)
