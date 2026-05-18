import type { EngineCategory, EngineCapabilityId, EngineId, ProviderType } from './types'

/**
 * Optional env vars consulted by `collectEngineStatuses` (see `lib/engine-control/status.ts`):
 * - Cloud: OPENAI_API_KEY (chatgpt, codex), ANTHROPIC_API_KEY (claude), XAI_API_KEY (grok), GEMINI_API_KEY (gemini).
 * - Cursor remains a manual workspace lane and is not probed from War Room.
 */

export type EngineRegistryEntry = {
  id: EngineId
  displayName: string
  category: EngineCategory
  providerType: ProviderType
  /** Default capability tags before live status merge. */
  defaultCapabilities: readonly EngineCapabilityId[]
  /** Static hints for docs / UI; runtime `EngineStatus.permissions` is computed in `permissions.ts`. */
  defaultPermissionHints: string
}

export const ENGINE_REGISTRY: readonly EngineRegistryEntry[] = [
  {
    id: 'cursor',
    displayName: 'Cursor',
    category: 'manual_workspace',
    providerType: 'ide_external',
    defaultCapabilities: ['chat_completion', 'code_assist', 'agent_loop', 'repo_read'],
    defaultPermissionHints: 'Manual engineering workspace; War Room does not invoke Cursor automatically.',
  },
  {
    id: 'codex',
    displayName: 'Codex',
    category: 'ide',
    providerType: 'openai',
    defaultCapabilities: ['chat_completion', 'code_assist', 'repo_read'],
    defaultPermissionHints: 'OpenAI Codex / IDE flows — OPENAI_API_KEY used when shared.',
  },
  {
    id: 'grok',
    displayName: 'Grok',
    category: 'cloud',
    providerType: 'xai',
    defaultCapabilities: ['chat_completion', 'code_assist', 'internet'],
    defaultPermissionHints: 'xAI cloud — XAI_API_KEY.',
  },
  {
    id: 'claude',
    displayName: 'Claude',
    category: 'cloud',
    providerType: 'anthropic',
    defaultCapabilities: ['chat_completion', 'code_assist', 'repo_read', 'research'],
    defaultPermissionHints: 'Anthropic Messages API — ANTHROPIC_API_KEY.',
  },
  {
    id: 'chatgpt',
    displayName: 'ChatGPT',
    category: 'cloud',
    providerType: 'openai',
    defaultCapabilities: ['chat_completion', 'code_assist', 'repo_read', 'internet', 'research'],
    defaultPermissionHints: 'OpenAI API — OPENAI_API_KEY.',
  },
  {
    id: 'gemini',
    displayName: 'Gemini',
    category: 'cloud_model',
    providerType: 'google',
    defaultCapabilities: ['chat_completion', 'code_assist', 'repo_read'],
    defaultPermissionHints: 'Google AI — optional GEMINI_API_KEY (see module comment above).',
  },
] as const

export const ENGINE_REGISTRY_BY_ID: ReadonlyMap<EngineId, EngineRegistryEntry> = new Map(
  ENGINE_REGISTRY.map(entry => [entry.id, entry]),
)
