import type { OperatorGap } from '../gapFinder'
import { selfAuditGap } from './gapFactory'
import type { SelfAuditContext } from './types'

export function auditMemoryUsefulness(ctx: SelfAuditContext): OperatorGap[] {
  const gaps: OperatorGap[] = []
  const mem = ctx.memory ?? {}

  if (mem.persistenceAvailable === false) {
    gaps.push(
      selfAuditGap({
        id: 'self-audit-memory-persistence-offline',
        title: 'Durable memory offline',
        plainLanguage: 'Memory Core cannot persist new entries — session-only learning may apply.',
        meaning: 'Persistence probe failed while memory UI is reachable.',
        area: 'Memory Core',
        category: 'Memory Usefulness',
        kind: 'issue',
        severity: 'medium',
        recommendedFix: 'Open Memory Core; run persistence diagnostics from System Health.',
        cursorCommand: 'Trace memory persistence health in app/page.tsx without invoking provider completions.',
      }),
    )
  }

  if ((mem.memoryCount ?? 0) === 0 && mem.persistenceAvailable !== false) {
    gaps.push(
      selfAuditGap({
        id: 'self-audit-memory-empty',
        title: 'No memories stored yet',
        plainLanguage: 'Memory Core is empty — the council has nothing durable to recall.',
        meaning: 'Zero memory rows in operator state.',
        area: 'Memory Core',
        category: 'Memory Usefulness',
        kind: 'suggestion',
        severity: 'low',
        recommendedFix: 'Approve outcomes or add doctrine entries when council produces durable facts.',
        cursorCommand: 'Surface Memory Core onboarding copy when memoryCount is 0.',
      }),
    )
  }

  if (mem.sessionOnly) {
    gaps.push(
      selfAuditGap({
        id: 'self-audit-memory-session-only',
        title: 'Session-only learning mode',
        plainLanguage: 'New learning may not survive a refresh — check persistence before relying on memory.',
        meaning: 'Memory runtime reports session-only learning.',
        area: 'Memory Core',
        category: 'Memory Usefulness',
        kind: 'suggestion',
        severity: 'low',
        recommendedFix: 'Restore persistence before trusting long-horizon operator playbooks.',
        cursorCommand: 'Align memoryRuntime.sessionOnly label with persistenceAvailable in page.tsx.',
      }),
    )
  }

  return gaps
}
