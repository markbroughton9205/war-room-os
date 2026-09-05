import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { FamilyAvailability } from '@/lib/council/adaptive-assembly/types'

// AGI Wave 1 — Model Router contracts (hooks only, per the mission brief). No existing Council
// call site is rewired through this module in Wave 1; it exists so future work (routing
// decisions, WRIM candidate scoring) has a real interface to target, and so experience-record
// capture has a typed ModelTarget to log against.

export type ModelTier = 'ACTIVE_MODEL' | 'CANDIDATE_MODEL'

export type ModelTarget = {
  /** 'wrim0' is reserved exclusively for the descriptive-only CANDIDATE_MODEL placeholder in
   * lib/model-router/registry.ts — it is never a real Council family and never dispatchable. */
  readonly providerFamily: CouncilOrchestrationFamily | 'wrim0'
  readonly displayName: string
  readonly tier: ModelTier
  readonly profileVersion: string
  readonly availability: FamilyAvailability
  /** True only for families lib/council/providerDirectCall.ts's invokeDirectCouncilProvider can
   * actually dispatch to (its DirectProviderFamily union) — e.g. 'bridge_architect' has a
   * capability profile but no direct-call implementation, so this is honestly false for it. */
  readonly dispatchable: boolean
}

export type ModelRequest = {
  target: ModelTarget
  message: string
  system?: string
  maxTokens?: number
  timeoutMs?: number
}

export type ModelResponse = {
  target: ModelTarget
  content: string
  latencyMs: number
  status: 'ok' | 'error' | 'timeout' | 'not_dispatchable'
  errorMessage?: string
}
