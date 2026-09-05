/**
 * WR-Engineer engineering chat session — domain types.
 *
 * Distinct from a generic Council conversation (lib/council/*, `war_room_conversations`/
 * `war_room_messages`): a WR-Engineer session is always bound to exactly one node + one repository
 * for its entire lifetime (see session.ts — no function anywhere mutates `nodeId`/`repositoryId`
 * on an existing session; changing target machine or repository always creates a NEW session id).
 * Carries the fields the mission brief requires a session to be aware of.
 */
import type { AgentState, MissionContext } from '../types'
import type { WrEngineerEditProposal } from '../codeEditProposals'
import type { CompactTurnEvidence, ProposalFileGrounding, TurnPhase } from '../turnEvidence'

export type EngineeringChatRole = 'commander' | 'wr_engineer' | 'system'

export type EngineeringChatMessage = {
  id: string
  sessionId: string
  role: EngineeringChatRole
  content: string
  createdAt: string
}

export type ToolActivityOutcome = 'STARTED' | 'PASS' | 'FAIL'

export type ToolActivityEvent = {
  id: string
  sessionId: string
  tool: string
  detail: string
  outcome: ToolActivityOutcome
  occurredAt: string
  turnId?: string
  target?: string
}

/**
 * Proposal lifecycle (Phase 3). Only the pre-bridge states are ever STORED on a session — once a
 * proposal is bridged, native-builder's own repair record is the authoritative source for
 * AWAITING_APPROVAL/APPLIED/VALIDATING/VALID/FAILED/ROLLED_BACK (see
 * lib/wr-engineer/session/proposalState.ts's deriveProposalState — "reuse Native Builder's actual
 * state where possible rather than duplicating truth," per the mission brief). NONE/GENERATING/
 * INVALID/READY/BRIDGED are the only values a session record itself carries.
 */
export const STORED_PROPOSAL_STATES = ['NONE', 'GENERATING', 'INVALID', 'READY', 'BRIDGED'] as const
export type StoredProposalState = (typeof STORED_PROPOSAL_STATES)[number]

export const PROPOSAL_STATES = [
  'NONE', 'GENERATING', 'INVALID', 'READY', 'BRIDGED',
  'AWAITING_APPROVAL', 'APPLIED', 'VALIDATING', 'VALID', 'FAILED', 'ROLLED_BACK',
] as const
export type ProposalState = (typeof PROPOSAL_STATES)[number]

export type EngineeringSession = {
  sessionId: string
  /** Commander/user identity — the Supabase auth.users id via requireCommanderSession(), not a
   * WR-Engineer-owned identity concept. */
  commanderUserId: string
  /** Always the literal string 'wr-engineer' — a session is never ambiguous about which agent
   * identity it belongs to (see identity/IDENTITY.md). */
  wrEngineerIdentity: 'wr-engineer'
  nodeId: string
  repositoryId: string
  /** Snapshotted at session creation from the repository's last reported status — a convenience
   * cache, never authoritative; authoritative branch/HEAD always comes from a fresh
   * REPOSITORY_STATUS/GIT_STATUS report (see node/repository.ts's applyRepositoryStatusReport). */
  repositoryPath: string
  branch: string | null
  headSha: string | null
  mission: MissionContext | null
  constraints: string[]
  agentState: AgentState
  proposalState: StoredProposalState
  activeProposal: WrEngineerEditProposal | null
  nativeBuilderIssueId: string | null
  nativeBuilderRepairId: string | null
  lastProposalRejection: { reasons: string[] } | null
  /** UI-visible inspect-loop phase — does not replace agentState. Optional so Phase 2/3 session records remain valid. */
  turnPhase?: TurnPhase
  lastTurnEvidence?: CompactTurnEvidence | null
  proposalGrounding?: ProposalFileGrounding[] | null
  createdAt: string
  updatedAt: string
}
