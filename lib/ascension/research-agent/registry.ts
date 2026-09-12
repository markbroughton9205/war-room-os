/**
 * #22 Phase 2 registry — re-exports shared Ascension operational registry (Phase 3).
 * Operational count is now 2 (RESEARCH_AGENT + ENGINEERING_AGENT).
 */
export {
  OPERATIONAL_ASCENSION_AGENTS,
  operationalAscensionAgentCount,
  ascensionAutonomyIsOff,
  TARGET_ASCENSION_AGENTS_UNIMPLEMENTED,
  type OperationalAscensionAgentRecord,
} from '@/lib/ascension/operationalRegistry'
