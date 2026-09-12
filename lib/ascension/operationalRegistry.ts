/**
 * #22 Phase 3+ — Shared Ascension operational registry.
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
import {
  isSecurityRedTeamAgentRuntimeAvailable,
  SECURITY_RED_TEAM_AGENT_AUTONOMOUS_EXECUTION_ENABLED,
  SECURITY_RED_TEAM_AGENT_ROLE,
  SECURITY_RED_TEAM_AGENT_RUNTIME_VERSION,
} from '@/lib/ascension/security-red-team-agent/identity'
import {
  isOperationsAgentRuntimeAvailable,
  OPERATIONS_AGENT_AUTONOMOUS_EXECUTION_ENABLED,
  OPERATIONS_AGENT_ROLE,
  OPERATIONS_AGENT_RUNTIME_VERSION,
} from '@/lib/ascension/operations-agent/identity'
import {
  isTerraIntelligenceAgentRuntimeAvailable,
  TERRA_INTELLIGENCE_AGENT_AUTONOMOUS_EXECUTION_ENABLED,
  TERRA_INTELLIGENCE_AGENT_ROLE,
  TERRA_INTELLIGENCE_AGENT_RUNTIME_VERSION,
} from '@/lib/ascension/terra-intelligence-agent/identity'
import {
  isCouncilValidatorRuntimeAvailable,
  COUNCIL_VALIDATOR_AUTONOMOUS_EXECUTION_ENABLED,
  COUNCIL_VALIDATOR_ROLE,
  COUNCIL_VALIDATOR_RUNTIME_VERSION,
} from '@/lib/ascension/council-validator/identity'

export type OperationalAscensionAgentRecord = {
  agent_role:
    | typeof RESEARCH_AGENT_ROLE
    | typeof ENGINEERING_AGENT_ROLE
    | typeof SECURITY_RED_TEAM_AGENT_ROLE
    | typeof OPERATIONS_AGENT_ROLE
    | typeof TERRA_INTELLIGENCE_AGENT_ROLE
    | typeof COUNCIL_VALIDATOR_ROLE
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
  {
    agent_role: SECURITY_RED_TEAM_AGENT_ROLE,
    runtime_status: 'IMPLEMENTED_BOUNDED',
    runtime_version: SECURITY_RED_TEAM_AGENT_RUNTIME_VERSION,
    invocation_driven: true,
    autonomous: false,
    available: isSecurityRedTeamAgentRuntimeAvailable(),
  },
  {
    agent_role: OPERATIONS_AGENT_ROLE,
    runtime_status: 'IMPLEMENTED_BOUNDED',
    runtime_version: OPERATIONS_AGENT_RUNTIME_VERSION,
    invocation_driven: true,
    autonomous: false,
    available: isOperationsAgentRuntimeAvailable(),
  },
  {
    agent_role: TERRA_INTELLIGENCE_AGENT_ROLE,
    runtime_status: 'IMPLEMENTED_BOUNDED',
    runtime_version: TERRA_INTELLIGENCE_AGENT_RUNTIME_VERSION,
    invocation_driven: true,
    autonomous: false,
    available: isTerraIntelligenceAgentRuntimeAvailable(),
  },
  {
    agent_role: COUNCIL_VALIDATOR_ROLE,
    runtime_status: 'IMPLEMENTED_BOUNDED',
    runtime_version: COUNCIL_VALIDATOR_RUNTIME_VERSION,
    invocation_driven: true,
    autonomous: false,
    available: isCouncilValidatorRuntimeAvailable(),
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
    ENGINEERING_AGENT_AUTONOMOUS_EXECUTION_ENABLED === false &&
    SECURITY_RED_TEAM_AGENT_AUTONOMOUS_EXECUTION_ENABLED === false &&
    OPERATIONS_AGENT_AUTONOMOUS_EXECUTION_ENABLED === false &&
    TERRA_INTELLIGENCE_AGENT_AUTONOMOUS_EXECUTION_ENABLED === false &&
    COUNCIL_VALIDATOR_AUTONOMOUS_EXECUTION_ENABLED === false
  )
}

/** Remaining #21 TARGET agents — must stay unimplemented. */
export const TARGET_ASCENSION_AGENTS_UNIMPLEMENTED = Object.freeze([
  'DATA_CORPUS_AGENT',
  'FUTURE_NAVIGATION_AGENT',
  'FUTURE_WORLD_LEARNING_AGENT',
] as const)
