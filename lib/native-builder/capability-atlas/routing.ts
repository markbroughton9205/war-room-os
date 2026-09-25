import type { ModelRoutingPolicy, SkillRecord } from './types'

export function routingForSkill(skill: SkillRecord): {
  localModelOk: boolean
  frontierRecommended: boolean
  specialistToolRequired: boolean
  foundryNativeProven: boolean
  defaultProvider: 'local' | 'frontier' | 'foundry-native' | 'undecided'
} {
  const policies = new Set<ModelRoutingPolicy>(skill.modelRouting)
  const foundryNativeProven = policies.has('FOUNDRY_NATIVE_PROVEN')
  const specialistToolRequired = policies.has('SPECIALIST_TOOL_REQUIRED')
  const frontierRecommended = policies.has('FRONTIER_RECOMMENDED')
  const localModelOk = policies.has('LOCAL_MODEL_OK') || foundryNativeProven
  let defaultProvider: 'local' | 'frontier' | 'foundry-native' | 'undecided' = 'undecided'
  if (foundryNativeProven) defaultProvider = 'foundry-native'
  else if (specialistToolRequired || frontierRecommended) defaultProvider = 'frontier'
  else if (localModelOk) defaultProvider = 'local'
  return { localModelOk, frontierRecommended, specialistToolRequired, foundryNativeProven, defaultProvider }
}
