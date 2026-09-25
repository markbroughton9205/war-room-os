/**
 * Provider-down is not a capability failure.
 * Pure classification only. Does not start Ollama or call a model.
 */
import { classifyUnselectedLocalWorker } from './foundryEngineeringSpecialist'

const cases: { name: string; pass: boolean; detail: string }[] = []
const check = (name: string, pass: boolean, detail: string) => {
  cases.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${detail}`)
}

const down = classifyUnselectedLocalWorker({ outcome: 'BLOCKED_CAPABILITY', localOnly: true, providerReachable: false, modelInstalled: false })
check('provider_down', down === 'PROVIDER_UNAVAILABLE', down)

const installed = classifyUnselectedLocalWorker({ outcome: 'BLOCKED_CAPABILITY', localOnly: true, providerReachable: true, modelInstalled: true })
check('provider_up_model_installed_still_capability', installed === 'CAPABILITY_FAILURE', installed)

const absent = classifyUnselectedLocalWorker({ outcome: 'BLOCKED_CAPABILITY', localOnly: true, providerReachable: true, modelInstalled: false })
check('model_absent', absent === 'PROVIDER_UNAVAILABLE', absent)

const policy = classifyUnselectedLocalWorker({ outcome: 'BLOCKED_COMMANDER', localOnly: true, providerReachable: true, modelInstalled: true })
check('policy_denied', policy === 'POLICY_BLOCK', policy)

const resource = classifyUnselectedLocalWorker({ outcome: 'BLOCKED_RESOURCE', localOnly: true, providerReachable: false, modelInstalled: false })
check('resource_block', resource === 'RESOURCE_BLOCK', resource)

const remote = classifyUnselectedLocalWorker({ outcome: 'BLOCKED_CAPABILITY', localOnly: false, providerReachable: false, modelInstalled: false })
check('remote_policy_not_relabeled', remote === 'CAPABILITY_FAILURE', remote)

const blockedProvider = classifyUnselectedLocalWorker({ outcome: 'BLOCKED_PROVIDER', localOnly: false, providerReachable: true, modelInstalled: true })
check('blocked_provider', blockedProvider === 'PROVIDER_UNAVAILABLE', blockedProvider)

const failed = cases.filter(item => !item.pass)
console.log(JSON.stringify({ pass: failed.length === 0, total: cases.length, failed: failed.map(item => item.name) }))
if (failed.length) process.exit(1)
