'use client'

/**
 * Runtime event bridge — normalizes the REAL War Room runtime event sources into
 * Matrix palette channels (lib/ui/matrixStatusBus.ts). The bus remains the single
 * sink; this module only maps event shapes → { channel, caption } and emits.
 *
 * Channel semantics:
 * - cyan   incoming intelligence / provider data
 * - violet outgoing requests / provider queries
 * - amber  processing / synthesis / waiting
 * - green  successful completion / healthy baseline
 * - red    failure / disconnect / critical
 * - white  important verified completion / high-confidence intelligence arrival
 *
 * Every bridge function is a thin, side-effecting wrapper over a pure
 * `resolve*` mapper so the mapping is unit-testable without a DOM (the
 * validation file exercises only the pure resolvers).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WIRING HANDOFF (for the follow-up lane — this lane owns lib/ui only):
 *
 * 1. app/page.tsx — council SSE consumer (createCouncilSseParser onEvent):
 *      call `bridgeCouncilStreamEnvelope(parserEvent.envelope)` for each
 *      `parserEvent.ok === true` frame; for `parserEvent.ok === false` call
 *      `bridgeCouncilStreamFailure(parserEvent.error)`.
 * 2. components/council/CouncilDeliberationStream.tsx (progress-event poll/
 *      reducer loop): call `bridgeCouncilProgressEvent(event)` for each new
 *      CouncilProgressEventEnvelope applied.
 * 3. lib/cognitive-bus subscribers (wherever CognitiveBusEvents are consumed,
 *      e.g. council session UI): call `bridgeCognitiveBusEvent(event)`.
 * 4. components/war-room/terra/useTerraLayer.ts — inside `load`, where `setState`
 *      transitions happen: call `bridgeTerraFeedState(layerId, nextState)` on
 *      each transition (loading/live/empty/error/stale).
 * 5. Research-engine provider call sites (or app/page.tsx gather flows):
 *      `bridgeProviderQueryStart(providerId)` before the fetch,
 *      `bridgeProviderQueryResponse(providerId, ok)` on settle.
 * 6. lib/events/bus.ts emitEvent consumers (if a live UI subscription exists):
 *      call `bridgeWarRoomEvent(event)`.
 * 7. Existing `useMatrixStatus()` call sites need NO change — legacy kinds map
 *    onto channels inside the bus. Optionally migrate them to channels later.
 * ────────────────────────────────────────────────────────────────────────────
 */

import type { CognitiveBusEvent } from '@/lib/cognitive-bus/types'
import type { CouncilStreamEnvelope, CouncilStreamSanitizedError } from '@/lib/council/incremental-transport/types'
import type { CouncilProgressEventEnvelope } from '@/lib/council/progress-events/types'
import type { WarRoomEvent } from '@/lib/events/types'
import type { TerraLayerFeedState } from '@/components/war-room/terra/useTerraLayer'

import { matrixChannelStatus, type MatrixChannel } from './matrixStatusBus'

export type MatrixBridgeSignal = {
  channel: MatrixChannel
  caption: string
}

const HIGH_CONFIDENCE_THRESHOLD = 0.8

// ── Pure resolvers (no side effects, DOM-free) ────────────────────────────────

export function resolveCouncilStreamEnvelope(envelope: CouncilStreamEnvelope): MatrixBridgeSignal | null {
  switch (envelope.envelopeType) {
    case 'opened':
      return { channel: 'amber', caption: 'Council stream opened' }
    case 'progress':
      return resolveCouncilProgressEvent(envelope.progressEvent)
    case 'final':
      if (envelope.status === 'completed') return { channel: 'white', caption: 'Council response verified complete' }
      if (envelope.status === 'partial') return { channel: 'green', caption: 'Council response partially complete' }
      return { channel: 'red', caption: 'Council response failed' }
    case 'error':
      return { channel: 'red', caption: `Council stream error: ${envelope.error.message}` }
    case 'closed':
      return { channel: 'green', caption: 'Council stream closed' }
    default:
      return null
  }
}

