import type { OperatorGap } from '../gapFinder'
import { selfAuditGap } from './gapFactory'
import type { SelfAuditContext } from './types'

const DUPLICATE_PAIRS: {
  id: string
  title: string
  plainLanguage: string
  meaning: string
  recommendedFix: string
  cursorCommand: string
}[] = [
  {
    id: 'self-audit-dup-signal-radar-news-intel',
    title: 'Signal Radar overlaps News Intel',
    plainLanguage:
      'Analytics (Signal Radar) and Command Intel (News Intel) both surface headlines and feeds — pick one primary path.',
    meaning: 'Two dock panels can show similar signal/news content with different labels.',
    recommendedFix: 'Use News Intel for story handoffs; use Analytics for scored radar rows only.',
    cursorCommand:
      'Document operator playbook: News Intel = stories/RSS; Signal Radar = scored signals — reduce duplicate fetch in UI copy only.',
  },
  {
    id: 'self-audit-dup-system-health-evolution',
    title: 'System Health stacks evolution + gap finder',
    plainLanguage:
      'System Health opens evolution, gap finder, AI team, and integrity — consider collapsing repair entry points.',
    meaning: 'Multiple repair panels in one dock increase scroll fatigue.',
    recommendedFix: 'Start with Self-Audit top; open evolution only when readiness score is low.',
    cursorCommand: 'Reorder DockPanelContent system-health sections with Self-Audit first (UI-only).',
  },
  {
    id: 'self-audit-dup-settings-operations',
    title: 'Operations vs Settings both expose sweeps',
    plainLanguage: 'Schema/OS sweeps appear under Settings while Operations holds Opportunity Scout — clarify lanes.',
    meaning: 'Commander may not know whether to open Operations or Settings for maintenance.',
    recommendedFix: 'Use Operations for revenue/scout; Settings for schema/OS sweeps.',
    cursorCommand: 'Add one-line lane hints on Operations and Settings dock headers.',
  },
]

export function auditDuplicateFeatures(_ctx: SelfAuditContext): OperatorGap[] {
  return DUPLICATE_PAIRS.map(pair =>
    selfAuditGap({
      id: pair.id,
      title: pair.title,
      plainLanguage: pair.plainLanguage,
      meaning: pair.meaning,
      area: 'Navigation',
      category: 'Duplicate Features',
      kind: 'duplicate',
      severity: 'low',
      recommendedFix: pair.recommendedFix,
      cursorCommand: pair.cursorCommand,
    }),
  )
}
