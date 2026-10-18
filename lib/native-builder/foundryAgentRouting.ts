/**
 * Recorded model routing. Mid-task switches are forbidden unless a new routing record is written.
 */
import { FOUNDRY_DEFAULT_FALLBACK_MODEL, FOUNDRY_DEFAULT_PRIMARY_MODEL } from './foundryOperationsTypes'
import { readFoundryRuntimeConfig } from './foundryRuntimeConfig'
import { FOUNDRY_ROLE_CATALOG } from './foundryAgentRoles'
import type { FoundryAgentRole, FoundryModelRoutingRecord } from './foundryAgentTypes'

export function routeModelForRole(role: FoundryAgentRole, override?: Partial<FoundryModelRoutingRecord>): FoundryModelRoutingRecord {
  const config = readFoundryRuntimeConfig()
  const spec = FOUNDRY_ROLE_CATALOG[role]
  const preferLocal = /local repetitive coding/.test(spec.routingReason)
  const preferResearch = /research/.test(spec.routingReason)
  const providerPolicy = config.providerPolicy
  let provider = 'cursor-agent'
  let model = config.primaryModel || FOUNDRY_DEFAULT_PRIMARY_MODEL
  if (preferLocal && (providerPolicy === 'LOCAL' || providerPolicy === 'AUTO')) {
    provider = config.localProviderType
    model = `${config.localProviderType}:${config.localModelId || FOUNDRY_DEFAULT_FALLBACK_MODEL.replace(/^[^:]+:/, '')}`
  }
  if (preferResearch && providerPolicy !== 'LOCAL') {
    provider = 'cursor-agent'
    model = config.primaryModel || FOUNDRY_DEFAULT_PRIMARY_MODEL
  }
  return {
    provider: override?.provider ?? provider,
    model: override?.model ?? model,
    reason: override?.reason ?? spec.routingReason,
    fallback: override?.fallback ?? (config.fallbackModel || FOUNDRY_DEFAULT_FALLBACK_MODEL),
    switchedMidTask: false,
  }
}

export function recordMidTaskSwitch(
  previous: FoundryModelRoutingRecord,
  next: Partial<FoundryModelRoutingRecord>,
  reason: string,
): FoundryModelRoutingRecord {
  return {
    provider: next.provider ?? previous.provider,
    model: next.model ?? previous.model,
    reason,
    fallback: next.fallback ?? previous.fallback,
    switchedMidTask: true,
  }
}
