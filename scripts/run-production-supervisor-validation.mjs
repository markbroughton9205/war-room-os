/**
 * #18 production supervisor structural validation runner.
 * Does not touch live production :3000, cloudflared, Ollama, or Scheduled Tasks.
 */
import { runProductionSupervisorValidation } from '../lib/ops/production-supervisor/validation.ts'

const results = runProductionSupervisorValidation()
const failed = results.filter(r => !r.pass)

for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name}: ${result.detail}`)
}

console.log(`#18 production supervisor validation: ${results.length - failed.length}/${results.length} PASS`)
if (failed.length) process.exitCode = 1
