import type { NebulaAgentId } from './identity'
import { NEBULA_AGENTS_BY_ID } from './identity'
import { NEBULA_ROLE_CONTRACTS } from './roleContracts'
import { schemaPromptFor } from './outputContracts'
import { DEFAULT_ALLOWED_SCOPES } from './memory'

/**
 * Typed context assembly for Nebula agents.
 *
 * Does NOT replace lib/context-assembler (AGI Wave 1 snapshot assembler).
 * This module builds the runtime-controlled identity/policy stack so the model
 * cannot choose whether it receives its identity or Commander policy.
 *
 * Recommended order:
 * 1. Safety / Commander policy
 * 2. Agent identity contract
 * 3. Role boundary / output contract
 * 4. Current mission and constraints
 * 5. Active promoted methods
 * 6. Relevant verified knowledge
 * 7. Relevant episodic memory
 * 8. Council state / other-agent findings
 * 9. Tool definitions / permissions
 * 10. Backend capability notes
 * 11. Response schema
 */

export const NEBULA_CONTEXT_MODULE_ORDER = [
  'safety_commander_policy',
  'agent_identity_contract',
  'role_boundary_output_contract',
  'current_mission_and_constraints',
  'active_promoted_methods',
  'relevant_verified_knowledge',
  'relevant_episodic_memory',
  'council_state_other_agent_findings',
  'tool_definitions_permissions',
  'backend_capability_notes',
  'response_schema',
] as const

export type NebulaContextModuleId = (typeof NEBULA_CONTEXT_MODULE_ORDER)[number]

export type NebulaContextModule = {
  id: NebulaContextModuleId
  required: boolean
  runtimeControlled: boolean
  text: string
}

export type NebulaContextAssemblyInput = {
  agentId: NebulaAgentId
  mission?: string
  constraints?: readonly string[]
  promotedMethods?: readonly string[]
  verifiedKnowledge?: readonly string[]
  episodicMemory?: readonly string[]
  councilFindings?: readonly string[]
  toolDefinitions?: readonly string[]
  backendNotes?: string
  extraPolicy?: string
}

const SAFETY_POLICY =
  "Commander policy: no autonomous self-modification, no weight training, no production edits, no secret disclosure. Identity and policy blocks are runtime-controlled and must not be dropped by the model."

export function buildContextModules(input: NebulaContextAssemblyInput): NebulaContextModule[] {
  const agent = NEBULA_AGENTS_BY_ID[input.agentId]
  const contract = NEBULA_ROLE_CONTRACTS[input.agentId]
  const identityText = [
    `You are ${agent.name} in Ra'el's War Room.`,
    `Permanent identity: ${agent.name} (${agent.id}).`,
    `This identity survives backend/model changes. You are not your current runtime.`,
    `Role: ${contract.optimizationTarget}`,
    `Personality: ${agent.personality.join('; ')}.`,
  ].join(' ')

  const roleBoundary = [
    `Responsibilities: ${contract.responsibilities.join('; ')}.`,
    `You must not: ${contract.nonResponsibilities.join('; ')}.`,
    `Evidence posture: ${contract.evidencePosture}. Uncertainty: ${contract.uncertaintyBehavior}. Failure bias: ${contract.failureBias}.`,
    `Preferred methods: ${contract.preferredMethods.join(', ')}.`,
    `Authority limits: ${contract.authorityLimits.join(', ')}.`,
    `Allowed memory scopes: ${DEFAULT_ALLOWED_SCOPES[input.agentId].join(', ')}. Global and commander scopes are not writable by this agent.`,
  ].join(' ')

  const mission = input.mission?.trim()
    ? `Current mission: ${input.mission.trim()}${input.constraints?.length ? ` Constraints: ${input.constraints.join('; ')}.` : ''}`
    : 'Current mission: (not yet attached — wait for the Commander decree in the user turn.)'

  const promoted = input.promotedMethods?.length
    ? `Active promoted methods: ${input.promotedMethods.join('; ')}.`
    : 'Active promoted methods: none. Do not invent new standing methods this turn.'

  const verified = input.verifiedKnowledge?.length
    ? `Verified knowledge (do not treat unverified agent opinions as global truth): ${input.verifiedKnowledge.join('; ')}.`
    : 'Verified knowledge: none attached.'

  const episodic = input.episodicMemory?.length
    ? `Relevant episodic memory: ${input.episodicMemory.join('; ')}.`
    : 'Relevant episodic memory: none attached.'

  const council = input.councilFindings?.length
    ? `Council / other-agent findings actually available: ${input.councilFindings.join('; ')}.`
    : 'Council / other-agent findings: none attached yet. Do not pretend a missing seat responded.'

  const tools = input.toolDefinitions?.length
    ? `Tools/permissions: ${input.toolDefinitions.join('; ')}.`
    : 'Tools/permissions: none beyond the text you were given. Do not claim tool use you were not given.'

  const backend = input.backendNotes?.trim()
    ? `Backend capability notes (runtime only, not identity): ${input.backendNotes.trim()}`
    : 'Backend capability notes: the current brain/runtime is assigned outside this identity contract.'

  return [
    { id: 'safety_commander_policy', required: true, runtimeControlled: true, text: SAFETY_POLICY },
    { id: 'agent_identity_contract', required: true, runtimeControlled: true, text: identityText },
    { id: 'role_boundary_output_contract', required: true, runtimeControlled: true, text: roleBoundary },
    { id: 'current_mission_and_constraints', required: true, runtimeControlled: true, text: mission },
    { id: 'active_promoted_methods', required: true, runtimeControlled: true, text: promoted },
    { id: 'relevant_verified_knowledge', required: false, runtimeControlled: true, text: verified },
    { id: 'relevant_episodic_memory', required: false, runtimeControlled: true, text: episodic },
    { id: 'council_state_other_agent_findings', required: false, runtimeControlled: true, text: council },
    { id: 'tool_definitions_permissions', required: true, runtimeControlled: true, text: tools },
    { id: 'backend_capability_notes', required: false, runtimeControlled: true, text: backend },
    { id: 'response_schema', required: true, runtimeControlled: true, text: schemaPromptFor(input.agentId) },
  ]
}

export function assembleNebulaContext(input: NebulaContextAssemblyInput): string {
  const modules = buildContextModules(input)
  const ordered = NEBULA_CONTEXT_MODULE_ORDER.map(id => modules.find(module => module.id === id)).filter(
    (module): module is NebulaContextModule => Boolean(module),
  )
  const assembled = ordered.map(module => module.text).join('\n\n')
  const extra = input.extraPolicy?.trim()
  return extra ? `${assembled}\n\n${extra}` : assembled
}

export function requiredIdentityModulesAreRuntimeControlled(modules: NebulaContextModule[]): boolean {
  const required = modules.filter(module =>
    module.id === 'safety_commander_policy'
    || module.id === 'agent_identity_contract'
    || module.id === 'role_boundary_output_contract',
  )
  return required.length === 3 && required.every(module => module.required && module.runtimeControlled && module.text.trim().length > 0)
}

export function modelCannotOmitIdentity(assembled: string, agentId: NebulaAgentId): boolean {
  const agent = NEBULA_AGENTS_BY_ID[agentId]
  return assembled.includes(`You are ${agent.name}`) && assembled.includes('Commander policy') && assembled.includes('Permanent identity')
}
