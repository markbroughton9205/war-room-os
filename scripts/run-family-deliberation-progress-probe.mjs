import { runFamilyDeliberationProgressProbe } from '../lib/council/family-deliberation/validation.ts'

const probe = runFamilyDeliberationProgressProbe()
console.log(JSON.stringify(probe, null, 2))

const terminal = probe.requestStatus === 'closed'
const noWaiting = probe.missingTerminalFamilies.length === 0
const completed = probe.closeEventType === 'request_completed'
const familiesTerminal = probe.familyStates.every(row => row.lifecycle === 'terminal' && row.outcome)
if (!terminal || !noWaiting || !completed || !familiesTerminal) {
  process.exitCode = 1
}
