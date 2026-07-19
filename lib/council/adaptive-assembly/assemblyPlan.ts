import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { CouncilCapability } from './capabilities'
import type {
  AssemblyPlanRevisionInput,
  CommanderOverride,
  CouncilAssemblyPlan,
  CostTier,
  DependencyIntent,
  FamilySelectionReason,
  LatencyTier,
  MissionClassification,
  PlanStatus,
  SpeakingRole,
} from './types'

export function stablePlanHash(input: string): string {
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function createPlanId(input: {
  missionId: string
  missionVersion: number
  planVersion: number
  selectedFamilies: readonly CouncilOrchestrationFamily[]
  overrides: readonly CommanderOverride[]
}): string {
  const signature = JSON.stringify({
    missionId: input.missionId,
    missionVersion: input.missionVersion,
    planVersion: input.planVersion,
    selectedFamilies: input.selectedFamilies,
    overrides: input.overrides.map(override => [override.overrideType, override.value, override.supportStatus]),
  })
  return `assembly-${input.missionVersion}-${input.planVersion}-${stablePlanHash(signature)}`
}

export function costTierFromFamilies(costs: readonly CostTier[]): CostTier {
  if (costs.includes('unknown')) return 'unknown'
  if (costs.includes('high')) return 'high'
  if (costs.includes('medium')) return 'medium'
  return 'low'
}

export function latencyTierFromFamilies(latencies: readonly LatencyTier[]): LatencyTier {
  if (latencies.includes('unknown')) return 'unknown'
  if (latencies.includes('slow')) return 'slow'
  if (latencies.includes('moderate')) return 'moderate'
  return 'fast'
}

export function dependencyIntentForClassification(classification: MissionClassification): DependencyIntent[] {
  const intents: DependencyIntent[] = ['opening_required']
  if (classification.requiredCapabilities.length > 1) intents.push('direct_review_required')
  if (classification.redTeamRequirement === 'mandatory') intents.push('challenge_required')
  if (classification.redTeamRequirement === 'mandatory' || classification.riskLevel !== 'low') intents.push('revision_possible')
  if (classification.synthesisRequirement !== 'prevented') intents.push('synthesis_required')
  return intents
}

export function speakingRolesForFamilies(input: {
  selectedFamilies: readonly CouncilOrchestrationFamily[]
  redTeamIncluded: boolean
  synthesizer: CouncilOrchestrationFamily | null
}): SpeakingRole[] {
  return input.selectedFamilies.map((familyId, index) => {
    if (familyId === 'red_team' && input.redTeamIncluded) return { familyId, role: 'challenge' }
    if (familyId === input.synthesizer) return { familyId, role: 'synthesis' }
    return { familyId, role: index === 0 ? 'opening' : 'review' }
  })
}

export function validateAssemblyPlan(plan: CouncilAssemblyPlan): string[] {
  const errors: string[] = []
  const selected = new Set(plan.selectedFamilies)
  const excluded = new Set(plan.excludedFamilies)
  const optional = new Set(plan.optionalFamilies)

  if (!plan.planId) errors.push('missing_plan_id')
  if (plan.planVersion < 1) errors.push('invalid_plan_version')
  if (!plan.missionId) errors.push('missing_mission_id')
  if (plan.missionVersion < 1) errors.push('invalid_mission_version')
  if (plan.advisoryNotice !== 'Recommended assembly — not used for execution.') errors.push('missing_advisory_honesty_label')
  if (plan.selectedFamilies.length !== selected.size) errors.push('duplicate_selected_family')
  for (const family of selected) {
    if (excluded.has(family)) errors.push(`selected_and_excluded:${family}`)
  }
  for (const family of optional) {
    if (selected.has(family)) errors.push(`optional_also_selected:${family}`)
  }
  for (const family of plan.selectedFamilies) {
    const reason = plan.selectionReasons.find(item => item.familyId === family)
    if (!reason?.reasons.length) errors.push(`missing_selection_reason:${family}`)
  }
  for (const family of plan.excludedFamilies) {
    const reason = plan.exclusionReasons.find(item => item.familyId === family)
    if (!reason?.reasons.length) errors.push(`missing_exclusion_reason:${family}`)
  }
  if (plan.selectedFamilies.length > plan.maxProviderCount) errors.push('selected_family_count_exceeds_max_provider_count')
  if (
    plan.synthesisAuthority.primaryFamily
    && !plan.selectedFamilies.includes(plan.synthesisAuthority.primaryFamily)
  ) {
    errors.push('synthesis_authority_not_selected')
  }
  if (
    plan.previousPlanId === null
    && plan.previousPlanVersion !== null
  ) {
    errors.push('previous_version_without_previous_plan')
  }
  if (
    plan.previousPlanId !== null
    && plan.previousPlanVersion === null
  ) {
    errors.push('previous_plan_without_previous_version')
  }

  return errors
}

export function markAssemblyPlanReady(plan: CouncilAssemblyPlan): CouncilAssemblyPlan {
  const errors = validateAssemblyPlan(plan)
  if (errors.length) {
    return Object.freeze({ ...plan, planStatus: 'invalid' as PlanStatus, uncertaintyFlags: [...plan.uncertaintyFlags, ...errors] })
  }
  return Object.freeze({ ...plan, planStatus: 'execution_ready' as PlanStatus })
}

export function reviseAssemblyPlan(
  input: AssemblyPlanRevisionInput,
  createNext: (args: {
    missionVersion: number
    planVersion: number
    previousPlanId: string
    previousPlanVersion: number
    createdAt: string
    commanderMessage?: string
    commanderOverrides?: readonly CommanderOverride[]
  }) => CouncilAssemblyPlan,
): CouncilAssemblyPlan {
  if (input.previousPlan.planStatus === 'execution_ready' || input.previousPlan.planStatus === 'execution_started') {
    throw new Error(`Assembly plan ${input.previousPlan.planId} is immutable after ${input.previousPlan.planStatus}.`)
  }
  if (!input.changeReason.trim()) throw new Error('Assembly plan revisions require a change reason.')
  return createNext({
    missionVersion: input.missionVersion ?? input.previousPlan.missionVersion + 1,
    planVersion: input.previousPlan.planVersion + 1,
    previousPlanId: input.previousPlan.planId,
    previousPlanVersion: input.previousPlan.planVersion,
    createdAt: input.createdAt ?? new Date().toISOString(),
    commanderMessage: input.commanderMessage,
    commanderOverrides: input.commanderOverrides,
  })
}

export function familyReason(familyId: CouncilOrchestrationFamily, reasons: string[]): FamilySelectionReason {
  return Object.freeze({ familyId, reasons: Object.freeze(reasons) })
}

export function missingCapabilities(
  required: readonly CouncilCapability[],
  selectedCapabilities: readonly CouncilCapability[],
): CouncilCapability[] {
  const selectedSet = new Set(selectedCapabilities)
  return required.filter(capability => !selectedSet.has(capability))
}
