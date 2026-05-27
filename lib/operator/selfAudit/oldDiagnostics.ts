import { isOldOperatorDiagnosticMessage } from '@/lib/war-room/operatorDiagnosticsUi'
import type { OperatorGap } from '../gapFinder'
import { KNOWN_GAP_IDS } from '../gapVerification'
import { selfAuditGap } from './gapFactory'
import type { SelfAuditContext } from './types'

export function auditOldDiagnostics(ctx: SelfAuditContext): OperatorGap[] {
  const gaps: OperatorGap[] = []
  const visible = ctx.visibleMessages ?? []
  const filtered = ctx.showOldDiagnostics
    ? visible
    : visible.filter(
        m =>
          !isOldOperatorDiagnosticMessage({
            content: m.content,
            messageType: m.messageType,
            degraded: m.degraded,
          }),
      )

  const legacyVisible = visible.filter(m =>
    isOldOperatorDiagnosticMessage({
      content: m.content,
      messageType: m.messageType,
      degraded: m.degraded,
    }),
  )

  if (ctx.showOldDiagnostics && legacyVisible.length > 0) {
    gaps.push(
      selfAuditGap({
        id: KNOWN_GAP_IDS.OLD_DIAGNOSTICS_UX,
        title: 'Old diagnostic notices visible',
        plainLanguage: 'Legacy fallback and diagnostic lines are shown in the live council thread.',
        meaning: 'Operator turned on “Show old diagnostics” — expect extra noise.',
        area: 'Live Council',
        category: 'Old Diagnostics',
        kind: 'issue',
        severity: 'low',
        recommendedFix: 'Turn off “Show old diagnostics” in operator live view (default hides legacy noise).',
        cursorCommand:
          'Review isOldOperatorDiagnosticMessage filtering in app/page.tsx MessageBubble; keep history without live noise.',
      }),
    )
  }

  if (!ctx.showOldDiagnostics && legacyVisible.length > 0 && filtered.length < visible.length) {
    gaps.push(
      selfAuditGap({
        id: 'self-audit-old-diagnostics-hidden-count',
        title: 'Old diagnostics hidden from live view',
        plainLanguage: `${legacyVisible.length} legacy diagnostic line(s) are filtered — use archive copy for full history.`,
        meaning: 'Hygiene filter is active; degraded/fallback lines exist but are muted.',
        area: 'Live Council',
        category: 'Old Diagnostics',
        kind: 'suggestion',
        severity: 'low',
        recommendedFix: 'No action if intentional; toggle Show old diagnostics to inspect legacy lines.',
        cursorCommand: 'Confirm operatorDiagnosticsUi patterns stay aligned with council thread hygiene.',
      }),
    )
  }

  if (/fallback|degraded|unavailable/i.test(filtered.map(m => m.content).join('\n'))) {
    gaps.push(
      selfAuditGap({
        id: 'self-audit-diagnostics-language-in-thread',
        title: 'Diagnostic language still in visible transcript',
        plainLanguage: 'Words like fallback, degraded, or unavailable appear in messages operators still see.',
        meaning: 'Even with filters, some diagnostic phrasing remains in the visible slice.',
        area: 'Live Council',
        category: 'Old Diagnostics',
        kind: 'suggestion',
        severity: 'low',
        recommendedFix: 'Clear noise after fixing root cause; verify provider health.',
        cursorCommand: 'Tune OLD_OPERATOR_DIAGNOSTIC_PATTERNS in operatorDiagnosticsUi.ts if false positives appear.',
      }),
    )
  }

  return gaps
}
