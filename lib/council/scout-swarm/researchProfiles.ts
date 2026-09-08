import type { ResearchProfileName, ScoutGovernorLimits } from './types'
import { DEFAULT_SCOUT_GOVERNOR_LIMITS } from './governor'

/**
 * Measured research governor profiles from Build #6 prep on NEBULA-GENESIS.
 * Global/deep must not raise model concurrency above 1 by default.
 */
export const RESEARCH_PROFILE_NAMES: readonly ResearchProfileName[] = [
  'LIGHT_RESEARCH',
  'STANDARD_RESEARCH',
  'DEEP_RESEARCH',
  'GLOBAL_SCATTER',
]

export type ResearchProfileCaps = {
  scouts: number
  modelConcurrency: 1
  webConcurrency: number
  maxScoutsPerSeat: number
}

export const RESEARCH_PROFILES: Record<ResearchProfileName, ResearchProfileCaps> = Object.freeze({
  LIGHT_RESEARCH: { scouts: 3, modelConcurrency: 1, webConcurrency: 3, maxScoutsPerSeat: 3 },
  STANDARD_RESEARCH: { scouts: 8, modelConcurrency: 1, webConcurrency: 5, maxScoutsPerSeat: 5 },
  DEEP_RESEARCH: { scouts: 16, modelConcurrency: 1, webConcurrency: 8, maxScoutsPerSeat: 5 },
  GLOBAL_SCATTER: { scouts: 16, modelConcurrency: 1, webConcurrency: 8, maxScoutsPerSeat: 5 },
})

/** Burst slot for abort/supersession/recovery only — never the default research path. */
export const BURST_MAX_CONCURRENT_MODEL_CALLS = 2

export function burstModelConcurrency(reason: 'abort_recovery' | 'supersession_recovery'): number {
  void reason
  return BURST_MAX_CONCURRENT_MODEL_CALLS
}

export function selectResearchProfile(input: {
  decree: string
  regionalScatter: string[]
  geographicScope: 'local' | 'national' | 'regional' | 'global' | 'none'
  liveResearchRequired: boolean
  engineering: boolean
}): ResearchProfileName {
  const text = input.decree.trim()
  if (!text) return 'LIGHT_RESEARCH'
  if (input.engineering && !/\b(cve|advisory|outage|vendor (?:status|incident))\b/i.test(text)) {
    return 'LIGHT_RESEARCH'
  }
  if (input.regionalScatter.length >= 3 || input.geographicScope === 'global') {
    return 'GLOBAL_SCATTER'
  }
  if (/\b(deep research|exhaustive|comprehensive survey|all sources)\b/i.test(text)) {
    return 'DEEP_RESEARCH'
  }
  if (input.liveResearchRequired || input.geographicScope === 'national' || input.geographicScope === 'regional') {
    return 'STANDARD_RESEARCH'
  }
  return 'LIGHT_RESEARCH'
}

export function applyResearchProfile(
  base: ScoutGovernorLimits = DEFAULT_SCOUT_GOVERNOR_LIMITS,
  profile: ResearchProfileName,
): ScoutGovernorLimits {
  const caps = RESEARCH_PROFILES[profile]
  return {
    ...base,
    maxTotalScoutsPerRound: caps.scouts,
    maxScoutsPerSeat: caps.maxScoutsPerSeat,
    maxConcurrentModelCalls: caps.modelConcurrency,
    maxConcurrentWebCalls: caps.webConcurrency,
  }
}
