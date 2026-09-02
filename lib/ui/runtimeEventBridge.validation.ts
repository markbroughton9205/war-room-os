/**
 * Validation for lib/ui/runtimeEventBridge.ts — pure resolver mapping only (no DOM).
 * Runs via:
 * `node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/ui/runtimeEventBridge.validation.ts`
 */

import type { CognitiveBusEvent } from '../cognitive-bus/types'
import type { CouncilStreamEnvelope } from '../council/incremental-transport/types'
import type { CouncilProgressEventEnvelope } from '../council/progress-events/types'
import type { WarRoomEvent } from '../events/types'
import type { TerraLayerFeedState } from '../../components/war-room/terra/useTerraLayer'

import {
  resolveCognitiveBusEvent,
  resolveCouncilProgressEvent,
  resolveCouncilStreamEnvelope,
  resolveCouncilStreamFailure,
  resolveProviderQueryResponse,
  resolveProviderQueryStart,
  resolveTerraFeedState,
  resolveWarRoomEvent,
  type MatrixBridgeSignal,
} from './runtimeEventBridge'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []

function expectChannel(name: string, signal: MatrixBridgeSignal | null, channel: MatrixBridgeSignal['channel'] | null) {
  const actual = signal ? signal.channel : null
  results.push({
    name,
    pass: actual === channel,
    detail: `expected ${channel}; received ${actual}${signal ? `; caption="${signal.caption}"` : ''}`,
  })
}

// ── Council stream envelopes ──────────────────────────────────────────────────
const baseEnvelope = {
  version: '47c.council-stream.v1',
  requestId: 'req-1',
  operationId: null,
  sequence: 1,
  emittedAt: new Date().toISOString(),
}

expectChannel(
  'stream_opened_is_amber',
  resolveCouncilStreamEnvelope({ ...baseEnvelope, envelopeType: 'opened' } as unknown as CouncilStreamEnvelope),
  'amber',
)
expectChannel(
  'stream_final_completed_is_white',
  resolveCouncilStreamEnvelope({
    ...baseEnvelope,
    envelopeType: 'final',
    status: 'completed',
  } as unknown as CouncilStreamEnvelope),
  'white',
)
expectChannel(
  'stream_final_partial_is_green',
  resolveCouncilStreamEnvelope({
    ...baseEnvelope,
    envelopeType: 'final',
    status: 'partial',
  } as unknown as CouncilStreamEnvelope),
  'green',
)
expectChannel(
  'stream_final_failed_is_red',
  resolveCouncilStreamEnvelope({
    ...baseEnvelope,
    envelopeType: 'final',
    status: 'failed',
  } as unknown as CouncilStreamEnvelope),
  'red',
)
expectChannel(
  'stream_error_is_red',
  resolveCouncilStreamEnvelope({
    ...baseEnvelope,
    envelopeType: 'error',
    error: { code: 'transport_error', message: 'boom', terminal: true, classification: 'transport' },
  } as unknown as CouncilStreamEnvelope),
  'red',
)
expectChannel(
  'stream_closed_is_green',
  resolveCouncilStreamEnvelope({ ...baseEnvelope, envelopeType: 'closed', terminalState: 'completed' } as unknown as CouncilStreamEnvelope),
  'green',
)
expectChannel(
  'stream_transport_failure_is_red',
  resolveCouncilStreamFailure({ code: 'transport_error', message: 'lost', terminal: true, classification: 'transport' }),
  'red',
)

// ── Cognitive bus events ──────────────────────────────────────────────────────
function cogEvent(type: CognitiveBusEvent['type'], payload: Record<string, unknown> = {}): CognitiveBusEvent {
  return { id: 'e1', threadId: 't1', type, at: new Date().toISOString(), payload }
}

expectChannel('cog_signal_received_is_cyan', resolveCognitiveBusEvent(cogEvent('signal_received')), 'cyan')
expectChannel('cog_plain_provider_packet_is_cyan', resolveCognitiveBusEvent(cogEvent('provider_packet')), 'cyan')
expectChannel(
  'cog_verified_high_confidence_packet_is_white',
  resolveCognitiveBusEvent(cogEvent('provider_packet', { integrity_status: 'verified', confidence: 0.9 })),
  'white',
)
expectChannel(
  'cog_verified_low_confidence_packet_is_cyan',
  resolveCognitiveBusEvent(cogEvent('provider_packet', { integrity_status: 'verified', confidence: 0.4 })),
  'cyan',
)
expectChannel(
  'cog_degraded_packet_is_amber',
  resolveCognitiveBusEvent(cogEvent('provider_packet', { integrity_status: 'degraded', confidence: 0.9 })),
  'amber',
)
expectChannel('cog_synthesis_step_is_amber', resolveCognitiveBusEvent(cogEvent('synthesis_step')), 'amber')
expectChannel('cog_delegation_is_violet', resolveCognitiveBusEvent(cogEvent('delegation')), 'violet')
expectChannel('cog_routing_is_violet', resolveCognitiveBusEvent(cogEvent('routing')), 'violet')
expectChannel('cog_escalation_is_amber', resolveCognitiveBusEvent(cogEvent('escalation')), 'amber')
expectChannel(
  'cog_operator_packet_approved_is_white',
  resolveCognitiveBusEvent(cogEvent('operator_packet', { status: 'APPROVED' })),
  'white',
)
expectChannel(
  'cog_operator_packet_rejected_is_red',
  resolveCognitiveBusEvent(cogEvent('operator_packet', { status: 'REJECTED' })),
  'red',
)
expectChannel(
  'cog_operator_packet_proposed_is_amber',
  resolveCognitiveBusEvent(cogEvent('operator_packet', { status: 'PROPOSED' })),
  'amber',
)

