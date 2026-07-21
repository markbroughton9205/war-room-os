import type {
  CouncilStreamEnvelope,
  CouncilStreamProgress,
  CouncilStreamReconciliationState,
  CouncilStreamSanitizedError,
} from './types'

export type CouncilStreamReconcileResult =
  | { ok: true; accepted: boolean; reason: string }
  | { ok: false; error: CouncilStreamSanitizedError }

export function createCouncilStreamReconciliationState(): CouncilStreamReconciliationState {
  return {
    requestId: null,
    operationId: null,
    highestSequence: -1,
    seenSequences: new Set<number>(),
    progressEventIds: new Set<string>(),
    finalDelivered: false,
    closed: false,
    stale: false,
  }
}

function transportError(code: string, message: string): CouncilStreamReconcileResult {
  return {
    ok: false,
    error: { code, message, terminal: true, classification: 'transport' },
  }
}

function progressEventKey(envelope: CouncilStreamProgress): string {
  return String(envelope.progressEvent.eventId)
}

export function reconcileCouncilStreamEnvelope(
  state: CouncilStreamReconciliationState,
  envelope: CouncilStreamEnvelope,
): CouncilStreamReconcileResult {
  if (state.closed) return { ok: true, accepted: false, reason: 'stream_already_closed' }
  if (state.requestId && envelope.requestId !== state.requestId) {
    return transportError('operation_identity_mismatch', 'Council stream envelope request identity did not match the active operation.')
  }
  if (state.operationId && envelope.operationId && envelope.operationId !== state.operationId) {
    return transportError('operation_identity_mismatch', 'Council stream envelope operation identity did not match the active operation.')
  }
  if (!state.requestId) state.requestId = envelope.requestId
  if (!state.operationId && envelope.operationId) state.operationId = envelope.operationId

  if (state.seenSequences.has(envelope.sequence)) {
    if (envelope.envelopeType === 'progress') {
      const key = progressEventKey(envelope)
      if (state.progressEventIds.has(key)) return { ok: true, accepted: false, reason: 'duplicate_progress_event' }
    }
    if (envelope.envelopeType === 'final') return transportError('duplicate_final_envelope', 'Council stream delivered a duplicate final envelope.')
    return { ok: true, accepted: false, reason: 'duplicate_sequence_ignored' }
  }
  state.seenSequences.add(envelope.sequence)
  state.highestSequence = Math.max(state.highestSequence, envelope.sequence)

  if (envelope.envelopeType === 'progress') {
    const key = progressEventKey(envelope)
    if (state.progressEventIds.has(key)) return { ok: true, accepted: false, reason: 'duplicate_progress_event' }
    state.progressEventIds.add(key)
  }

  if (envelope.envelopeType === 'final') {
    if (state.finalDelivered) return transportError('duplicate_final_envelope', 'Council stream delivered a duplicate final envelope.')
    state.finalDelivered = true
  }

  if (envelope.envelopeType === 'closed') {
    state.closed = true
    if (!state.finalDelivered && envelope.terminalState !== 'validation_failed_before_execution') {
      state.stale = true
      return { ok: true, accepted: true, reason: 'closed_without_final_state_uncertain' }
    }
  }

  return { ok: true, accepted: true, reason: 'accepted' }
}
