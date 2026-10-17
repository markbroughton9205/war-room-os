/**
 * Council <-> Foundry: a Council discussion can produce a mission PROPOSAL. Nothing runs until the Commander approves it; approval
 * starts the existing Foundry engineering mission (lib/agents/ops/engineering/missions). The proposal only mirrors what Foundry's
 * own mission record says. Completion is never inferred on the Council side.
 */
export type CouncilMissionStatus =
  | 'PROPOSED'      // drafted from the discussion, waiting for the Commander
  | 'REJECTED'      // Commander declined; Foundry was never contacted
  | 'START_FAILED'  // approved, but Foundry refused or could not start it (reason recorded; can be approved again)
  | 'RUNNING'       // Foundry accepted it and the mission is active
  | 'INTERRUPTED'   // Foundry reports the run died / was interrupted (resumable from Foundry)
  | 'COMPLETED'     // Foundry mission COMPLETED with a passing verifier receipt (authoritative)
  | 'FAILED'        // Foundry mission failed, or reported COMPLETED without a passing verifier receipt
  | 'CANCELLED'

export const TERMINAL_COUNCIL_MISSION_STATUSES: CouncilMissionStatus[] = ['REJECTED', 'COMPLETED', 'FAILED', 'CANCELLED']

export type CouncilMissionTarget = { path: string; action: 'create' | 'modify' }

export type CouncilMissionFoundrySnapshot = {
  missionId: string
  state: string
  stateReason: string
  stateAt: string
  progress: { stepsDone: number; stepsTotal: number; modelCalls: number; filesChanged: string[]; lastEvent: string } | null
  result: { status: string; reason: string; completionClass?: string; verifierExit: number | string } | null
  receipt: {
    receiptSha256: string
    verifier: { label: string; exitCode: number | string; summary: string; at: string }
    integration: { state: string; branch?: string; commit?: string; tree?: string }
    filesCreated: string[]
    filesModified: string[]
    testsAdded: string[]
    receiptVerified: boolean
  } | null
  syncedAt: string
}

export type CouncilMissionProposal = {
  proposalId: string
  conversationId: string
  /** set when the mission was started by a plain-language command through Foundry's autonomous controller (no proposal/approval step) */
  commandId?: string
  createdAt: string
  title: string
  request: string
  acceptance: string[]
  targets: CouncilMissionTarget[]
  scope: { paths: string[]; write: string[] }
  install: boolean
  /** what the Council discussion looked like when this was drafted (ids and attribution only; text stays in the conversation) */
  discussion: { messageIds: string[]; contributors: Array<{ member: string; model: string | null }>; excerpt: string }
  status: CouncilMissionStatus
  statusReason: string
  approval: null | { at: string; by: string }
  rejection: null | { at: string; by: string; reason: string }
  foundry: CouncilMissionFoundrySnapshot | null
  /** set once the final result was written back into the same conversation (exactly once) */
  resultReturned: null | { at: string; messageId: string | null }
}
