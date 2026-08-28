/**
 * Operator-safe gap heuristics from UI state and lightweight runtime snapshots.
 * No provider completion calls — inspects canonical status JSON when supplied.
 */

import type { CouncilMessageLike } from './copyCouncilText'
import {
  KNOWN_GAP_IDS,
  verifyKnownGaps,
  type GapVerificationContext,
  type KnownGapId,
} from './gapVerification'
import { isOldOperatorDiagnosticMessage } from '@/lib/war-room/operatorDiagnosticsUi'
import { gapFinderToSelfAuditContext } from './selfAudit/context'
import { mergeCanonicalGaps } from './canonicalIssues'
import {
  applyCommanderDismissals,
  countActionableOpenGaps,
  mergeSelfAuditWithLegacyGaps,
} from './selfAudit/merge'
import { runSelfAudit } from './selfAudit/run'
import type { SelfAuditCategory, SelfAuditFindingKind } from './selfAudit/types'

/** Legacy gap categories (pre–Phase 43); retained for older findings. */
export type LegacyGapCategory =
  | 'Not wired'
  | 'Confusing UI'
  | 'Broken action'
  | 'Missing API key'
  | 'Quota'
  | 'Missing data'
  | 'Missing copy tool'
  | 'Placeholder confidence'
  | 'Mobile layout'
  | 'Old diagnostics'

export type GapCategory = LegacyGapCategory | SelfAuditCategory

export type GapSeverity = 'low' | 'medium' | 'high'

export type GapStatus = 'open' | 'fixed' | 'needs_review'

export const COMMANDER_MANUAL_FIX_EVIDENCE =
  'Commander marked fixed manually — not automatically verified.'

export type OperatorGap = {
  id: string
  title: string
  /** Plain-language summary for Commander (no jargon). */
  plainLanguage: string
  meaning: string
  area: string
  category: GapCategory
  kind?: SelfAuditFindingKind
  severity: GapSeverity
  recommendedFix: string
  cursorCommand: string
  status: GapStatus
  fixedAt?: string | null
  verificationEvidence?: string[]
  lastCheckedAt?: string
  /** Populated when multiple audit paths reported the same canonical issue. */
  mergedSources?: string[]
}

export type CanonicalGapSnapshot = {
  providers?: {
    family: string
    label?: string
    configured?: boolean
    availability?: string
    health?: string
    connectionStatus?: string
  }[]
  subsystems?: {
    id: string
    label?: string
    health?: string
    missingEvidence?: string[]
  }[]
  summary?: {
    health?: string
    degradedSubsystems?: string[]
    unavailableSubsystems?: string[]
  }
}

export type GapFinderContext = {
  visibleMessages: CouncilMessageLike[]
  hiddenMessageCount?: number
  collapsedNoiseCount?: number
  providerConnection?: Partial<Record<string, 'online' | 'standby' | 'error' | 'not_connected'>>
  chatHealthLabel?: string
  persistenceHealthLabel?: string
  councilPaused?: boolean
  councilFlowMode?: string
  showOldDiagnostics?: boolean
  canonicalStatus?: CanonicalGapSnapshot | null
  canonicalStatusUnavailable?: boolean
  internetUsable?: boolean
  evolutionReadinessScore?: number | null
  viewportNarrow?: boolean
  viewportWidthPx?: number
  activeDockPanelId?: string | null
  gapVerification?: GapVerificationContext
  /** Gap id → ISO timestamp when Commander marked fixed manually. */
  commanderManualFixedAt?: Partial<Record<string, string>>
  /** Gap id → ISO timestamp when Commander marked not important. */
  commanderDismissedIds?: Partial<Record<string, string>>
  silentUi?: {
    archiveRecallNotConnected?: boolean
    repoScanPlaceholders?: boolean
  }
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
}

function gap(
  partial: Omit<OperatorGap, 'id' | 'status' | 'plainLanguage'> & {
    id?: string
    status?: GapStatus
    plainLanguage?: string
  },
): OperatorGap {
  return {
    id: partial.id ?? `${partial.category}-${partial.title}`.replace(/\s+/g, '-').toLowerCase(),
    status: partial.status ?? 'open',
    plainLanguage: partial.plainLanguage ?? partial.meaning,
    ...partial,
  }
}