export function resolveCouncilStreamFailure(error: CouncilStreamSanitizedError): MatrixBridgeSignal {
  return { channel: 'red', caption: `Council stream failed: ${error.message}` }
}

export function resolveCognitiveBusEvent(event: CognitiveBusEvent): MatrixBridgeSignal | null {
  switch (event.type) {
    case 'signal_received':
      return { channel: 'cyan', caption: 'Signal received' }
    case 'provider_packet': {
      const integrity = event.payload.integrity_status
      const confidence = typeof event.payload.confidence === 'number' ? event.payload.confidence : null
      if (integrity === 'verified' && confidence !== null && confidence >= HIGH_CONFIDENCE_THRESHOLD) {
        return { channel: 'white', caption: 'Verified high-confidence provider intelligence' }
      }
      if (integrity === 'degraded' || integrity === 'incomplete') {
        return { channel: 'amber', caption: 'Provider packet integrity degraded' }
      }
      return { channel: 'cyan', caption: 'Provider packet received' }
    }
    case 'contradiction_raised':
      return { channel: 'amber', caption: 'Contradiction raised in council' }
    case 'challenge':
      return { channel: 'amber', caption: 'Council challenge issued' }
    case 'synthesis_step':
      return { channel: 'amber', caption: 'Council synthesis in progress' }
    case 'delegation':
      return { channel: 'violet', caption: 'Delegating to specialist family' }
    case 'routing':
      return { channel: 'violet', caption: 'Routing council signal' }
    case 'escalation':
      return { channel: 'amber', caption: 'Escalation pending Commander review' }
    case 'operator_packet': {
      const status = event.payload.status
      if (status === 'APPROVED') return { channel: 'white', caption: 'Operator packet approved' }
      if (status === 'REJECTED') return { channel: 'red', caption: 'Operator packet rejected' }
      return { channel: 'amber', caption: 'Operator packet proposed' }
    }
    default:
      return null
  }
}

export function resolveCouncilProgressEvent(event: CouncilProgressEventEnvelope): MatrixBridgeSignal | null {
  const family = event.family ? String(event.family) : null
  const familySuffix = family ? `: ${family}` : ''
  switch (event.eventType) {
    // Outgoing requests / dispatch
    case 'request_created':
    case 'request_started':
      return { channel: 'violet', caption: 'Council request dispatched' }
    case 'family_dispatched':
      return { channel: 'violet', caption: `Family dispatched${familySuffix}` }
    case 'family_retrieval_started':
      return { channel: 'violet', caption: `Retrieval started${familySuffix}` }
    // Incoming intelligence
    case 'family_retrieval_completed':
      return { channel: 'cyan', caption: `Retrieval returned${familySuffix}` }
    case 'family_response_completed':
      return { channel: 'cyan', caption: `Family response received${familySuffix}` }
    case 'family_prior_response_delivered':
      return { channel: 'cyan', caption: 'Prior response delivered downstream' }
    // Processing / waiting
    case 'family_waiting':
    case 'family_queued':
      return { channel: 'amber', caption: `Family queued${familySuffix}` }
    case 'family_response_started':
      return { channel: 'amber', caption: `Family responding${familySuffix}` }
    case 'family_reviewing_previous':
      return { channel: 'amber', caption: `Reviewing prior response${familySuffix}` }
    case 'fallback_started':
      return { channel: 'amber', caption: 'Fallback path engaged' }
    case 'audit_started':
    case 'audit_scope_declared':
      return { channel: 'amber', caption: 'Council audit in progress' }
    case 'request_selection_resolved':
    case 'diagnostic_recorded':
      return { channel: 'amber', caption: 'Council orchestration update' }
    // Success / healthy completion
    case 'fallback_completed':
      return { channel: 'green', caption: 'Fallback path completed' }
    case 'audit_completed':
      return { channel: 'green', caption: 'Council audit completed' }
    case 'family_skipped_by_policy':
    case 'family_not_reached':
    case 'family_stopped_by_commander':
    case 'request_cancel_requested':
    case 'request_cancelled':
      return { channel: 'amber', caption: 'Council branch halted' }
    // Verified completion
    case 'request_completed':
      return { channel: 'white', caption: 'Council request completed' }
    // Failures / critical
    case 'request_failed':
    case 'family_failed':
    case 'fallback_failed':
    case 'audit_failed':
      return { channel: 'red', caption: `Council failure${familySuffix}` }
    case 'request_timed_out':
    case 'family_timed_out':
      return { channel: 'red', caption: `Council timeout${familySuffix}` }
    default:
      return null
  }
}

