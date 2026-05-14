import type { EngineCategory, EngineCapabilityId, EngineId, ProviderType } from './types'

/**
 * Optional env vars consulted by `collectEngineStatuses` (see `lib/engine-control/status.ts`):
 * - Local: Ollama/LM Studio probed on loopback; no env required for default ports.
 * - Cloud: OPENAI_API_KEY (chatgpt, codex), ANTHROPIC_API_KEY (claude), XAI_API_KEY (grok), GEMINI_API_KEY (gemini).
 * - CLI/service bridges: LOCAL_AGENT_OPENHANDS_URL, LOCAL_AGENT_AIDER_PATH, LOCAL_AGENT_CONTINUE_PATH, LOCAL_AGENT_GOOSE_PATH.
 * - IDE (cursor): optional CURSOR_* or LOCAL_AGENT_CURSOR_* if you add probes later — not required for Phase 2.
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
    id: 'ollama',
    displayName: 'Ollama',
    category: 'local',
    providerType: 'ollama',
    defaultCapabilities: ['chat_completion', 'code_assist', 'repo_read'],
    defaultPermissionHints: 'Local inference; no cloud key required.',
  },
  {
    id: 'lm_studio',
    displayName: 'LM Studio',
    category: 'local',
    providerType: 'openai_compatible',
    defaultCapabilities: ['chat_completion', 'code_assist', 'repo_read'],
    defaultPermissionHints: 'OpenAI-compatible server on loopback.',
  },
  {
    id: 'continue',
    displayName: 'Continue',
    category: 'ide',
    providerType: 'ide_external',
    defaultCapabilities: ['chat_completion', 'code_assist', 'repo_read'],
    defaultPermissionHints: 'IDE extension — not probed from War Room server.',
  },
  {
    id: 'aider',
    displayName: 'Aider',
    category: 'cli',
    providerType: 'cli_external',
    defaultCapabilities: ['chat_completion', 'code_assist', 'agent_loop', 'repo_read', 'repo_write', 'terminal'],
    defaultPermissionHints: 'CLI agent — configure LOCAL_AGENT_AIDER_PATH to expose status endpoint.',
  },
  {
    id: 'openhands',
    displayName: 'OpenHands',
    category: 'cli',
    providerType: 'http_service',
    defaultCapabilities: ['chat_completion', 'agent_loop', 'repo_read', 'repo_write', 'terminal'],
    defaultPermissionHints: 'Service URL via LOCAL_AGENT_OPENHANDS_URL when available.',
  },
  {
    id: 'goose',
    displayName: 'Goose',
    category: 'cli',
    providerType: 'cli_external',
    defaultCapabilities: ['chat_completion', 'agent_loop', 'repo_read', 'terminal'],
    defaultPermissionHints: 'CLI/framework bridge — LOCAL_AGENT_GOOSE_PATH optional.',
  },
  {
    id: 'cursor',
    displayName: 'Cursor',
    category: 'ide',
    providerType: 'ide_external',
    defaultCapabilities: ['chat_completion', 'code_assist', 'agent_loop', 'repo_read'],
    defaultPermissionHints: 'External IDE — not probed from server.',
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
