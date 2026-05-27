/**
 * Operator-safe gap heuristics from UI state and lightweight runtime snapshots.
 * No provider completion calls — inspects canonical status JSON when supplied.
 */

import type { CouncilMessageLike } from './copyCouncilText'

export type GapCategory =
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

export type GapSeverity = 'low' | 'medium' | 'high'

export type OperatorGap = {
  id: string
  title: string
  meaning: string
  area: string
  category: GapCategory
  severity: GapSeverity
  recommendedFix: string
  cursorCommand: string
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
  hideOldDiagnostics?: boolean
  canonicalStatus?: CanonicalGapSnapshot | null
  canonicalStatusUnavailable?: boolean
  internetUsable?: boolean
  evolutionReadinessScore?: number | null
  viewportNarrow?: boolean
}

function gap(
  partial: Omit<OperatorGap, 'id'> & { id?: string },
): OperatorGap {
  return {
    id: partial.id ?? `${partial.category}-${partial.title}`.replace(/\s+/g, '-').toLowerCase(),
    ...partial,
  }
}

export function findOperatorGaps(ctx: GapFinderContext): OperatorGap[] {
  const gaps: OperatorGap[] = []
  const visible = ctx.visibleMessages ?? []

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

  const degradedVisible = visible.filter(m => m.degraded && m.messageType === 'response')
  if (degradedVisible.length > 0) {
    gaps.push(
      gap({
        title: 'Degraded family responses visible',
        meaning: `${degradedVisible.length} response(s) marked degraded — excluded from synthesis/repair.`,
        area: 'Council quality',
        category: 'Placeholder confidence',
        severity: 'high',
        recommendedFix: 'Retry providers, reduce load, or switch council flow mode; hide old diagnostics if noise.',
        cursorCommand:
          'Inspect lib/council/councilRenderGate.ts and provider health; fix truncation/integrity before operator relies on answers.',
      }),
    )
  }

  if (ctx.councilPaused) {
    gaps.push(
      gap({
        title: 'Council session paused',
        meaning: 'Orchestration is paused; families will not advance until resumed.',
        area: 'Session controls',
        category: 'Confusing UI',
        severity: 'medium',
        recommendedFix: 'Click Resume in session controls when ready to continue.',
        cursorCommand: 'Verify pauseCouncil/resumeCouncil UX copy near session controls in app/page.tsx.',
      }),
    )
  }

  if (ctx.hideOldDiagnostics === false && visible.some(m => /fallback|degraded|unavailable/i.test(m.content))) {
    gaps.push(
      gap({
        title: 'Old diagnostic notices visible',
        meaning: 'Legacy fallback/diagnostic lines may clutter the live council thread.',
        area: 'Live Council',
        category: 'Old diagnostics',
        severity: 'low',
        recommendedFix: 'Enable "Hide old diagnostics" in operator live view.',
        cursorCommand:
          'Review isOldOperatorDiagnosticMessage filtering in app/page.tsx MessageBubble; keep history without live noise.',
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

  for (const row of ctx.canonicalStatus?.providers ?? []) {
    const avail = (row.availability ?? '').toUpperCase()
    if (avail === 'NOT_CONFIGURED' || row.configured === false) {
      gaps.push(
        gap({
          title: `${row.label ?? row.family} not configured`,
          meaning: 'Provider family lacks API configuration for live council calls.',
          area: 'Providers',
          category: 'Missing API key',
          severity: 'high',
          recommendedFix: `Configure ${row.family} keys in environment/settings; refresh canonical status.`,
          cursorCommand: `Verify env keys for ${row.family} and /api/runtime/canonical-status reflects CONFIGURED.`,
        }),
      )
    } else if (avail === 'RATE_LIMITED') {
      gaps.push(
        gap({
          title: `${row.label ?? row.family} rate limited`,
          meaning: 'Provider returned quota/rate limit signals.',
          area: 'Providers',
          category: 'Quota',
          severity: 'high',
          recommendedFix: 'Wait for quota reset or reduce parallel council load.',
          cursorCommand: `Check provider quota handling for ${row.family}; surface operator-friendly retry in Live Council.`,
        }),
      )
    } else if (avail === 'INVALID_KEY') {
      gaps.push(
        gap({
          title: `${row.label ?? row.family} invalid API key`,
          meaning: 'Canonical status reports invalid key for this family.',
          area: 'Providers',
          category: 'Missing API key',
          severity: 'high',
          recommendedFix: 'Rotate or fix API key in environment; reload provider health.',
          cursorCommand: `Fix ${row.family} credentials; confirm lib/runtime/canonicalStatus maps INVALID_KEY.`,
        }),
      )
    } else if (row.health === 'unavailable' || row.connectionStatus === 'error') {
      gaps.push(
        gap({
          title: `${row.label ?? row.family} unavailable`,
          meaning: 'Family cannot be reached with current runtime configuration.',
          area: 'Providers',
          category: 'Broken action',
          severity: 'high',
          recommendedFix: 'Open System Health → AI Team Status and follow recovery steps.',
          cursorCommand: `Diagnose ${row.family} in ProviderRuntimePanel without changing council routing.`,
        }),
      )
    }
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
        title: 'Internet tools not usable',
        meaning: 'Live research / internet layer reports unavailable.',
        area: 'Command Intel',
        category: 'Not wired',
        severity: 'medium',
        recommendedFix: 'Configure internet tools (Tavily/Firecrawl) per tools status panel.',
        cursorCommand: 'Verify /api/tools/internet/status and operator env for research tools.',
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

  if (ctx.viewportNarrow) {
    gaps.push(
      gap({
        title: 'Narrow viewport — dock panels overlap council',
        meaning: 'On small screens, feature dock and console reduce council readable area.',
        area: 'Layout',
        category: 'Mobile layout',
        severity: 'low',
        recommendedFix: 'Close dock panels; use landscape or desktop for long transcripts.',
        cursorCommand: 'Audit live-room-shell CSS padding and touch targets under 640px.',
      }),
    )
  }

  const severityRank: Record<GapSeverity, number> = { high: 0, medium: 1, low: 2 }
  return gaps.sort((a, b) => severityRank[a.severity] - severityRank[b.severity])
}

export function formatGapReport(gaps: OperatorGap[]): string {
  const lines = [
    '# War Room Operator Gap Report',
    `Generated: ${new Date().toISOString()}`,
    `Gaps found: ${gaps.length}`,
    '',
  ]
  gaps.forEach((g, index) => {
    lines.push(`## ${index + 1}. ${g.title} [${g.severity}]`)
    lines.push(`Category: ${g.category}`)
    lines.push(`Area: ${g.area}`)
    lines.push(`Meaning: ${g.meaning}`)
    lines.push(`Recommended fix: ${g.recommendedFix}`)
    lines.push(`Cursor command: ${g.cursorCommand}`)
    lines.push('')
  })
  return lines.join('\n').trim()
}

export function topGapCursorCommand(gaps: OperatorGap[]): string | null {
  return gaps[0]?.cursorCommand ?? null
}
