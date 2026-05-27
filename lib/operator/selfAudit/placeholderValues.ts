import type { OperatorGap } from '../gapFinder'
import { selfAuditGap } from './gapFactory'
import type { SelfAuditContext } from './types'

export function auditPlaceholderValues(ctx: SelfAuditContext): OperatorGap[] {
  const gaps: OperatorGap[] = []
  const visible = ctx.visibleMessages ?? []

  const degradedResponses = visible.filter(m => m.degraded && m.messageType === 'response')
  if (degradedResponses.length > 0) {
    gaps.push(
      selfAuditGap({
        id: 'self-audit-placeholder-degraded-responses',
        title: 'Degraded council answers on screen',
        plainLanguage: `${degradedResponses.length} answer(s) are marked lower quality and should not drive decisions.`,
        meaning: 'Degraded placeholders remain visible in the live council window.',
        area: 'Live Council',
        category: 'Placeholder Values',
        kind: 'placeholder',
        severity: 'high',
        recommendedFix: 'Retry providers or switch to Stable Group Chat; hide old diagnostics if noisy.',
        cursorCommand:
          'Inspect councilRenderGate and responseIntegrity placeholders — UI should label them as non-authoritative.',
      }),
    )
  }

  const unavailableLines = visible.filter(m =>
    /temporarily unavailable|placeholder|not connected yet|nominal/i.test(m.content),
  )
  if (unavailableLines.length > 0) {
    gaps.push(
      selfAuditGap({
        id: 'self-audit-placeholder-unavailable-copy',
        title: '“Unavailable” or placeholder copy in transcript',
        plainLanguage: `${unavailableLines.length} line(s) say unavailable, placeholder, or nominal — not live data.`,
        meaning: 'Council or system lines still expose stub phrasing to the operator.',
        area: 'Live Council',
        category: 'Placeholder Values',
        kind: 'placeholder',
        severity: 'medium',
        recommendedFix: 'Fix upstream provider/subsystem or collapse noise after root cause is resolved.',
        cursorCommand: 'Search operator transcript for temporarily unavailable / nominal placeholders.',
      }),
    )
  }

  for (const row of ctx.canonicalStatus?.providers ?? []) {
    if (row.health === 'degraded' || (row.availability ?? '').toUpperCase() === 'DEGRADED') {
      gaps.push(
        selfAuditGap({
          id: `self-audit-placeholder-provider-${row.family}`,
          title: `${row.label ?? row.family} in degraded state`,
          plainLanguage: `${row.label ?? row.family} is up but not fully trusted for council work.`,
          meaning: 'Canonical status reports degraded provider usability.',
          area: 'Providers',
          category: 'Placeholder Values',
          kind: 'placeholder',
          severity: 'medium',
          recommendedFix: 'Read degraded reason in AI Team Status; avoid synthesis until healthy.',
          cursorCommand: `Surface ${row.family} degradedReason in ProviderRuntimePanel without new API calls.`,
        }),
      )
    }
  }

  return gaps
}
