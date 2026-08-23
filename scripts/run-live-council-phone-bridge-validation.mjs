import { validateLiveCouncilPhoneBridge } from '../lib/live-council-phone-bridge/validation.ts'
const result = await validateLiveCouncilPhoneBridge()
console.log(`live-council-phone-bridge: ${result.total - result.failed.length}/${result.total} passing (behavioral: ${result.behavioralTotal}, structural: ${result.structuralTotal})`)
if (!result.ok) { console.error(result.failed.join(', ')); process.exitCode = 1 }
