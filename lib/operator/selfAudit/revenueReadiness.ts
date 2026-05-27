import { CANONICAL_ISSUE_IDS } from '../canonicalIssues'
import type { OperatorGap } from '../gapFinder'
import { selfAuditGap } from './gapFactory'
import type { SelfAuditContext } from './types'

export function auditRevenueReadiness(ctx: SelfAuditContext): OperatorGap[] {
  const gaps: OperatorGap[] = []
  const rev = ctx.revenue ?? {}
  const count = rev.opportunityCount ?? 0
  const paid = rev.paidOpportunityCount ?? 0

  if (count === 0) {
    gaps.push(
      selfAuditGap({
        id: CANONICAL_ISSUE_IDS.NO_INCOME_OPPORTUNITIES,
        title: 'No income opportunities tracked',
        plainLanguage: 'The operations deck has no opportunities yet — revenue lane is empty.',
        meaning: 'Operator deck / Opportunity Scout has zero rows.',
        area: 'Operations',
        category: 'Revenue Readiness',
        kind: 'revenue',
        severity: 'medium',
        recommendedFix: 'Run Opportunity Scout from Operations or register a lead manually.',
        cursorCommand: 'UI-only: surface OpportunityScoutPanel CTA when opportunity list is empty.',
      }),
    )
  }

  if (count > 0 && paid === 0) {
    gaps.push(
      selfAuditGap({
        id: CANONICAL_ISSUE_IDS.REVENUE_NO_PAID,
        title: 'Opportunities tracked but none paid',
        plainLanguage: `${count} opportunity(ies) exist but none are marked paid yet.`,
        meaning: 'Pipeline exists without closed-won signal in operator deck.',
        area: 'Operations',
        category: 'Revenue Readiness',
        kind: 'revenue',
        severity: 'low',
        recommendedFix: 'Update status when payouts land; use Outcome Ledger for proof.',
        cursorCommand: 'Add operator hint on paid vs active counts in revenue summary strip.',
      }),
    )
  }

  if (rev.scoutError) {
    gaps.push(
      selfAuditGap({
        id: CANONICAL_ISSUE_IDS.OPPORTUNITY_SCOUT_ERROR,
        title: 'Opportunity Scout last run failed',
        plainLanguage: 'Scout could not finish — new leads may be stale.',
        meaning: 'OpportunityScoutState reports error.',
        area: 'Operations',
        category: 'Revenue Readiness',
        kind: 'revenue',
        severity: 'medium',
        recommendedFix: 'Retry scout from Operations; check network and API keys.',
        cursorCommand: 'Inspect OpportunityScout error handling in app/page.tsx (no auto scout API spam).',
      }),
    )
  }

  if (rev.scoutStatus === 'idle' && count === 0) {
    gaps.push(
      selfAuditGap({
        id: CANONICAL_ISSUE_IDS.OPPORTUNITY_SCOUT_IDLE,
        title: 'Opportunity Scout never run this session',
        plainLanguage: 'Scout is idle and there are no opportunities — revenue intel has not started.',
        meaning: 'No scout activity in current session.',
        area: 'Operations',
        category: 'Revenue Readiness',
        kind: 'revenue',
        severity: 'low',
        recommendedFix: 'Open Operations → Scout Opportunities when ready.',
        cursorCommand: 'Operator playbook only — no automatic scout invocation from self-audit.',
      }),
    )
  }

  return gaps
}
