import 'server-only'

import {
  appendOperatorNextStepsToPrompt,
  toOperatorNextStepsPayload,
  type OperatorNextStepsPayload,
} from '@/lib/operator/nextStepsReport'
import { buildSweepFindingOperatorNextSteps } from '@/lib/operator/repairPacketNextSteps'

import type { SweepFinding } from './types'

export type SweepRepairPacket = {
  findingId: string
  title: string
  exactIssue: string
  filesAndRoutes: string[]
  suggestedChange: string
  validationCommands: string[]
  riskRollback: string
  commitMessage: string
  cursorReadyPrompt: string
  operatorNextSteps: OperatorNextStepsPayload['report']
  operatorNextStepsMarkdown: string
}

export function buildRepairPacketFromFinding(finding: SweepFinding): SweepRepairPacket {
  const filesAndRoutes = [
    finding.affectedPanel,
    ...(finding.cursorReadyCommand?.includes('app/') ? [] : ['app/page.tsx', 'lib/war-room-sweep/']),
  ].filter(Boolean)

  const validationCommands = [
    'pnpm exec tsc --noEmit',
    'pnpm exec eslint',
    'pnpm run build',
    'GET /api/war-room/sweep',
  ]

  const suggestedChange = finding.suggestedAction
  const cursorReadyPrompt = finding.cursorReadyCommand ?? [
    `War Room OS sweep repair — ${finding.title}`,
    `Category: ${finding.category} · Severity: ${finding.severity} · Action: ${finding.classification}`,
    `Affected: ${finding.affectedFeature} (${finding.affectedPanel})`,
    '',
    'Evidence:',
    ...finding.evidence.map(line => `- ${line}`),
    '',
    `Suggested change: ${suggestedChange}`,
    '',
    'Guardrails: diagnostic packet only; no auto DB mutation; no secrets in operator view.',
    '',
    `Validation: ${validationCommands.join(' · ')}`,
    `Commit message: ${commitMessageForFinding(finding)}`,
  ].join('\n')

  const operatorPayload = toOperatorNextStepsPayload(buildSweepFindingOperatorNextSteps(finding))

  return {
    findingId: finding.id,
    title: finding.title,
    exactIssue: finding.evidence.join(' ') || finding.title,
    filesAndRoutes,
    suggestedChange,
    validationCommands,
    riskRollback: 'Manual review required. Roll back via git revert after validating in a branch; never run destructive SQL from War Room UI.',
    commitMessage: commitMessageForFinding(finding),
    cursorReadyPrompt: appendOperatorNextStepsToPrompt(cursorReadyPrompt, operatorPayload.report),
    operatorNextSteps: operatorPayload.report,
    operatorNextStepsMarkdown: operatorPayload.markdown,
  }
}

function commitMessageForFinding(finding: SweepFinding): string {
  const verb = finding.classification === 'remove' ? 'remove' : finding.classification === 'add' ? 'add' : 'fix'
  const slug = finding.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48)
  return `fix(war-room): ${verb} ${slug}`
}
