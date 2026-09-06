import { runCouncilOllamaStreamingLiveProof } from '../lib/council/nebula/ollamaStreaming.live-validation.ts'

const results = await runCouncilOllamaStreamingLiveProof()
for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ttft=${result.ttftMs} tps=${result.tokensPerSecond} total=${result.totalMs} ${result.detail}`)
}
const passCount = results.filter(result => result.pass).length
console.log(`\nCouncil Ollama streaming live proof: ${passCount}/${results.length} PASS`)
if (passCount !== results.length) process.exitCode = 1