function isKnownGapId(id: string): id is KnownGapId {
  return (
    id === KNOWN_GAP_IDS.OLD_DIAGNOSTICS_UX ||
    id === KNOWN_GAP_IDS.ARCHIVE_COPY_CLARITY ||
    id === KNOWN_GAP_IDS.ARCHIVE_RECALL_NOT_WIRED
  )
}

function verificationMap(ctx: GapFinderContext): Map<string, { verified: boolean; evidence: string[] }> {
  if (!ctx.gapVerification) return new Map()
  return new Map(verifyKnownGaps(ctx.gapVerification).map(row => [row.gapId, row]))
}

/** Apply verification + Commander overrides; never auto-fix without evidence. */
export function applyGapVerification(gaps: OperatorGap[], ctx: GapFinderContext): OperatorGap[] {
  const checkedAt = new Date().toISOString()
  const verifiedById = verificationMap(ctx)
  const manual = ctx.commanderManualFixedAt ?? {}

  return gaps.map(item => {
    const lastCheckedAt = checkedAt
    const manualAt = manual[item.id]
    if (manualAt) {
      return {
        ...item,
        status: 'needs_review' as const,
        fixedAt: manualAt,
        verificationEvidence: [COMMANDER_MANUAL_FIX_EVIDENCE],
        lastCheckedAt,
      }
    }

    if (!isKnownGapId(item.id)) {
      return { ...item, status: item.status ?? 'open', lastCheckedAt }
    }

    const verification = verifiedById.get(item.id)
    if (verification?.verified && verification.evidence.length > 0) {
      return {
        ...item,
        status: 'fixed' as const,
        fixedAt: checkedAt,
        verificationEvidence: verification.evidence,
        lastCheckedAt,
      }
    }

    return { ...item, status: 'open' as const, lastCheckedAt }
  })
}

const KNOWN_GAP_DISPLAY: Record<
  KnownGapId,
  Omit<OperatorGap, 'id' | 'status' | 'fixedAt' | 'verificationEvidence' | 'lastCheckedAt'>
> = {
  [KNOWN_GAP_IDS.OLD_DIAGNOSTICS_UX]: {
    title: 'Old diagnostic notices visible',
    plainLanguage: 'Old fallback and diagnostic lines are visible in the live council thread.',
    meaning: 'Legacy fallback/diagnostic lines may clutter the live council thread.',
    area: 'Live Council',
    category: 'Old diagnostics',
    severity: 'low',
    recommendedFix: 'Turn off "Show old diagnostics" in operator live view (default hides legacy noise).',
    cursorCommand:
      'Review isOldOperatorDiagnosticMessage filtering in app/page.tsx MessageBubble; keep history without live noise.',
  },
  [KNOWN_GAP_IDS.ARCHIVE_COPY_CLARITY]: {
    title: 'Older messages hidden from live view',
    plainLanguage: 'Some messages are hidden from the live view — use Copy Session for the full transcript.',
    meaning: 'Messages are archived from the visible log — copy/archive UX must be clear.',
    area: 'Live Council',
    category: 'Confusing UI',
    severity: 'low',
    recommendedFix: 'Use View Archive or Copy Session for full transcript; Copy Visible Log only covers on-screen rows.',
    cursorCommand:
      'Document in operator UI that Copy Visible Log uses visibleCouncilMessages only; link to archive recall if needed.',
  },
  [KNOWN_GAP_IDS.ARCHIVE_RECALL_NOT_WIRED]: {
    title: 'Archive recall not connected',
    plainLanguage: 'View Archive does not load hidden transcript rows yet.',
    meaning: 'Archive recall control is visible but not wired to a transcript viewer.',
    area: 'Live Council',
    category: 'Broken/Silent UI',
    severity: 'medium',
    recommendedFix: 'Wire Archive Viewer or disable the control until recall is available.',
    cursorCommand: 'Wire View Archive to client-side ArchiveViewer or disable with Copy Session hint.',
  },
}