export function resolveTerraFeedState(layerId: string, state: TerraLayerFeedState): MatrixBridgeSignal {
  switch (state) {
    case 'loading':
      return { channel: 'violet', caption: `Querying layer: ${layerId}` }
    case 'live':
      return { channel: 'cyan', caption: `Intel live: ${layerId}` }
    case 'empty':
      return { channel: 'green', caption: `No signals: ${layerId}` }
    case 'error':
      return { channel: 'red', caption: `Feed failed: ${layerId}` }
    case 'stale':
      return { channel: 'amber', caption: `Feed stale: ${layerId}` }
    default:
      return { channel: 'green', caption: `Layer idle: ${layerId}` }
  }
}

export function resolveProviderQueryStart(providerId: string): MatrixBridgeSignal {
  return { channel: 'violet', caption: `Querying provider: ${providerId}` }
}

export function resolveProviderQueryResponse(providerId: string, ok: boolean): MatrixBridgeSignal {
  return ok
    ? { channel: 'cyan', caption: `Provider responded: ${providerId}` }
    : { channel: 'red', caption: `Provider failed: ${providerId}` }
}

export function resolveWarRoomEvent(event: WarRoomEvent): MatrixBridgeSignal | null {
  switch (event.type) {
    case 'internet.query.started':
      return { channel: 'violet', caption: 'Internet query dispatched' }
    case 'internet.query.completed':
      return { channel: 'cyan', caption: 'Internet intelligence received' }
    case 'action.failed':
      return { channel: 'red', caption: 'Action failed' }
    case 'action.approval_required':
      return { channel: 'amber', caption: 'Action awaiting approval' }
    case 'action.completed':
    case 'action.approved':
    case 'action.auto_approved':
      return { channel: 'green', caption: 'Action completed' }
    case 'red_sentinel.scan.started':
      return { channel: 'violet', caption: 'Red Sentinel scan started' }
    case 'red_sentinel.scan.completed':
      return { channel: 'cyan', caption: 'Red Sentinel scan returned' }
    case 'income.deposit.confirmed':
      return { channel: 'white', caption: 'Deposit confirmed' }
    case 'income.opportunity.discovered':
      return { channel: 'cyan', caption: 'Income opportunity discovered' }
    case 'audit.logged':
      return null // too chatty for the matrix
    default:
      return null
  }
}

// ── Emitting bridges (thin wrappers over the bus) ─────────────────────────────

function emit(signal: MatrixBridgeSignal | null): void {
  if (!signal) return
  matrixChannelStatus(signal.channel, signal.caption)
}

export function bridgeCouncilStreamEnvelope(envelope: CouncilStreamEnvelope): void {
  emit(resolveCouncilStreamEnvelope(envelope))
}

export function bridgeCouncilStreamFailure(error: CouncilStreamSanitizedError): void {
  emit(resolveCouncilStreamFailure(error))
}

export function bridgeCognitiveBusEvent(event: CognitiveBusEvent): void {
  emit(resolveCognitiveBusEvent(event))
}

export function bridgeCouncilProgressEvent(event: CouncilProgressEventEnvelope): void {
  emit(resolveCouncilProgressEvent(event))
}

export function bridgeTerraFeedState(layerId: string, state: TerraLayerFeedState): void {
  emit(resolveTerraFeedState(layerId, state))
}

export function bridgeProviderQueryStart(providerId: string): void {
  emit(resolveProviderQueryStart(providerId))
}

export function bridgeProviderQueryResponse(providerId: string, ok: boolean): void {
  emit(resolveProviderQueryResponse(providerId, ok))
}

export function bridgeWarRoomEvent(event: WarRoomEvent): void {
  emit(resolveWarRoomEvent(event))
}
