import type { WorkspaceActorRole, WorkspaceProposalStatus } from './types'

const CONTRIBUTOR_TRANSITIONS = new Set<string>([
  'draft->submitted',
  'revision_requested->submitted',
])

const COMMANDER_TRANSITIONS = new Set<string>([
  'submitted->contributor_review',
  'contributor_review->commander_council_review',
  'commander_council_review->revision_requested',
  'commander_council_review->approved',
  'commander_council_review->rejected',
  'approved->implemented',
  'implemented->verified',
  'verified->closed',
  'rejected->closed',
])

export type WorkspaceTransitionValidation =
  | { ok: true }
  | { ok: false; reason: string }

export function isValidWorkspaceProposalTransition(
  from: WorkspaceProposalStatus,
  to: WorkspaceProposalStatus,
  actorRole: WorkspaceActorRole
): boolean {
  const key = `${from}->${to}`
  if (actorRole === 'workspace_contributor') return CONTRIBUTOR_TRANSITIONS.has(key)
  if (actorRole === 'commander') return COMMANDER_TRANSITIONS.has(key)
  return false
}

export function validateWorkspaceProposalTransition(
  from: WorkspaceProposalStatus,
  to: WorkspaceProposalStatus,
  actorRole: WorkspaceActorRole
): WorkspaceTransitionValidation {
  if (from === to) return { ok: false, reason: 'status_unchanged' }
  if (!isValidWorkspaceProposalTransition(from, to, actorRole)) {
    return { ok: false, reason: `invalid_${actorRole}_transition_${from}_to_${to}` }
  }
  return { ok: true }
}

export function eventTypeForTransition(
  from: WorkspaceProposalStatus | null,
  to: WorkspaceProposalStatus,
  actorRole: WorkspaceActorRole
): string {
  if (from === null && to === 'draft') return 'proposal_created'
  if (actorRole === 'commander' && ['approved', 'rejected', 'revision_requested'].includes(to)) return 'commander_decision'
  if (to === 'submitted') return 'proposal_submitted'
  return 'proposal_transitioned'
}
