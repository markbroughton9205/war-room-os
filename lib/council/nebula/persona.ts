import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { nebulaAgentForSeat, type NebulaAgentDefinition, type NebulaAgentId } from './identity'
import { NEBULA_ROLE_CONTRACTS } from './roleContracts'
import { assembleNebulaContext } from './contextAssembly'
import { auroraDegradedRoundNotice, type NebulaRoundHealth } from './round'

/**
 * Personality + role-contract wiring for Council system prompts.
 * Identity text only — never a model/provider claim.
 * Runtime-controlled identity/policy is assembled in contextAssembly.ts;
 * the model cannot choose to omit those blocks.
 */

export function nebulaPersonaForSeat(seat: CouncilOrchestrationFamily): NebulaAgentDefinition | null {
  return nebulaAgentForSeat(seat)
}

export function buildNebulaIdentityLine(agent: NebulaAgentDefinition): string {
  const contract = NEBULA_ROLE_CONTRACTS[agent.id]
  return `You are ${agent.name} in Ra'el's War Room. Permanent identity: ${agent.name}. Role: ${agent.role}. Optimization target: ${contract.optimizationTarget} Personality: ${agent.personality.join('; ')}.`
}

export function buildNebulaInteractionRule(agent: NebulaAgentDefinition): string {
  const contract = NEBULA_ROLE_CONTRACTS[agent.id]
  const methods = contract.preferredMethods.join(', ')
  const prohibited = agent.prohibitedMisrepresentation.join(' ')
  return `You are ${agent.name}: ${agent.role}. Do: ${contract.responsibilities.join('; ')}. Do not: ${contract.nonResponsibilities.join('; ')}. Methods: ${methods}. Stay concise; no actual execution. ${prohibited}`
}

export function buildNebulaInteractionRuleForSeat(
  seat: CouncilOrchestrationFamily,
  fallback: string,
): string {
  const agent = nebulaAgentForSeat(seat)
  return agent ? buildNebulaInteractionRule(agent) : fallback
}

export function buildNebulaStableGroupRole(agent: NebulaAgentDefinition): string {
  const contract = NEBULA_ROLE_CONTRACTS[agent.id]
  return `You are ${agent.name} — ${agent.personality[0] ?? agent.role}: ${contract.optimizationTarget} Stay role-distinct. Do not present yourself as a frontier brand.`
}

export function buildAuroraFinalSynthesisRole(health?: NebulaRoundHealth): string {
  const degraded = health ? auroraDegradedRoundNotice(health) : null
  const base = "You are AURORA — final Council synthesis (calibrated integration): one short, natural paragraph weaving what participating Nebula agents actually said; answer Ra'el's requested task first; expose disagreement; preserve uncertainty; no new topics; do not present yourself as ChatGPT or OpenAI; do not treat your own synthesis as evidence."
  return degraded ? `${base} ${degraded}` : base
}

export function buildNebulaRuntimeSystemPrompt(params: {
  agentId: NebulaAgentId
  mission?: string
  councilFindings?: readonly string[]
  backendNotes?: string
  extraPolicy?: string
}): string {
  return assembleNebulaContext({
    agentId: params.agentId,
    mission: params.mission,
    councilFindings: params.councilFindings,
    backendNotes: params.backendNotes,
    extraPolicy: params.extraPolicy,
  })
}
