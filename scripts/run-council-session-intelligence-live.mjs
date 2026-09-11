import { mkdirSync, writeFileSync } from 'node:fs'
import { runCouncilSessionIntelligenceLiveAcceptance } from '../lib/council/session-intelligence/live-acceptance.ts'

const { results, proof } = await runCouncilSessionIntelligenceLiveAcceptance()
const failed = results.filter(result => !result.pass)

mkdirSync('work/build17', { recursive: true })
writeFileSync('work/build17/session-intelligence-live.json', JSON.stringify({ results, proof }, null, 2))

for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name}: ${result.detail}`)
}

console.log(`#17 council session intelligence live: ${results.length - failed.length}/${results.length} PASS`)
if (failed.length) process.exitCode = 1
