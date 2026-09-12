/**
 * #22 Phase 9 — Navigation capability runtime truth.
 */
import type { NavigationCapabilityTruth } from './types'
import { trafficProviderTruthSummary } from './guidance'
import { operationalAscensionAgentCount, TARGET_ASCENSION_AGENTS_UNIMPLEMENTED } from '@/lib/ascension/operationalRegistry'
import { ascensionAutonomyIsOff } from '@/lib/ascension/operationalRegistry'

export function getNavigationCapabilityTruth(): NavigationCapabilityTruth {
  const traffic = trafficProviderTruthSummary()
  return {
    LOCATION_INPUT: 'IMPLEMENTED',
    ROAD_GRAPH: 'IMPLEMENTED_BOUNDED',
    ROUTING: 'IMPLEMENTED_BOUNDED',
    MAP_MATCHING: 'IMPLEMENTED_BOUNDED',
    NAVIGATION_INSTRUCTIONS: 'IMPLEMENTED_BOUNDED',
    TRAFFIC_CONTRACT: 'IMPLEMENTED',
    LIVE_TRAFFIC: traffic.live_traffic,
    INCIDENTS: 'FIXTURE_ONLY',
    MOBILE_GNSS: 'NOT_SUPPORTED',
    BACKGROUND_TRACKING: 'DENIED',
    DEVICE_CONTROL: 'DENIED',
    FUTURE_NAVIGATION_AGENT: TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.includes('FUTURE_NAVIGATION_AGENT')
      ? 'TARGET_UNIMPLEMENTED'
      : 'IMPLEMENTED_BOUNDED',
  }
}

export function navigationRoadmapTruth() {
  return {
    phase: 9,
    foundation: 'IMPLEMENTED_BOUNDED',
    future_navigation_agent: TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.includes('FUTURE_NAVIGATION_AGENT')
      ? 'TARGET_UNIMPLEMENTED'
      : 'IMPLEMENTED_BOUNDED',
    future_world_learning_agent: TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.includes('FUTURE_WORLD_LEARNING_AGENT')
      ? 'TARGET_UNIMPLEMENTED'
      : 'IMPLEMENTED_BOUNDED',
    operational_ascension_agents: operationalAscensionAgentCount(),
    ascension_autonomy: ascensionAutonomyIsOff() ? 'OFF' : 'ON',
    roadmap_22: 'CLOSED',
    roadmap_23: 'NOT_STARTED',
  }
}
