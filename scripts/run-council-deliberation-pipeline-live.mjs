import { runDeliberationPipelineLiveAcceptance } from '../lib/council/family-deliberation/live-acceptance.ts'
import { mkdirSync, writeFileSync } from 'node:fs'

const { results, proof } = await runDeliberationPipelineLiveAcceptance()
mkdirSync('work/build16', { recursive: true })
writeFileSync('work/build16/deliberation-pipeline-live.json', JSON.stringify({ results, proof }, null, 2))
const failed = results.filter(item => !item.pass)
for (const item of results) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
}
console.log(`#16 deliberation pipeline live acceptance: ${results.length - failed.length}/${results.length} PASS`)
if (failed.length) process.exitCode = 1
