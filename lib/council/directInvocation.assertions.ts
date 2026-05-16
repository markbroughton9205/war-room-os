import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { parseCouncilCommand } from '@/lib/council/commandParser'

type DirectInvocationAssertion = {
  input: string
  targetFamilies: CouncilOrchestrationFamily[]
  dispatchedProviders: string[]
}

const PROVIDER_BY_FAMILY: Record<CouncilOrchestrationFamily, string> = {
  chatgpt: 'openai',
  claude: 'anthropic',
  grok: 'xai',
  gemini: 'google',
  red_team: 'internal',
  baby: 'war_room_native',
  kimi: 'moonshot',
  bridge_architect: 'local_bridge',
}

export const DIRECT_INVOCATION_ASSERTIONS: DirectInvocationAssertion[] = [
  { input: 'hey grok', targetFamilies: ['grok'], dispatchedProviders: ['xai'] },
  { input: 'hello chatgpt', targetFamilies: ['chatgpt'], dispatchedProviders: ['openai'] },
  { input: 'yo claude', targetFamilies: ['claude'], dispatchedProviders: ['anthropic'] },
  { input: 'where is gemini', targetFamilies: ['gemini'], dispatchedProviders: ['google'] },
]

export function assertDirectInvocationRoutingExamples(): void {
  for (const example of DIRECT_INVOCATION_ASSERTIONS) {
    const parsed = parseCouncilCommand(example.input)
    const providers = parsed.targetFamilies.map(family => PROVIDER_BY_FAMILY[family])
    if (
      !parsed.directInvocation
      || parsed.targetFamilies.join(',') !== example.targetFamilies.join(',')
      || providers.join(',') !== example.dispatchedProviders.join(',')
    ) {
      throw new Error(`Direct invocation assertion failed for: ${example.input}`)
    }
  }
}
