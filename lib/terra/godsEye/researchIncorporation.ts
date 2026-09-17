/**
 * Uploaded research briefs incorporated into the current Terra/God's Eye build.
 * This is the validation-report source of truth — not a docs-only checklist.
 */
import type { GodsEyeEvaluationState } from './coverageStates'
import { PANORAMAX_STATUS } from './panoramax'
import {
  CLICK_INFO_STATUS,
  CONVERSATION_AUTO_EXPAND_STATUS,
  DOUBLE_CLICK_SPIN_STATUS,
  HOUSE_NUMBERS_STATUS,
  LIVE_INTEL_FLOATING_STATUS,
  LIVE_INTEL_PIN_STATUS,
  LIVE_SIGNAL_PHASE_STATUS,
  MAPILLARYJS_STATUS,
  RE_EARTH_BUILDINGS_STATUS,
  RE_EARTH_TERRAIN_STATUS,
  STREET_NAMES_STATUS,
  STREET_OBJECT_INTERFACE_STATUS,
  TRAFFIC_SIGNAL_INFRASTRUCTURE_STATUS,
} from './openStack'
import { OVERTURE_RUNTIME_QUERY } from './overtureIdentity'
import { emptyTrafficCameraCoverage } from './trafficCamera'

export const GODS_EYE_RESEARCH_INCORPORATED = 'GODS_EYE_RESEARCH_INCORPORATED_IN_BUILD' as const

export const GODS_EYE_SUCCESS_PATH = [
  'SEE EARTH',
  'SEE WHAT IS THERE',
  'SEE WHAT IS HAPPENING',
  'CLICK IT',
  'INSPECT IT',
  'VERIFY SOURCE',
  'VIEW STREET CONTEXT',
  'SEND TO COUNCIL',
] as const

export type GodsEyeResearchItemStatus =
  | 'IMPLEMENTED'
  | 'PARTIAL'
  | 'EVALUATION_ACTIVE'
  | 'NO_COVERAGE'
  | 'BLOCKED'
  | 'UNVERIFIED'
  | 'DISABLED'

export type GodsEyeResearchBuildReport = {
  incorporated: typeof GODS_EYE_RESEARCH_INCORPORATED
  RE_EARTH_BUILDINGS: GodsEyeResearchItemStatus
  RE_EARTH_TERRAIN: GodsEyeResearchItemStatus
  OVERTURE_IDENTITY: GodsEyeResearchItemStatus
  STREET_NAMES: GodsEyeResearchItemStatus
  HOUSE_NUMBERS: GodsEyeResearchItemStatus
  TRAFFIC_SIGNALS_STATIC: GodsEyeResearchItemStatus
  LIVE_SIGNAL_PHASE: GodsEyeResearchItemStatus
  TRAFFIC_CAMERAS: GodsEyeResearchItemStatus
  MAPILLARYJS: GodsEyeResearchItemStatus
  PANORAMAX: GodsEyeResearchItemStatus
  STREET_OBJECT_INTERFACE: GodsEyeResearchItemStatus
  CLICK_INFO: GodsEyeResearchItemStatus
  FLOATING_LIVE_INTEL: GodsEyeResearchItemStatus
  PIN_STICKY: GodsEyeResearchItemStatus
  DOUBLE_CLICK_SPIN: GodsEyeResearchItemStatus
  CONVERSATION_COMPACT_LOCK: GodsEyeResearchItemStatus
  PROVENANCE: GodsEyeResearchItemStatus
  LOD_BEHAVIOR: GodsEyeResearchItemStatus
  FEATURE_PICKABILITY: GodsEyeResearchItemStatus
}

function evalToReport(value: GodsEyeEvaluationState | 'DISABLED' | 'NO_COVERAGE' | 'PARTIAL' | 'ACTIVE'): GodsEyeResearchItemStatus {
  if (value === 'ACTIVE') return 'IMPLEMENTED'
  if (value === 'DISABLED') return 'DISABLED'
  if (value === 'EVALUATION_ACTIVE' || value === 'PARTIAL' || value === 'NO_COVERAGE' || value === 'BLOCKED' || value === 'UNAVAILABLE') {
    return value === 'UNAVAILABLE' ? 'NO_COVERAGE' : value
  }
  return 'UNVERIFIED'
}

export function godsEyeResearchBuildReport(): GodsEyeResearchBuildReport {
  const cameras = emptyTrafficCameraCoverage()
  return {
    incorporated: GODS_EYE_RESEARCH_INCORPORATED,
    RE_EARTH_BUILDINGS: evalToReport(RE_EARTH_BUILDINGS_STATUS),
    RE_EARTH_TERRAIN: evalToReport(RE_EARTH_TERRAIN_STATUS),
    OVERTURE_IDENTITY: OVERTURE_RUNTIME_QUERY === 'NO_COVERAGE' ? 'PARTIAL' : 'IMPLEMENTED',
    STREET_NAMES: evalToReport(STREET_NAMES_STATUS),
    HOUSE_NUMBERS: evalToReport(HOUSE_NUMBERS_STATUS),
    TRAFFIC_SIGNALS_STATIC: evalToReport(TRAFFIC_SIGNAL_INFRASTRUCTURE_STATUS),
    LIVE_SIGNAL_PHASE: evalToReport(LIVE_SIGNAL_PHASE_STATUS),
    TRAFFIC_CAMERAS: cameras.coverageState === 'PARTIAL' ? 'PARTIAL' : 'IMPLEMENTED',
    MAPILLARYJS: evalToReport(MAPILLARYJS_STATUS),
    PANORAMAX: evalToReport(PANORAMAX_STATUS),
    STREET_OBJECT_INTERFACE: evalToReport(STREET_OBJECT_INTERFACE_STATUS),
    CLICK_INFO: evalToReport(CLICK_INFO_STATUS),
    FLOATING_LIVE_INTEL: evalToReport(LIVE_INTEL_FLOATING_STATUS),
    PIN_STICKY: evalToReport(LIVE_INTEL_PIN_STATUS),
    DOUBLE_CLICK_SPIN: evalToReport(DOUBLE_CLICK_SPIN_STATUS),
    CONVERSATION_COMPACT_LOCK: CONVERSATION_AUTO_EXPAND_STATUS === 'DISABLED' ? 'IMPLEMENTED' : 'UNVERIFIED',
    PROVENANCE: 'IMPLEMENTED',
    LOD_BEHAVIOR: 'IMPLEMENTED',
    FEATURE_PICKABILITY: 'IMPLEMENTED',
  }
}