function injectVerifiedFixedKnownGaps(gaps: OperatorGap[], ctx: GapFinderContext): OperatorGap[] {
  const verifiedById = verificationMap(ctx)
  const present = new Set(gaps.map(g => g.id))
  const injected: OperatorGap[] = []
  for (const gapId of Object.values(KNOWN_GAP_IDS)) {
    if (present.has(gapId)) continue
    const verification = verifiedById.get(gapId)
    if (!verification?.verified || verification.evidence.length === 0) continue
    if (gapId === KNOWN_GAP_IDS.ARCHIVE_COPY_CLARITY && (ctx.hiddenMessageCount ?? 0) === 0) continue
    injected.push(
      gap({
        id: gapId,
        ...KNOWN_GAP_DISPLAY[gapId],
        status: 'fixed',
        fixedAt: new Date().toISOString(),
        verificationEvidence: verification.evidence,
        lastCheckedAt: new Date().toISOString(),
      }),
    )
  }
  return [...gaps, ...injected]
}

export function resolveOperatorGaps(ctx: GapFinderContext): OperatorGap[] {
  const legacy = findOperatorGaps(ctx)
  const selfAudit = runSelfAudit(gapFinderToSelfAuditContext(ctx))
  const merged = mergeSelfAuditWithLegacyGaps(legacy, selfAudit)
  const withStatus = applyGapVerification(merged, ctx)
  const withDismissals = applyCommanderDismissals(withStatus, ctx.commanderDismissedIds)
  return mergeCanonicalGaps(injectVerifiedFixedKnownGaps(withDismissals, ctx))
}

export function countOpenOperatorGaps(gaps: OperatorGap[]): number {
  return countActionableOpenGaps(gaps)
}

function visibleForGapScan(messages: CouncilMessageLike[], showOldDiagnostics?: boolean): CouncilMessageLike[] {
  if (showOldDiagnostics) return messages
  return messages.filter(
    m =>
      !isOldOperatorDiagnosticMessage({
        content: m.content,
        messageType: m.messageType,
        degraded: m.degraded,
      }),
  )
}

export function findOperatorGaps(ctx: GapFinderContext): OperatorGap[] {
  const gaps: OperatorGap[] = []
  const visible = visibleForGapScan(ctx.visibleMessages ?? [], ctx.showOldDiagnostics)

  if (!visible.some(m => m.messageType === 'decree' || /rael/i.test(m.familyName))) {
    gaps.push(
      gap({
        title: 'No visible decree in live window',
        meaning: 'The operator cannot see a commander decree in the current transcript slice.',
        area: 'Live Council',
        category: 'Missing data',
        severity: 'medium',
        recommendedFix: 'Send a decree from the command console or scroll/archive recall if history is hidden.',
        cursorCommand:
          'In app/page.tsx Live Council, verify visible message windowing and decree messageType tagging; ensure latest decree is not archived from view.',
      }),
    )
  }

  if ((ctx.hiddenMessageCount ?? 0) > 0) {
    gaps.push(
      gap({
        id: KNOWN_GAP_IDS.ARCHIVE_COPY_CLARITY,
        title: 'Older messages hidden from live view',
        meaning: `${ctx.hiddenMessageCount} messages are archived from the visible log.`,
        area: 'Live Council',
        category: 'Confusing UI',
        severity: 'low',
        recommendedFix: 'Use View Archive or Copy Session for full transcript; Copy Visible Log only covers on-screen rows.',
        cursorCommand:
          'Document in operator UI that Copy Visible Log uses visibleCouncilMessages only; link to archive recall if needed.',
      }),
    )
  }

  if ((ctx.collapsedNoiseCount ?? 0) > 3) {
    gaps.push(
      gap({
        title: 'High collapsed noise count',
        meaning: `${ctx.collapsedNoiseCount} repeated notices collapsed — underlying issue may persist.`,
        area: 'Live Council',
        category: 'Confusing UI',
        severity: 'medium',
        recommendedFix: 'Clear noise after fixing root cause; inspect System Health for repeating errors.',
        cursorCommand: 'Trace applyCouncilThreadHygiene collapsed keys in app/page.tsx for repeating system messages.',
      }),
    )
  }

  if (!ctx.canonicalStatus && ctx.canonicalStatusUnavailable) {
    gaps.push(
      gap({
        title: 'Canonical runtime status unavailable',
        meaning: 'Gap finder could not load /api/runtime/canonical-status.',
        area: 'System Health',
        category: 'Missing data',
        severity: 'medium',
        recommendedFix: 'Ensure dev server is running; open System Health and refresh runtime.',
        cursorCommand: 'Inspect app/api/runtime/canonical-status route and client fetch error handling.',
      }),
    )
  }

  for (const sub of ctx.canonicalStatus?.subsystems ?? []) {
    if (sub.health === 'unavailable') {
      gaps.push(
        gap({
          title: `Subsystem unavailable: ${sub.label ?? sub.id}`,
          meaning: 'Canonical subsystem probe reports unavailable.',
          area: 'Runtime',
          category: 'Not wired',
          severity: 'high',
          recommendedFix: 'Open System Health and follow subsystem recovery list.',
          cursorCommand: `Wire or repair subsystem ${sub.id} per lib/runtime/canonicalStatus collectors.`,
        }),
      )
    }
  }

  if (ctx.chatHealthLabel && !/ready|ok|steady/i.test(ctx.chatHealthLabel)) {
    gaps.push(
      gap({
        title: `Chat health: ${ctx.chatHealthLabel}`,
        meaning: 'Live council chat health strip is not in a ready state.',
        area: 'Live Council',
        category: 'Broken action',
        severity: 'medium',
        recommendedFix: 'Check provider errors, paused state, and pending continuations.',
        cursorCommand: 'Trace chatHealthLabel computation in app/page.tsx; align with councilSnapRef state.',
      }),
    )
  }

  if (ctx.internetUsable === false) {
    gaps.push(
      gap({
        title: 'Optional live research source — not required for Stable Group Chat',
        meaning: 'Live research tools are not active. Stable Group Chat still works without them.',
        area: 'Command Intel',
        category: 'Not wired',
        severity: 'low',
        recommendedFix:
          'No action required for Stable Group Chat. Enable live research only when you need web-backed intel.',
        cursorCommand:
          'UI-only: gapFinder internet tools entry is informational; do not block council or configure Tavily/Firecrawl from this gap.',
      }),
    )
  }

  if (ctx.evolutionReadinessScore != null && ctx.evolutionReadinessScore < 50) {
    gaps.push(
      gap({
        title: 'Low evolution readiness score',
        meaning: `Repair intelligence readiness is ${ctx.evolutionReadinessScore}% — follow System Health evolution panel.`,
        area: 'System Health',
        category: 'Missing data',
        severity: 'medium',
        recommendedFix: 'Run OS/schema sweep from System Health when approved.',
        cursorCommand: 'Use War Room Evolution panel actions; no autonomous file mutation.',
      }),
    )
  }

  const severityRank: Record<GapSeverity, number> = { high: 0, medium: 1, low: 2 }
  return gaps.sort((a, b) => severityRank[a.severity] - severityRank[b.severity])
}

