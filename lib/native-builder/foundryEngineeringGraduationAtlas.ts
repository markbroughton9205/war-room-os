/**
 * Map graduation proof onto the existing Capability Atlas ladder.
 * Atlas reports preparedness/proof. Atlas does not decide what Commander may build.
 * A missing certification means acquire / practice / evaluate / continue — not permanent prohibition.
 * Do not distort the existing ladder. Fixtures cannot assign PRODUCTION_PROVEN.
 */
import type { CapabilityStatus } from './capability-atlas/types'
import type { FoundryGraduationLevel } from './foundryEngineeringGraduationTypes'

export type FoundryGraduationAtlasMapping = {
  graduationLevel: FoundryGraduationLevel
  atlasStatus: CapabilityStatus
  productionProven: boolean
  commanderMayStillBuild: true
  missingMeans: 'acquire_practice_evaluate_continue'
}

export function mapGraduationLevelToAtlas(level: FoundryGraduationLevel): FoundryGraduationAtlasMapping {
  const atlasStatus: CapabilityStatus = level === 'UNTESTED' ? 'DISCOVERED'
    : level === 'ATTEMPTED' ? 'EVALUATION_PENDING'
      : level === 'PARTIAL' ? 'EVALUATED'
        : level === 'PASSED_FIXTURE' ? 'EVALUATED'
          : level === 'PASSED_MULTI_FIXTURE' ? 'PROVEN'
            : level === 'RELIABLE' ? 'PROVEN'
              : 'PRODUCTION_PROVEN'
  return {
    graduationLevel: level,
    atlasStatus,
    productionProven: level === 'PRODUCTION_PROVEN',
    commanderMayStillBuild: true,
    missingMeans: 'acquire_practice_evaluate_continue',
  }
}

export function atlasStatusForGraduationEvent(event: 'discovered' | 'source_known' | 'can_learn' | 'runtime_available' | 'benchmark_pending' | 'fixture_pass' | 'multi_fixture' | 'production_evidence'): CapabilityStatus {
  if (event === 'discovered') return 'DISCOVERED'
  if (event === 'source_known') return 'SOURCE_BACKED'
  if (event === 'can_learn') return 'LEARNABLE'
  if (event === 'runtime_available') return 'AVAILABLE'
  if (event === 'benchmark_pending') return 'EVALUATION_PENDING'
  if (event === 'fixture_pass') return 'EVALUATED'
  if (event === 'multi_fixture') return 'PROVEN'
  return 'PRODUCTION_PROVEN'
}