// ── Council progress events ───────────────────────────────────────────────────
function progressEvent(eventType: CouncilProgressEventEnvelope['eventType']): CouncilProgressEventEnvelope {
  return {
    schemaVersion: '47c2.council-progress-event.v1',
    eventId: 'evt-1' as CouncilProgressEventEnvelope['eventId'],
    requestId: 'req-1' as CouncilProgressEventEnvelope['requestId'],
    sequence: 1,
    eventType,
    occurredAt: new Date().toISOString(),
    family: null,
    source: 'client_orchestrator',
    payload: {},
    visibility: 'operator',
  } as unknown as CouncilProgressEventEnvelope
}

const progressExpectations: Array<[CouncilProgressEventEnvelope['eventType'], MatrixBridgeSignal['channel']]> = [
  ['request_created', 'violet'],
  ['request_started', 'violet'],
  ['family_dispatched', 'violet'],
  ['family_retrieval_started', 'violet'],
  ['family_retrieval_completed', 'cyan'],
  ['family_response_completed', 'cyan'],
  ['family_prior_response_delivered', 'cyan'],
  ['family_waiting', 'amber'],
  ['family_queued', 'amber'],
  ['family_response_started', 'amber'],
  ['family_reviewing_previous', 'amber'],
  ['fallback_started', 'amber'],
  ['audit_started', 'amber'],
  ['request_selection_resolved', 'amber'],
  ['diagnostic_recorded', 'amber'],
  ['fallback_completed', 'green'],
  ['audit_completed', 'green'],
  ['family_skipped_by_policy', 'amber'],
  ['family_not_reached', 'amber'],
  ['family_stopped_by_commander', 'amber'],
  ['request_cancel_requested', 'amber'],
  ['request_cancelled', 'amber'],
  ['request_completed', 'white'],
  ['request_failed', 'red'],
  ['family_failed', 'red'],
  ['fallback_failed', 'red'],
  ['audit_failed', 'red'],
  ['request_timed_out', 'red'],
  ['family_timed_out', 'red'],
]
for (const [eventType, channel] of progressExpectations) {
  expectChannel(`progress_${eventType}_is_${channel}`, resolveCouncilProgressEvent(progressEvent(eventType)), channel)
}

// ── Terra feed states ─────────────────────────────────────────────────────────
const terraExpectations: Array<[TerraLayerFeedState, MatrixBridgeSignal['channel']]> = [
  ['loading', 'violet'],
  ['live', 'cyan'],
  ['empty', 'green'],
  ['error', 'red'],
  ['stale', 'amber'],
]
for (const [state, channel] of terraExpectations) {
  expectChannel(`terra_${state}_is_${channel}`, resolveTerraFeedState('usgs-earthquakes', state), channel)
}

// ── Provider query helpers ────────────────────────────────────────────────────
expectChannel('provider_query_start_is_violet', resolveProviderQueryStart('usgs'), 'violet')
expectChannel('provider_query_response_ok_is_cyan', resolveProviderQueryResponse('usgs', true), 'cyan')
expectChannel('provider_query_response_fail_is_red', resolveProviderQueryResponse('usgs', false), 'red')

// ── War Room bus events ───────────────────────────────────────────────────────
function warEvent(type: WarRoomEvent['type']): WarRoomEvent {
  return { id: 'w1', type, createdAt: new Date().toISOString(), payload: {}, source: 'system' }
}

expectChannel('war_internet_query_started_is_violet', resolveWarRoomEvent(warEvent('internet.query.started')), 'violet')
expectChannel('war_internet_query_completed_is_cyan', resolveWarRoomEvent(warEvent('internet.query.completed')), 'cyan')
expectChannel('war_action_failed_is_red', resolveWarRoomEvent(warEvent('action.failed')), 'red')
expectChannel('war_action_approval_required_is_amber', resolveWarRoomEvent(warEvent('action.approval_required')), 'amber')
expectChannel('war_action_completed_is_green', resolveWarRoomEvent(warEvent('action.completed')), 'green')
expectChannel('war_deposit_confirmed_is_white', resolveWarRoomEvent(warEvent('income.deposit.confirmed')), 'white')
expectChannel('war_audit_logged_is_dropped', resolveWarRoomEvent(warEvent('audit.logged')), null)

for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name}: ${result.detail}`)
if (results.some(result => !result.pass)) process.exitCode = 1