export function formatGapReport(gaps: OperatorGap[]): string {
  const open = gaps.filter(g => g.status === 'open')
  const fixed = gaps.filter(g => g.status === 'fixed')
  const needsReview = gaps.filter(g => g.status === 'needs_review')
  const lines = [
    '# War Room Operator Gap Report',
    `Generated: ${new Date().toISOString()}`,
    `Open: ${open.length} · Fixed: ${fixed.length} · Needs review: ${needsReview.length}`,
    '',
  ]
  const appendSection = (title: string, items: OperatorGap[]) => {
    if (!items.length) return
    lines.push(`### ${title}`)
    items.forEach((g, index) => {
      lines.push(`## ${index + 1}. ${g.title} [${g.severity}] · ${g.status}`)
      lines.push(`Category: ${g.category}`)
      lines.push(`Area: ${g.area}`)
      lines.push(`Plain language: ${g.plainLanguage}`)
      lines.push(`Meaning: ${g.meaning}`)
      lines.push(`Recommended fix: ${g.recommendedFix}`)
      lines.push(`Cursor command: ${g.cursorCommand}`)
      if (g.mergedSources && g.mergedSources.length > 1) {
        lines.push(`Merged sources: ${g.mergedSources.join(' · ')}`)
      }
      if (g.verificationEvidence?.length) {
        lines.push(`Verification: ${g.verificationEvidence.join('; ')}`)
      }
      if (g.fixedAt) lines.push(`Fixed at: ${g.fixedAt}`)
      lines.push('')
    })
  }
  appendSection('Open gaps', open)
  appendSection('Fixed gaps', fixed)
  appendSection('Needs review', needsReview)
  if (!gaps.length) lines.push('No gaps detected with current heuristics.')
  return lines.join('\n').trim()
}

export function topGapCursorCommand(gaps: OperatorGap[]): string | null {
  return gaps.find(g => g.status === 'open')?.cursorCommand ?? null
}
