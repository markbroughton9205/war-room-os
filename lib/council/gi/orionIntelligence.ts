import { orionConsumeEnginePacket } from '@/lib/council/engines/integration/orion'
import { orionSelectTool, orionCompileContext } from '@/lib/council/engines/integration/executionRoles'

export type OrionHypothesis = {
  hypothesis: string
  symptom: string
  likely_cause: string
  probe: string
  falsify: string
}

export function orionConsumeEngines(
  input: Parameters<typeof orionConsumeEnginePacket>[0],
): ReturnType<typeof orionConsumeEnginePacket> & { hypotheses: OrionHypothesis[] } {
  return { ...orionConsumeEnginePacket(input), hypotheses: orionInvestigate(input.question) }
}

export { orionSelectTool, orionCompileContext }

export function orionInvestigate(text: string): OrionHypothesis[] {
  const raw = text.trim()
  if (/ram|memory/i.test(raw) && /war room|right now/i.test(raw)) {
    return [{
      hypothesis: 'Local runtime, not the remote model, accounts for RAM.',
      symptom: 'RAM appears high while inference is hosted.',
      likely_cause: 'UI, Broker, and local backends still run on-box.',
      probe: 'wr.ports.list / process RSS for next, broker, ollama',
      falsify: 'If those processes are idle and RSS is near zero, the hypothesis fails.',
    }]
  }
  if (/broke|down|incident|degraded/i.test(raw)) {
    return [{
      hypothesis: 'A local dependency failed, not a model opinion.',
      symptom: raw,
      likely_cause: 'Health/listener/backend probe will show which plane died.',
      probe: 'wr.core.health, wr.ui.health, wr.council.backend',
      falsify: 'If all three probes return 200, the outage is elsewhere.',
    }]
  }
  return [{
    hypothesis: `Investigate: ${raw.slice(0, 140)}`,
    symptom: raw.slice(0, 140),
    likely_cause: 'Unknown until a probe returns.',
    probe: 'Choose the cheapest probe that can falsify the leading hypothesis.',
    falsify: 'A successful contradictory probe withdraws the hypothesis. Do not narrate.',
  }]
}

export function orionProseIsInvalid(prose: string): boolean {
  return /i agree|building on what|as aurora said|dramatically/i.test(prose)
}
