/**
 * Shared AI types for server-side routing and providers (`lib/ai/**`).
 * Do not import these from client components if they pull in env-backed modules.
 */

export type AIMessageRole = 'user' | 'assistant' | 'system'

export type AIMessage = {
  role: AIMessageRole
  content: string
}

/**
 * Normalized provider output for the chat API and router.
 * `raw` is optional debug payload — omit from HTTP JSON when it may contain sensitive vendor fields.
 */
export type ProviderResponse = {
  text: string
  /** Council / product family label, aligned with `lib/mockCouncilData.ts` `familyName` values. */
  family: string
  /** Short provider id or vendor name, aligned with mock council `provider` where applicable. */
  provider: string
  model?: string
  raw?: unknown
}
