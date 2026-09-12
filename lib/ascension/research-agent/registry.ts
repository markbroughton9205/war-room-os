/**
 * #22 Phase 2 — Ascension operational agent registry.
 * After Phase 2: exactly ONE operational agent (RESEARCH_AGENT).
 * Ascension autonomy remains OFF.
 */
import { ASCENSION_AUTONOMY_GUARD } from '@/lib/council/ascension/types'
import {
  isResearchAgentRuntimeAvailable,
  RESEARCH_AGENT_AUTONOMOUS_EXECUTION_ENABLED,
  RESEARCH_AGENT_ROLE,
  RESEARCH_AGENT_RUNTIME_VERSION,
} from './identity'

export type OperationalAscensionAgentRecord = {
  agent_role: typeof RESEARCH_AGENT_ROLE
  runtime_status: 'IMPLEMENTED_BOUNDED'
  runtime_version: typeof RESEARCH_AGENT_RUNTIME_VERSION
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
])

export function operationalAscensionAgentCount(): number {
  return OPERATIONAL_ASCENSION_AGENTS.filter(a => a.available).length
}

export function ascensionAutonomyIsOff(): boolean {
  return (
    ASCENSION_AUTONOMY_GUARD.selfModificationEnabled === false &&
    ASCENSION_AUTONOMY_GUARD.productionEditEnabled === false &&
    ASCENSION_AUTONOMY_GUARD.unvalidatedPromotionEnabled === false &&
    RESEARCH_AGENT_AUTONOMOUS_EXECUTION_ENABLED === false
  )
}

/** Target Ascension agents that must remain unimplemented. */
export const TARGET_ASCENSION_AGENTS_UNIMPLEMENTED = Object.freeze([
  'ENGINEERING_AGENT',
  'TERRA_INTELLIGENCE_AGENT',
  'OPERATIONS_AGENT',
  'SECURITY_RED_TEAM_AGENT',
  'COUNCIL_VALIDATOR',
  'DATA_CORPUS_AGENT',
  'FUTURE_NAVIGATION_AGENT',
  'FUTURE_WORLD_LEARNING_AGENT',
] as const)
