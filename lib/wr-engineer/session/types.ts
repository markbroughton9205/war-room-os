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

export type EngineeringChatRole = 'commander' | 'wr_engineer' | 'system'

export type EngineeringChatMessage = {
  id: string
  sessionId: string
  role: EngineeringChatRole
  content: string
  createdAt: string
}

export type ToolActivityOutcome = 'PASS' | 'FAIL'

export type ToolActivityEvent = {
  id: string
  sessionId: string
  tool: string
  detail: string
  outcome: ToolActivityOutcome
  occurredAt: string
}

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
  createdAt: string
  updatedAt: string
}
