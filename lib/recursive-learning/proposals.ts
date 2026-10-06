import { randomUUID } from 'node:crypto'
import type { FailureFinding } from './analysis'
import type { Scorecard } from './scoring'
import type { LearningLog, LogView } from './store'
import type { Decision, DecisionStatus, Proposal, ProposalKind } from './types'

const PROTECTED = /(governance|constitution|security|\bauth|permission|approval|deploy|payment|secret|policy|doctrine|guardrail)/i

/** True if any target path/area names governance, security/auth, approvals, deployment, payments or doctrine. */
export function touchesProtectedPolicy(kind: ProposalKind, targets: string[]): boolean {
  return kind === 'DOCTRINE_CHANGE' || targets.some((t) => PROTECTED.test(t))
}

export type ProposalDraft = Omit<Proposal, 'id' | 'createdAt' | 'applied' | 'targetsProtectedPolicy'> & { targets?: string[] }

export function buildProposal(draft: ProposalDraft, now: Date): Proposal {
  if (draft.evidenceEventIds.length === 0) throw new Error('proposal must cite evidence')
  const { targets = [], ...rest } = draft
  return {
    ...rest,
    id: randomUUID(),
    createdAt: now.toISOString(),
    applied: false,
    targetsProtectedPolicy: touchesProtectedPolicy(draft.kind, targets),
  }
}

export function submitProposal(log: LearningLog, draft: ProposalDraft, now: Date = new Date()): Proposal {
  const proposal = buildProposal(draft, now)
  log.append({ t: 'proposal', proposal })
  return proposal
}

export type ProposalStatus = 'PROPOSED' | DecisionStatus
export function proposalStatus(view: LogView, proposalId: string): ProposalStatus {
  const latest = [...view.decisions].reverse().find((d) => d.proposalId === proposalId)
  return latest ? latest.status : 'PROPOSED'
}

/** Only a Commander identity may decide. Rejections are kept (audit), never deleted. */
export function decideProposal(
  log: LearningLog,
  proposalId: string,
  status: DecisionStatus,
  decidedBy: string,
  reason: string,
  now: Date = new Date(),
): Decision {
  if (!decidedBy.startsWith('commander:')) throw new Error('decisions require a commander identity (commander:<id>)')
  if (!reason.trim()) throw new Error('decision reason required')
  if (!log.view().proposals.some((p) => p.id === proposalId)) throw new Error(`unknown proposal: ${proposalId}`)
  const decision: Decision = { proposalId, status, decidedBy, decidedAt: now.toISOString(), reason }
  log.append({ t: 'decision', decision })
  return decision
}

/**
 * Records a promotion ONLY for an approved memory candidate. Emits a record for the memory writer to consume;
 * this layer never writes strategic memory itself.
 */
export function promoteMemoryCandidate(log: LearningLog, proposalId: string, now: Date = new Date()) {
  const view = log.view()
  const p = view.proposals.find((x) => x.id === proposalId)
  if (!p || p.kind !== 'MEMORY_PROMOTION') throw new Error('not a memory promotion candidate')
  if (proposalStatus(view, proposalId) !== 'APPROVED') throw new Error('memory promotion requires Commander approval')
  const approval = [...view.decisions].reverse().find((d) => d.proposalId === proposalId && d.status === 'APPROVED')!
  const record = { t: 'promotion' as const, proposalId, approvedBy: approval.decidedBy, at: now.toISOString() }
  log.append(record)
  return record
}

const reviewBy = (now: Date, days: number) => new Date(now.getTime() + days * 86_400_000).toISOString()

/** E — candidates for strategic memory. Always PROPOSED; evidence, scope and review date included. */
export function buildMemoryCandidates(findings: FailureFinding[], cards: Scorecard[], now: Date): ProposalDraft[] {
  const drafts: ProposalDraft[] = findings.map((f) => ({
    kind: 'MEMORY_PROMOTION',
    title: `Recurring failure: ${f.subject.id} on ${f.taskClass} (${f.errorClass})`,
    summary: `${f.count} failures between ${f.firstSeen} and ${f.lastSeen}. ${f.report.rootCause}.`,
    evidenceEventIds: f.evidenceEventIds,
    contradictoryEventIds: f.contradictingSuccessIds,
    confidence: 'UNKNOWN',
    scope: `${f.subject.kind}:${f.subject.id}/${f.taskClass}`,
    reviewBy: reviewBy(now, 90),
    payload: { source: 'failure-analysis', signature: f.signature },
  }))
  for (const c of cards) {
    if (typeof c.score === 'number' && c.score >= 0.8 && c.confidence >= 0.5 && c.contradiction < 0.2)
      drafts.push({
        kind: 'MEMORY_PROMOTION',
        title: `Reliable pattern: ${c.subject.id} on ${c.taskClass}`,
        summary: `score ${c.score.toFixed(2)}, confidence ${c.confidence.toFixed(2)} over ${c.rawSamples} runs.`,
        evidenceEventIds: c.evidenceEventIds,
        contradictoryEventIds: c.contradictoryEventIds,
        confidence: c.confidence,
        scope: `${c.subject.kind}:${c.subject.id}/${c.taskClass}`,
        reviewBy: reviewBy(now, 60),
        payload: { source: 'scorecard' },
      })
  }
  return drafts
}

/** G — doctrine/architecture proposals from heavily recurring failures. Always protected, never applied. */
export function buildDoctrineProposals(findings: FailureFinding[], minCount = 5): ProposalDraft[] {
  return findings
    .filter((f) => f.count >= minCount)
    .map((f) => ({
      kind: 'DOCTRINE_CHANGE' as const,
      title: `Doctrine review: ${f.errorClass} on ${f.taskClass}`,
      summary: `${f.count} recurrences. ${f.report.recommendedMitigation}. Requires Commander review; no change is applied automatically.`,
      evidenceEventIds: f.evidenceEventIds,
      contradictoryEventIds: f.contradictingSuccessIds,
      confidence: 'UNKNOWN' as const,
      scope: `${f.subject.kind}:${f.subject.id}/${f.taskClass}`,
      targets: ['doctrine'],
      payload: { signature: f.signature },
    }))
}
