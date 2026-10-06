/**
 * Generative-provider registry (local video generation only).
 * Separate from provider-registry.ts (remote metered stubs) and creative-intelligence (LLM creative provider).
 * Exactly one provider is registered in this slice: Wan 2.2 TI2V-5B.
 */
import { WAN22_PROVIDER } from './providers/wan22'
import { HVS_GENERATIVE_FUTURE_CAPABILITIES, type HvsGenerativeCapability } from './types'

export type GenerativeProviderDescriptor = typeof WAN22_PROVIDER

const REGISTRY: ReadonlyArray<GenerativeProviderDescriptor> = Object.freeze([WAN22_PROVIDER])

export function listGenerativeProviders(): ReadonlyArray<GenerativeProviderDescriptor> {
  return REGISTRY
}

export function getGenerativeProvider(id: string): GenerativeProviderDescriptor | null {
  return REGISTRY.find(row => row.provider === id || row.modelId === id) ?? null
}

export function providersForCapability(capability: HvsGenerativeCapability | string): GenerativeProviderDescriptor[] {
  if ((HVS_GENERATIVE_FUTURE_CAPABILITIES as readonly string[]).includes(capability)) return []
  return REGISTRY.filter(row => (row.capabilities as readonly string[]).includes(capability))
}

/** Every registered generative provider is local, keyless, and offline at generation time. */
export function registryIsLocalOnly(): boolean {
  return REGISTRY.every(row => row.local && !row.apiKeyRequired && row.network === 'NONE_AT_GENERATION' && row.cost === 'none')
}
