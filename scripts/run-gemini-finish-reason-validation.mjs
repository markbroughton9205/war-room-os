import { runGeminiFinishReasonValidation } from '../lib/council/live-orchestration/adapters/geminiFinishReason.validation.ts'

const results = await runGeminiFinishReasonValidation()
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail}`)
const passCount = results.filter(r => r.pass).length
console.log(`\nGemini finishReason validation: ${passCount}/${results.length} PASS`)
if (passCount !== results.length) process.exitCode = 1
