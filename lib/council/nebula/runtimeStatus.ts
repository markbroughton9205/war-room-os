import type { ProviderFamilyOutcomeStatus } from '@/lib/council/providerIsolation'
import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { displayNameForSeat } from './identity'

/**
 * Canonical runtime-status grounding for War Room system questions.
 * Prioritize live facts over Commander/business memory.
 */

export type RuntimeStatusGroundingInput = {
  routingMode?: string | null
  localBackendAvailable?: boolean | null
  providerStates?: Partial<Record<CouncilOrchestrationFamily, ProviderFamilyOutcomeStatus | string>> | null
  extraFacts?: string[]
}

export function isWarRoomRuntimeStatusDecree(text: string): boolean {
  const raw = text.trim()
  if (!raw) return false
  return /(?:status\s+summary\s+of\s+(?:the\s+)?war\s*room|(?:war\s*room|runtime)\s+status|system\s+health|(?:give\s+me\s+(?:a\s+)?)?(?:short\s+)?status\s+summary)/i.test(raw)
    && !/\b(panama|freight|broughton|business\s+plan|relocation)\b/i.test(raw)
}

export function buildRuntimeStatusGroundingBlock(input: RuntimeStatusGroundingInput): string {
  const states = input.providerStates ?? {}
  const seatLines = Object.entries(states)
    .slice(0, 12)
    .map(([seat, status]) => {
      const identity = displayNameForSeat(seat as CouncilOrchestrationFamily, seat)
      return `- ${identity} (seat ${seat}): ${status}`
    })
  const facts = [
    input.routingMode ? `Council routing mode: ${input.routingMode}` : null,
    typeof input.localBackendAvailable === 'boolean'
      ? `Local Ollama reachable: ${input.localBackendAvailable ? 'yes' : 'no'}`
      : null,
    ...(input.extraFacts ?? []),
  ].filter(Boolean)
  return [
    'WAR ROOM LIVE RUNTIME FACTS (authoritative for this status question):',
    ...facts.map(line => `- ${line}`),
    seatLines.length ? 'Participating seat health:' : 'Participating seat health: not supplied.',
    ...seatLines,
    'Answer the requested War Room runtime-status task using these facts first.',
    'Do not substitute Commander profile, business memory, or relocation/freight context.',
    'If a fact is missing, say UNKNOWN — do not invent infrastructure.',
  ].join('\n')
}

export function buildRuntimeStatusSystemPrompt(
  label: string,
  roleShort: string,
  groundingBlock: string,
): string {
  return [
    `You are ${label} in Ra'el's War Room.`,
    `This decree is a War Room runtime/system status request. Role: ${roleShort}.`,
    'Respond with a short factual status summary of War Room itself.',
    groundingBlock,
    'Do not propose plans, strategies, missions, or locations.',
    "Do not mention Ra'el's profile, mission, or relocation goals.",
    'Stay role-distinct. Do not produce a Decision Summary.',
  ].join(' ')
}
