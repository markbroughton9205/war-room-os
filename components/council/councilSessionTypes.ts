export type CouncilLifecycleState =
  | 'active'
  | 'waiting_for_rael'
  | 'researching'
  | 'paused'
  | 'idle'
  | 'provider_error'

/** Subset used for round-robin orchestration (cloud + optional local agents). */
export type CouncilOrchestrationFamily =
  | 'chatgpt'
  | 'claude'
  | 'grok'
  | 'gemini'
  | 'red_team'
  | 'baby'
  | 'kimi'
  | 'bridge_architect'

export type CouncilMemoryRecallPreview = {
  label: string
  resultCount: number
  topItems: string[]
  latestTimestamp: string | null
  commandKind: string
}

export type PersistedCouncilMessage = {
  id: string
  familyName: string
  content: string
  timestamp: string
  color: string
  icon: string
  provider: string
  messageType: string
  recallPreview?: CouncilMemoryRecallPreview
}

export type CouncilCooldownMap = Partial<Record<CouncilOrchestrationFamily, number>>

export type CouncilPersistedV1 = {
  v: 1
  sessionId: string
  councilState: CouncilLifecycleState
  lastActivityAt: number
  messages: PersistedCouncilMessage[]
  deepDiscussionMode: boolean
  consecutiveAutonomousCount: number
  lastSpeakerFamily: CouncilOrchestrationFamily | null
  /** Epoch ms — reserved for per-family throttle extensions */
  cooldownUntil: CouncilCooldownMap
  isAwaitingResponses: boolean
  requiresRaelForAutonomous: boolean
  providerErrorMessage: string | null
  /** Last two orchestration speakers (most recent last) for cooldown */
  recentOrchestrationSpeakers: CouncilOrchestrationFamily[]
  /** Monotonic counter for deterministic red-team cadence */
  autonomousRoundIndex: number
  /** Last normalized content hash per family (duplicate debounce) */
  lastContentHashByFamily: Partial<Record<CouncilOrchestrationFamily, string>>
  councilChannelOpen: boolean
}
