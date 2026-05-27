import type { OperatorGap } from '../gapFinder'
import { selfAuditGap } from './gapFactory'
import type { SelfAuditContext } from './types'

export function auditOverOrchestration(ctx: SelfAuditContext): OperatorGap[] {
  const gaps: OperatorGap[] = []
  const mode = ctx.councilFlowMode ?? ''
  const orch = ctx.orchestration ?? {}

  if (mode === 'full_council') {
    gaps.push(
      selfAuditGap({
        id: 'self-audit-orchestration-full-council',
        title: 'Full Council mode — highest orchestration load',
        plainLanguage: 'Every family may run in sequence — expect longer waits and more noise.',
        meaning: 'full_council flow maximizes parallel/sequential orchestration.',
        area: 'Session controls',
        category: 'Over-Orchestration Risk',
        kind: 'issue',
        severity: 'medium',
        recommendedFix: 'Use Stable Group Chat for daily ops; reserve Full Council for major decisions.',
        cursorCommand: 'Document council flow mode tradeoffs near session controls in app/page.tsx.',
      }),
    )
  }

  if (ctx.councilPaused) {
    gaps.push(
      selfAuditGap({
        id: 'self-audit-orchestration-paused',
        title: 'Council paused while triggers may queue',
        plainLanguage: 'Orchestration is paused — decrees will not advance until you resume.',
        meaning: 'Paused state blocks family advancement.',
        area: 'Session controls',
        category: 'Over-Orchestration Risk',
        kind: 'suggestion',
        severity: 'medium',
        recommendedFix: 'Resume session when ready; clear stale continuations if needed.',
        cursorCommand: 'Verify pauseCouncil/resumeCouncil UX copy near session controls.',
      }),
    )
  }

  if ((ctx.collapsedNoiseCount ?? 0) > 5) {
    gaps.push(
      selfAuditGap({
        id: 'self-audit-orchestration-noise-collapse',
        title: 'High collapsed orchestration noise',
        plainLanguage: `${ctx.collapsedNoiseCount} repeated system notices collapsed — underlying churn may continue.`,
        meaning: 'Council hygiene collapsed many duplicate system messages.',
        area: 'Live Council',
        category: 'Over-Orchestration Risk',
        kind: 'issue',
        severity: 'medium',
        recommendedFix: 'Fix root provider/runtime issue; then Clear Noise.',
        cursorCommand: 'Trace applyCouncilThreadHygiene collapsed keys in app/page.tsx.',
      }),
    )
  }

  if ((orch.recentCouncilTriggers ?? 0) > 8) {
    gaps.push(
      selfAuditGap({
        id: 'self-audit-orchestration-trigger-burst',
        title: 'Burst of recent council triggers',
        plainLanguage: `${orch.recentCouncilTriggers} orchestration triggers recently — risk of overlapping waves.`,
        meaning: 'High trigger count in session window.',
        area: 'Live Council',
        category: 'Over-Orchestration Risk',
        kind: 'issue',
        severity: 'medium',
        recommendedFix: 'Pause council; switch to Direct or Stable Group before next decree.',
        cursorCommand: 'Expose trigger rate limit hint in operator session indicators (UI-only).',
      }),
    )
  }

  if (orch.councilStabilityMode) {
    gaps.push(
      selfAuditGap({
        id: 'self-audit-orchestration-stability-mode',
        title: 'Council stability mode active',
        plainLanguage: 'Stability mode changes how families advance — confirm it matches your intent.',
        meaning: 'Server-side stability mode may override flow mode behavior.',
        area: 'Session controls',
        category: 'Over-Orchestration Risk',
        kind: 'suggestion',
        severity: 'low',
        recommendedFix: 'Review stability mode badge in session indicators.',
        cursorCommand: 'Align /api/council/stability-mode display with councilFlowMode selector.',
      }),
    )
  }

  return gaps
}
