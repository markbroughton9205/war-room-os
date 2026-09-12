/**
 * #22 Phase 3 — Shared Ascension operational registry.
 * Exactly the agents that are IMPLEMENTED_BOUNDED and available.
 */
import { ASCENSION_AUTONOMY_GUARD } from '@/lib/council/ascension/types'
import {
  isResearchAgentRuntimeAvailable,
  RESEARCH_AGENT_AUTONOMOUS_EXECUTION_ENABLED,
  RESEARCH_AGENT_ROLE,
  RESEARCH_AGENT_RUNTIME_VERSION,
} from '@/lib/ascension/research-agent/identity'
import {
  ENGINEERING_AGENT_AUTONOMOUS_EXECUTION_ENABLED,
  ENGINEERING_AGENT_ROLE,
  ENGINEERING_AGENT_RUNTIME_VERSION,
  isEngineeringAgentRuntimeAvailable,
} from '@/lib/ascension/engineering-agent/identity'

export type OperationalAscensionAgentRecord = {
  agent_role: typeof RESEARCH_AGENT_ROLE | typeof ENGINEERING_AGENT_ROLE
  runtime_status: 'IMPLEMENTED_BOUNDED'
  runtime_version: string
  invocation_driven: true
  autonomous: false
  available: boolean
}

export const OPERATIONAL_ASCENSION_AGENTS: readonly OperationalAscensionAgentRecord[] = Object.freeze([
  {
    agent_role: RESEARCH_AGENT_ROLE,
    runtime_status: 'IMPLEMENTED_BOUNDED',
    runtime_version: RESEARCH_AGENT_RUNTIME_VERSION,
    invocation_driven: true,
    autonomous: false,
    available: isResearchAgentRuntimeAvailable(),
  },
  {
    agent_role: ENGINEERING_AGENT_ROLE,
    runtime_status: 'IMPLEMENTED_BOUNDED',
    runtime_version: ENGINEERING_AGENT_RUNTIME_VERSION,
    invocation_driven: true,
    autonomous: false,
    available: isEngineeringAgentRuntimeAvailable(),
  },
])

export function operationalAscensionAgentCount(): number {
  return OPERATIONAL_ASCENSION_AGENTS.filter(a => a.available).length
}

export function ascensionAutonomyIsOff(): boolean {
  return (
    ASCENSION_AUTONOMY_GUARD.selfModificationEnabled === false &&
    ASCENSION_AUTONOMY_GUARD.productionEditEnabled === false &&
    ASCENSION_AUTONOMY_GUARD.unvalidatedPromotionEnabled === false &&
    RESEARCH_AGENT_AUTONOMOUS_EXECUTION_ENABLED === false &&
    ENGINEERING_AGENT_AUTONOMOUS_EXECUTION_ENABLED === false
  )
}

/** Remaining #21 TARGET agents — must stay unimplemented. */
export const TARGET_ASCENSION_AGENTS_UNIMPLEMENTED = Object.freeze([
  'TERRA_INTELLIGENCE_AGENT',
  'OPERATIONS_AGENT',
  'SECURITY_RED_TEAM_AGENT',
  'COUNCIL_VALIDATOR',
  'DATA_CORPUS_AGENT',
  'FUTURE_NAVIGATION_AGENT',
  'FUTURE_WORLD_LEARNING_AGENT',
] as const)
