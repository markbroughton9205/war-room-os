import { ENGINE_REGISTRY_BY_ID } from './registry'
import type { EngineId, ProviderType } from './types'

/** Stable human-facing provider name for status UI and route-command summaries. */
export function engineProviderDisplayLabel(id: EngineId, providerType: ProviderType): string {
  if (id === 'gemini') return 'Google Gemini'
  if (providerType === 'openai') return 'OpenAI'
  if (providerType === 'anthropic') return 'Anthropic'
  if (providerType === 'xai') return 'xAI'
  if (providerType === 'google') return 'Google'
  if (providerType === 'ollama') return 'Ollama'
  if (providerType === 'openai_compatible') return 'LM Studio (OpenAI-compatible)'
  const reg = ENGINE_REGISTRY_BY_ID.get(id)
  return reg?.displayName ?? providerType
}
