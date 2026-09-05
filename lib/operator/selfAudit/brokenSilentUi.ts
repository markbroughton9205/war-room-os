import { CANONICAL_ISSUE_IDS } from '../canonicalIssues'
import type { OperatorGap } from '../gapFinder'
import { selfAuditGap } from './gapFactory'
import type { SelfAuditContext } from './types'

export function auditBrokenSilentUi(ctx: SelfAuditContext): OperatorGap[] {
  const gaps: OperatorGap[] = []
  const silent = ctx.silentUi ?? {}

  if (silent.archiveRecallNotConnected) {
    gaps.push(
      selfAuditGap({
        id: CANONICAL_ISSUE_IDS.ARCHIVE_RECALL_NOT_WIRED,
        title: 'Archive recall not connected',
        plainLanguage: 'The archive recall action tells you it is not connected yet.',
        meaning: 'View Archive / recall path is advertised but does not load hidden transcript rows.',
        area: 'Live Council',
        category: 'Broken/Silent UI',
        kind: 'issue',
        severity: 'medium',
        recommendedFix: 'Use Copy Session for the full transcript until recall is wired.',
        cursorCommand:
          'Wire archive recall in app/page.tsx or remove the control until session recall API exists.',
      }),
    )
  }

  if (silent.repoScanPlaceholders) {
    gaps.push(
      selfAuditGap({
        id: 'self-audit-repo-scan-placeholders',
        title: 'Repo scan build/deploy status placeholders',
        plainLanguage: 'Engineering repo scan still shows “not connected” for build and deploy.',
        meaning: 'Settings repo scan does not surface real CI/CD telemetry yet.',
        area: 'Settings',
        category: 'Broken/Silent UI',
        kind: 'suggestion',
        severity: 'low',
        recommendedFix: 'Treat repo scan as advisory until CI hooks are wired.',
        cursorCommand: 'Replace placeholder strings in app/api/repo/scan/route.ts when CI integration exists.',
      }),
    )
  }

  const notConnectedProviders = Object.entries(ctx.providerConnection ?? {}).filter(
    ([, status]) => status === 'not_connected',
  )
  if (notConnectedProviders.length > 0) {
    gaps.push(
      selfAuditGap({
        id: 'self-audit-provider-strip-not-connected',
        title: 'Families show not connected in council strip',
        plainLanguage: `${notConnectedProviders.length} provider(s) read as not connected in the live UI.`,
        meaning: 'Council member strip or health labels show disconnected families.',
        area: 'Live Council',
        category: 'Broken/Silent UI',
        kind: 'issue',
        severity: 'medium',
        recommendedFix: 'Open System Health → AI Team Status; configure keys or wait for health refresh.',
        cursorCommand:
          'Align providerHealth.providers labels in app/page.tsx with canonical-status without auto-invoking completions.',
      }),
    )
  }

  return gaps
}
