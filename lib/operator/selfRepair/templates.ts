import type { OperatorGap } from '../gapFinder'
import type { OperatorInboxItem } from '../inbox'
import type { RepairPlan, RepairRisk, RepairSourceType } from './types'

const DEFAULT_VALIDATION_COMMANDS = [
  'pnpm exec tsc --noEmit',
  'pnpm exec eslint',
  'pnpm run build',
]

function riskFromSeverity(severity: OperatorGap['severity'] | OperatorInboxItem['severity']): RepairRisk {
  if (severity === 'high') return 'high'
  if (severity === 'medium') return 'medium'
  return 'low'
}

function inferFiles(cursorCommand: string, area: string): string[] {
  const files: string[] = []
  const pathMatches = cursorCommand.match(/[\w./-]+\.(tsx?|ts|jsx?|js|sql|md)/g)
  if (pathMatches) {
    for (const match of pathMatches) {
      if (!files.includes(match)) files.push(match)
    }
  }
  if (area.includes('Council') || /live council/i.test(area)) {
    if (!files.includes('app/page.tsx')) files.push('app/page.tsx')
  }
  if (area.includes('System Health') || /operator/i.test(area)) {
    if (!files.includes('components/war-room/live-room/DockPanelContent.tsx')) {
      files.push('components/war-room/live-room/DockPanelContent.tsx')
    }
  }
  if (!files.length) files.push('(review gap area — no paths inferred)')
  return files
}

function planId(sourceType: RepairSourceType, sourceId: string): string {
  return `repair-plan-${sourceType}-${sourceId}`
}

export function repairPlanFromGap(gap: OperatorGap, now = new Date().toISOString()): RepairPlan {
  return {
    id: planId('gap', gap.id),
    sourceId: gap.id,
    sourceType: 'gap',
    title: gap.title,
    files: inferFiles(gap.cursorCommand, gap.area),
    expectedBehavior: gap.plainLanguage,
    validationCommands: [...DEFAULT_VALIDATION_COMMANDS],
    rollback: 'Revert the commit or stash local edits for touched files; no UI auto-rollback.',
    risk: riskFromSeverity(gap.severity),
    cursorCommand: gap.cursorCommand,
    createdAt: now,
    updatedAt: now,
  }
}

export function repairPlanFromInboxItem(item: OperatorInboxItem, now = new Date().toISOString()): RepairPlan {
  return {
    id: planId('inbox', item.id),
    sourceId: item.id,
    sourceType: 'inbox',
    title: item.title,
    files: inferFiles(item.copyCursorCommand, item.source),
    expectedBehavior: item.plainMeaning,
    validationCommands: [...DEFAULT_VALIDATION_COMMANDS],
    rollback: 'Revert local edits or dismiss inbox item if change is not needed.',
    risk: riskFromSeverity(item.severity),
    cursorCommand: item.copyCursorCommand,
    createdAt: now,
    updatedAt: now,
  }
}

export function formatRepairPlanForCursor(plan: RepairPlan): string {
  const lines = [
    `# War Room repair: ${plan.title}`,
    '',
    `Source: ${plan.sourceType} · ${plan.sourceId}`,
    `Risk: ${plan.risk}`,
    '',
    '## Expected behavior',
    plan.expectedBehavior,
    '',
    '## Files (review)',
    ...plan.files.map(f => `- ${f}`),
    '',
    '## Cursor command',
    plan.cursorCommand,
    '',
    '## Validation (operator runs locally — not from browser)',
    ...plan.validationCommands.map(cmd => `- ${cmd}`),
    '',
    '## Rollback',
    plan.rollback,
    '',
    'No silent file mutation. No git commit from War Room UI.',
  ]
  return lines.join('\n')
}
