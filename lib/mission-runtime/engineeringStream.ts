/**
 * Phase F — Engineering Streaming.
 *
 * Reuses the exact same SSE wire encoding convention already established by
 * lib/council/incremental-transport/sse.ts (`event: <type>\ndata: <json>\n\n`, plus a comment-line
 * keepalive) rather than inventing a second wire protocol. What is NOT reused is that module's
 * concrete envelope type (CouncilStreamEnvelope) — it is chat/Council-domain-specific
 * (familyDeliberation, readableContributionCount, councilProviderHttpStatus) and has nothing to do
 * with an Engineering Mission. Per the brief's own allowance ("define an Engineering/Mission stream
 * envelope if required"), EngineeringStreamEnvelope below is that narrow, additive, Engineering-
 * shaped definition — same wire mechanics, different (honest) payload.
 *
 * Authoritative-state discipline: every 'progress'/'final' envelope below carries a COMPLETE
 * current RuntimeMission projection (project()'s own output, unchanged), never a delta and never
 * invented text. This is deliberate: a client that misses frames, or reconnects mid-mission, gets
 * the full authoritative state on the very next envelope — there is no replay log to corrupt,
 * because there is nothing to replay. This module has no polling/streaming logic of its own beyond
 * that; the route (app/api/mission-runtime/engineering/[id]/stream/route.ts) is what re-reads
 * strategy.get(id) on an interval and diffs a cheap fingerprint to decide when to emit — the
 * source of truth stays exactly what get() already reads (native-builder's own persisted repair
 * record), not a second live-progress side channel inside native-builder's runtime.ts.
 */
import type { RuntimeMission } from './types'

export const ENGINEERING_STREAM_VERSION = 1

export type EngineeringStreamEnvelopeType = 'opened' | 'progress' | 'final' | 'error' | 'closed' | 'command_output'

/** One live-output entry, mirrored from lib/native-builder/commandOutput.ts's CommandOutputEntry
 * (redeclared here so this module stays importable by code that must not pull in the native-builder
 * process/buffer machinery). Already secret-redacted before it ever entered the buffer. */
export type EngineeringStreamCommandOutput = {
  sequence: number
  operationId: string
  stream: 'stdout' | 'stderr' | 'system'
  text: string
  at: string
}

export type EngineeringStreamTerminalState = 'mission_terminal' | 'client_disconnected' | 'transport_error' | 'not_found'

type EngineeringStreamEnvelopeBase = {
  version: typeof ENGINEERING_STREAM_VERSION
  requestId: string
  sequence: number
  emittedAt: string
}

export type EngineeringStreamEnvelope =
  | (EngineeringStreamEnvelopeBase & { envelopeType: 'opened'; missionId: string })
  | (EngineeringStreamEnvelopeBase & { envelopeType: 'progress'; mission: RuntimeMission })
  | (EngineeringStreamEnvelopeBase & { envelopeType: 'final'; mission: RuntimeMission })
  | (EngineeringStreamEnvelopeBase & { envelopeType: 'error'; error: { code: string; message: string } })
  | (EngineeringStreamEnvelopeBase & { envelopeType: 'closed'; terminalState: EngineeringStreamTerminalState })
  | (EngineeringStreamEnvelopeBase & { envelopeType: 'command_output'; missionId: string; entries: EngineeringStreamCommandOutput[] })

const TERMINAL_STATUSES = new Set(['completed', 'rolled_back', 'blocked', 'cancelled'])

export function isTerminalMissionStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status)
}

/** Cheap, order-stable fingerprint of "has anything a client would want to redraw actually
 * changed" — comparing the full mission JSON every poll is wasteful and would also spuriously fire
 * on field reordering; this only tracks the fields Phase F's own envelope schema exposes. */
export function missionProgressFingerprint(mission: RuntimeMission): string {
  return JSON.stringify({
    status: mission.status,
    historyLength: mission.raw.repair.history.length,
    validationCount: mission.validationResults.length,
    verificationStatus: mission.verification?.status ?? null,
    hasDiff: Boolean(mission.diff?.diff?.length),
    providerOpinionCount: mission.providerOpinions.length,
    councilAssistSessionCount: mission.councilAssistSessions.length,
    updatedAt: mission.updatedAt,
  })
}

export function encodeEngineeringStreamEnvelope(envelope: EngineeringStreamEnvelope): string {
  return `event: ${envelope.envelopeType}\ndata: ${JSON.stringify(envelope)}\n\n`
}

export function encodeEngineeringStreamComment(comment: string): string {
  return `: ${comment.replace(/\r?\n/g, ' ')}\n\n`
}
