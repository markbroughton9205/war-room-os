import { runMemoryScopeAuthorizationValidation } from '../lib/memory/memoryScopeAuthorization.validation.ts'

const results = await runMemoryScopeAuthorizationValidation()
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail}`)
const passCount = results.filter(r => r.pass).length
console.log(`\nMemory scope authorization validation: ${passCount}/${results.length} PASS`)
if (passCount !== results.length) process.exitCode = 1
