/**
 * War Room self-audit categories and runtime context (UI/state only).
 */

import type { CanonicalGapSnapshot } from '../gapFinder'
import type { CouncilMessageLike } from '../copyCouncilText'
import type { GapVerificationContext } from '../gapVerification'

export type SelfAuditCategory =
  | 'Broken/Silent UI'
  | 'Confusing Labels'
  | 'Duplicate Features'
  | 'Placeholder Values'
  | 'Old Diagnostics'
  | 'Mobile Layout Risk'
  | 'Provider Usability'
  | 'Revenue Readiness'
  | 'Memory Usefulness'
  | 'Over-Orchestration Risk'

export type SelfAuditFindingKind =
  | 'issue'
  | 'suggestion'
  | 'duplicate'
  | 'placeholder'
  | 'mobile'
  | 'revenue'

export type SelfAuditContext = {
  visibleMessages: CouncilMessageLike[]
  hiddenMessageCount?: number
  collapsedNoiseCount?: number
  councilPaused?: boolean
  councilFlowMode?: string
  showOldDiagnostics?: boolean
  canonicalStatus?: CanonicalGapSnapshot | null
  canonicalStatusUnavailable?: boolean
  viewportNarrow?: boolean
  viewportWidthPx?: number
  activeDockPanelId?: string | null
  gapVerification?: GapVerificationContext
  evolutionReadinessScore?: number | null
  internetUsable?: boolean
  chatHealthLabel?: string
  persistenceHealthLabel?: string
  providerConnection?: Partial<Record<string, 'online' | 'standby' | 'error' | 'not_connected'>>
  /** UI surfaces that advertise incomplete wiring. */
  silentUi?: {
    archiveRecallNotConnected?: boolean
    repoScanPlaceholders?: boolean
  }
  /** Operator-visible labels scanned for jargon. */
  operatorLabels?: string[]
  revenue?: {
    opportunityCount?: number
    paidOpportunityCount?: number
    scoutStatus?: string
    scoutError?: boolean
  }
  memory?: {
    memoryCount?: number
    persistenceAvailable?: boolean
    runtimeLabel?: string
    sessionOnly?: boolean
  }
  orchestration?: {
    recentCouncilTriggers?: number
    councilStabilityMode?: boolean
  }
  /** Gap ids Commander dismissed as not important (excluded from open count). */
  commanderDismissedIds?: Partial<Record<string, string>>
}
