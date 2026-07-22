import type { SentinelFinding } from '@/lib/red-sentinel/runScan'
import type { RedTeamCoderIssue, RedTeamCoderRepairPlan } from '@/lib/red-team-coder/types'

import type { RedTeamWorkspaceItem } from './types'

const NOT_ASSESSED_BY_SENTINEL = 'Not assessed by Red Sentinel — scanner reports the observation only.'

export function normalizeSentinelFinding(finding: SentinelFinding): RedTeamWorkspaceItem {
  return {
    id: `red-sentinel:${finding.id}`,
    source: 'red_sentinel',
    observation: finding.message,
    classification: finding.kind,
    severity: finding.severity,
    affectedSubsystem: finding.kind,
    evidence: finding.detail ? [JSON.stringify(finding.detail)] : ['No additional evidence recorded.'],
    suspectedCause: NOT_ASSESSED_BY_SENTINEL,
    confirmedCause: null,
    securityImpact: NOT_ASSESSED_BY_SENTINEL,
    userImpact: NOT_ASSESSED_BY_SENTINEL,
    reliabilityImpact: NOT_ASSESSED_BY_SENTINEL,
    recommendedRepair: NOT_ASSESSED_BY_SENTINEL,
    verificationPlan: [],
    rollbackPlan: null,
    unresolvedQuestions: ['Red Sentinel does not track unresolved questions — this is a scan observation only.'],
  }
}

type MinimalRedTeamCoderIssue = Pick<RedTeamCoderIssue, 'issueId' | 'severity' | 'detectedAt' | 'symptom'>
  & Partial<Pick<RedTeamCoderIssue, 'code' | 'evidence'>>

export function normalizeRedTeamCoderIssue(issue: MinimalRedTeamCoderIssue, plan: RedTeamCoderRepairPlan | null): RedTeamWorkspaceItem {
  const notAssessed = 'Not assessed by Red Team Coder — this subsystem does not produce this field.'
  const evidence = issue.evidence ?? []
  return {
    id: `red-team-coder:${issue.issueId}`,
    source: 'red_team_coder',
    observation: issue.symptom,
    classification: issue.code ?? 'unclassified',
    severity: issue.severity,
    affectedSubsystem: plan?.suspectedFiles?.[0] ?? 'Live Council chat/orchestration',
    evidence: evidence.length ? evidence : ['No evidence recorded.'],
    suspectedCause: plan?.likelyCause ?? notAssessed,
    confirmedCause: null,
    securityImpact: notAssessed,
    userImpact: 'Commander/operator using the Live Council chat session may see a stalled, failed, or degraded response.',
    reliabilityImpact: plan ? `Recommended agent for repair: ${plan.recommendedAgent}.` : notAssessed,
    recommendedRepair: plan?.recommendedFix ?? notAssessed,
    verificationPlan: plan?.verificationSteps ?? [],
    rollbackPlan: null,
    unresolvedQuestions: ['Red Team Coder does not track unresolved questions beyond the recommended fix.'],
  }
}
