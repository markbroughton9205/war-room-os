import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { streamCouncilFamily } from './streamProvider'

const CANARY_SYSTEM = 'You are a War Room Council-path canary. Reply with the single word OK. Do not mention any person, plan, or location.'
const CANARY_PROMPT = 'Council-path canary. Reply OK.'

export async function runCouncilPathCanary(family: CouncilOrchestrationFamily): Promise<{
  ok: boolean
  family: CouncilOrchestrationFamily
  firstDeltaAt?: number
  error?: string
  streamed: boolean
}> {
  const result = await streamCouncilFamily({
    family,
    system: CANARY_SYSTEM,
    prompt: CANARY_PROMPT,
    maxTokens: 8,
    timeoutKind: 'social',
    onDelta: () => undefined,
  })
  return {
    ok: result.ok && /ok/i.test(result.text),
    family,
    firstDeltaAt: result.firstDeltaAt,
    error: result.error,
    streamed: Boolean(result.firstDeltaAt != null || result.ok),
  }
}
