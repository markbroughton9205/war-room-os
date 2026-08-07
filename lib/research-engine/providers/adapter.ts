import type { ResearchHealthStatus, ResearchProviderId, ResearchProviderResponse, ResearchQuery } from '@/lib/research-engine/core/types'

/**
 * Common contract every implemented Research Engine provider adapter
 * satisfies. `run` is capability-agnostic by design: an adapter internally
 * decides whether a query maps to a text search, a time-series lookup, or a
 * geo query based on its own declared capabilities in
 * config/providerEnv.ts — callers (the router, the API routes) never need to
 * know provider-specific method names.
 */
export type ResearchProviderAdapter = {
  id: ResearchProviderId
  run: (query: ResearchQuery) => Promise<ResearchProviderResponse>
  healthCheck: () => Promise<ResearchHealthStatus>
}
