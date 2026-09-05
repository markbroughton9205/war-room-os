/**
 * WR-Engineer session stream — SSE envelope types and wire encoding only (no polling logic here;
 * that lives in the route, exactly matching lib/mission-runtime/engineeringStream.ts's own
 * division of responsibility — see that file's header for why).
 *
 * Reuses the exact same wire convention (`event: <type>\ndata: <json>\n\n`, comment-line keepalive)
 * already established by lib/council/incremental-transport/sse.ts and reused again by
 * engineeringStream.ts — the third reuse of this mechanism, not a third invention of one. The
 * envelope shape itself is WR-Engineer-specific (session/proposal/repair-shaped), same as
 * engineeringStream.ts's own EngineeringStreamEnvelope is mission-shaped rather than reusing
 * Council's chat-shaped envelope.
 *
 * Authoritative-state discipline, also reused from engineeringStream.ts: a `session.snapshot`
 * envelope always carries the COMPLETE current session projection — a client that reconnects or
 * misses frames gets full authoritative state on the very next snapshot, never a broken partial
 * state built up from missed deltas. The granular named events (message.created, tool.completed,
 * proposal.ready, etc.) are a convenience layer on top for a livelier activity feed — never the
 * only source of truth a client is allowed to depend on.
 */
import type { AgentState } from './types'
import type { EngineeringChatMessage, EngineeringSession, ProposalState, ToolActivityEvent } from './session/types'
import type { NodeConnectionStatus } from './node/types'

export const WR_ENGINEER_STREAM_VERSION = 1

export type WrEngineerSessionSnapshot = {
  session: EngineeringSession
  proposalState: ProposalState
  repairState: string | null
  messages: EngineeringChatMessage[]
  toolEvents: ToolActivityEvent[]
  nodeStatus: NodeConnectionStatus | null
}

export type WrEngineerStreamEnvelopeType =
  | 'opened'
  | 'session.snapshot'
  | 'agent.state'
  | 'message.created'
  | 'tool.completed'
  | 'tool.failed'
  | 'proposal.generating'
  | 'proposal.ready'
  | 'proposal.invalid'
  | 'proposal.bridged'
  | 'repair.state'
  | 'validation.completed'
  | 'node.status'
  | 'error'
  | 'closed'

type Base = { version: typeof WR_ENGINEER_STREAM_VERSION; sessionId: string; sequence: number; emittedAt: string }

export type WrEngineerStreamEnvelope =
  | (Base & { envelopeType: 'opened' })
  | (Base & { envelopeType: 'session.snapshot'; snapshot: WrEngineerSessionSnapshot })
  | (Base & { envelopeType: 'agent.state'; agentState: AgentState })
  | (Base & { envelopeType: 'message.created'; message: EngineeringChatMessage })
  | (Base & { envelopeType: 'tool.completed'; event: ToolActivityEvent })
  | (Base & { envelopeType: 'tool.failed'; event: ToolActivityEvent })
  | (Base & { envelopeType: 'proposal.generating' })
  | (Base & { envelopeType: 'proposal.ready'; proposalId: string; files: string[] })
  | (Base & { envelopeType: 'proposal.invalid'; reasons: string[] })
  | (Base & { envelopeType: 'proposal.bridged'; issueId: string; repairId: string })
  | (Base & { envelopeType: 'repair.state'; repairId: string; state: string })
  | (Base & { envelopeType: 'validation.completed'; ok: boolean; detail: string })
  | (Base & { envelopeType: 'node.status'; nodeId: string; status: NodeConnectionStatus })
  | (Base & { envelopeType: 'error'; error: { code: string; message: string } })
  | (Base & { envelopeType: 'closed'; reason: string })

export function encodeWrEngineerStreamEnvelope(envelope: WrEngineerStreamEnvelope): string {
  return `event: ${envelope.envelopeType}\ndata: ${JSON.stringify(envelope)}\n\n`
}

export function encodeWrEngineerStreamComment(comment: string): string {
  return `: ${comment.replace(/\r?\n/g, ' ')}\n\n`
}

