import type { LearningLog } from './store'
import { proposalStatus, type ProposalStatus } from './proposals'
import type { Decision, EvaluationEvent, Proposal } from './types'

export type EvidenceItem = { event: EvaluationEvent; superseded: boolean; supersededReason?: string; supersededBy?: string }
export type EvidenceDrillDown = {
  proposal: Proposal
  status: ProposalStatus
  decisions: Decision[]
  supporting: EvidenceItem[]
  contradictory: EvidenceItem[]
  missingEventIds: string[]
}

/** H — resolve a proposal to its source events, including superseded ones and contradictory evidence. */
export function drillDown(log: LearningLog, proposalId: string): EvidenceDrillDown {
  const view = log.view()
  const proposal = view.proposals.find((p) => p.id === proposalId)
  if (!proposal) throw new Error(`unknown proposal: ${proposalId}`)
  const byId = new Map(view.events.map((e) => [e.id, e]))
  const sup = new Map(view.supersessions.map((s) => [s.eventId, s]))
  const resolve = (ids: string[]) => ids.map((id) => byId.get(id)).filter((e): e is EvaluationEvent => !!e)
    .map((event) => ({ event, superseded: sup.has(event.id), supersededReason: sup.get(event.id)?.reason, supersededBy: sup.get(event.id)?.supersededBy }))
  return {
    proposal,
    status: proposalStatus(view, proposalId),
    decisions: view.decisions.filter((d) => d.proposalId === proposalId),
    supporting: resolve(proposal.evidenceEventIds),
    contradictory: resolve(proposal.contradictoryEventIds),
    missingEventIds: [...proposal.evidenceEventIds, ...proposal.contradictoryEventIds].filter((id) => !byId.has(id)),
  }
}

/** Operator-facing list: every proposal with its current status, rejected ones included. */
export function listProposals(log: LearningLog) {
  const view = log.view()
  return view.proposals.map((p) => ({ proposal: p, status: proposalStatus(view, p.id) }))
}