// ---------------------------------------------------------------------------
// Delta computation — a pure function so the diffing logic is unit-testable independent of the
// ReadableStream/setInterval transport plumbing in the route (same separation of concerns as
// engineeringStream.ts's missionProgressFingerprint, just returning full envelope payloads instead
// of a fingerprint string, since WR-Engineer's granular per-item events need the actual new items).
// ---------------------------------------------------------------------------

export type StreamBaseline = {
  agentState: AgentState
  messageCount: number
  toolEventCount: number
  proposalState: ProposalState
  repairState: string | null
  nodeStatus: NodeConnectionStatus | null
}

export function snapshotToBaseline(snapshot: WrEngineerSessionSnapshot): StreamBaseline {
  return {
    agentState: snapshot.session.agentState,
    messageCount: snapshot.messages.length,
    toolEventCount: snapshot.toolEvents.length,
    proposalState: snapshot.proposalState,
    repairState: snapshot.repairState,
    nodeStatus: snapshot.nodeStatus,
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
export type StreamEnvelopePayload = DistributiveOmit<WrEngineerStreamEnvelope, 'version' | 'sessionId' | 'sequence' | 'emittedAt'>

export type StreamDeltaResult = {
  envelopes: StreamEnvelopePayload[]
  changed: boolean
  newBaseline: StreamBaseline
}

/**
 * Diffs `baseline` (the last snapshot's derived summary) against `current` (a freshly-built
 * snapshot) and returns the granular named-event payloads for whatever is genuinely new — never a
 * replay of anything already reflected in `baseline`. Calling this again with `current` unchanged
 * from the last call's `newBaseline` always yields `changed: false` and an empty envelope list —
 * the idempotency a reconnect (or a no-op poll tick) depends on to never duplicate an event.
 */
export function computeStreamDeltas(baseline: StreamBaseline, current: WrEngineerSessionSnapshot): StreamDeltaResult {
  const envelopes: StreamEnvelopePayload[] = []
  let changed = false

  if (current.messages.length > baseline.messageCount) {
    for (const message of current.messages.slice(baseline.messageCount)) {
      envelopes.push({ envelopeType: 'message.created', message })
    }
    changed = true
  }
  if (current.toolEvents.length > baseline.toolEventCount) {
    for (const event of current.toolEvents.slice(baseline.toolEventCount)) {
      envelopes.push({ envelopeType: event.outcome === 'PASS' ? 'tool.completed' : 'tool.failed', event })
    }
    changed = true
  }
  if (current.session.agentState !== baseline.agentState) {
    envelopes.push({ envelopeType: 'agent.state', agentState: current.session.agentState })
    changed = true
  }
  if (current.proposalState !== baseline.proposalState) {
    const proposal = current.session.activeProposal
    switch (current.proposalState) {
      case 'GENERATING':
        envelopes.push({ envelopeType: 'proposal.generating' })
        break
      case 'INVALID':
        envelopes.push({ envelopeType: 'proposal.invalid', reasons: current.session.lastProposalRejection?.reasons ?? [] })
        break
      case 'READY':
        envelopes.push({ envelopeType: 'proposal.ready', proposalId: proposal?.id ?? 'unknown', files: proposal?.relevantFiles ?? [] })
        break
      case 'BRIDGED':
      case 'AWAITING_APPROVAL':
        if (current.session.nativeBuilderIssueId && current.session.nativeBuilderRepairId) {
          envelopes.push({ envelopeType: 'proposal.bridged', issueId: current.session.nativeBuilderIssueId, repairId: current.session.nativeBuilderRepairId })
        }
        break
      default:
        break
    }
    changed = true
  }
  if (current.repairState !== baseline.repairState && current.session.nativeBuilderRepairId && current.repairState) {
    envelopes.push({ envelopeType: 'repair.state', repairId: current.session.nativeBuilderRepairId, state: current.repairState })
    changed = true
  }
  if (current.nodeStatus !== baseline.nodeStatus && current.nodeStatus) {
    envelopes.push({ envelopeType: 'node.status', nodeId: current.session.nodeId, status: current.nodeStatus })
    changed = true
  }

  return { envelopes, changed, newBaseline: changed ? snapshotToBaseline(current) : baseline }
}
