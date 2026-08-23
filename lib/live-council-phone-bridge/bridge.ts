import { insertWarRoomAuditLog } from '@/lib/war-room/auditLog'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { executeCouncilChatRequest } from '@/app/api/chat/execute'
import { createTwilioClient, getTwilioConfig, normalizeE164, smsSafeSummary } from './twilio'

export const SMS_CONVERSATION_TITLE = 'LIVE_COUNCIL_COMMANDER_SMS'

/**
 * A `processing` inbound event older than this is treated as abandoned
 * (crashed/timed-out worker) and becomes eligible for atomic reclaim. Chosen
 * to comfortably exceed the Council round-trip's real-world worst case
 * (per-provider timeout is 10s; the full multi-provider/synthesis pipeline in
 * executeCouncilChatRequest can legitimately run well past that) while still
 * recovering an orphaned MessageSid within a Twilio-retry-relevant window.
 */
export const INBOUND_STALE_PROCESSING_SECONDS = 300
export const INBOUND_HEARTBEAT_INTERVAL_MS = 30_000

export async function touchInboundProcessing(sid: string): Promise<boolean> {
  const sup = tryWarRoomSupabase(); if (!sup.ok) return false
  const { data, error } = await sup.client.rpc('war_room_touch_twilio_inbound_processing', { p_message_sid: sid })
  return !error && data === true
}

export type BridgeState = 'NOT_CONFIGURED' | 'CONFIGURED' | 'ENABLED' | 'DISABLED' | 'BLOCKED_BY_ENVIRONMENT'
export function bridgeState(): BridgeState {
  const configured = Boolean(getTwilioConfig())
  if (!configured) return 'BLOCKED_BY_ENVIRONMENT'
  return 'CONFIGURED'
}
export function commanderIsAuthorized(from: string) { const config = getTwilioConfig(); return Boolean(config && normalizeE164(from) === config.commander) }

export type InboundClaimResult = 'claimed' | 'duplicate' | 'schema_required'

/**
 * Requires the unapplied `war_room_claim_twilio_inbound` RPC. The RPC owns a
 * unique MessageSid reservation via a single atomic UPDATE/INSERT statement,
 * so concurrent serverless deliveries — including Twilio retries of a
 * genuinely abandoned event — cannot both reach Council. Missing schema fails
 * closed; do not substitute process memory.
 */
export async function claimInboundMessageSid(sid: string): Promise<InboundClaimResult> {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return 'schema_required'
  const { data, error } = await sup.client.rpc('war_room_claim_twilio_inbound', {
    p_message_sid: sid,
    p_stale_after_seconds: INBOUND_STALE_PROCESSING_SECONDS,
  })
  if (error) return 'schema_required'
  return data === 'claimed' ? 'claimed' : 'duplicate'
}

export type InboundFailureCode =
  | 'PERSISTENCE_FAILED'
  | 'COUNCIL_FAILED'
  | 'OUTBOUND_FAILED'
  | 'PROCESSING_TIMEOUT'
  | 'BRIDGE_DISABLED'
  | 'UNKNOWN_FAILURE'

/** Terminal success transition. Only succeeds from `processing` — a retry racing a completed row is a no-op. */
export async function markInboundMessageCompleted(
  sid: string,
  provider?: { sid: string; status: string },
): Promise<boolean> {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return false
  const { data, error } = await sup.client.rpc('war_room_mark_twilio_inbound_completed', {
    p_message_sid: sid,
    p_provider_message_sid: provider?.sid ?? null,
    p_provider_status: provider?.status ?? null,
  })
  return !error && data === true
}

/** Terminal (but reclaimable) failure transition. Only succeeds from `processing`. */
export async function markInboundMessageFailed(sid: string, code: InboundFailureCode): Promise<boolean> {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return false
  const { data, error } = await sup.client.rpc('war_room_mark_twilio_inbound_failed', {
    p_message_sid: sid,
    p_error_code: code,
  })
  return !error && data === true
}
export async function recordOutboundAcceptance(sid: string, provider: { sid: string; status: string }): Promise<boolean> {
  const sup = tryWarRoomSupabase(); if (!sup.ok) return false
  const { data, error } = await sup.client.rpc('war_room_record_twilio_outbound_acceptance', { p_message_sid: sid, p_provider_message_sid: provider.sid, p_provider_status: provider.status })
  return !error && data === true
}

export type InboundEventSnapshot = {
  state: string
  providerMessageSid: string | null
  providerStatus: string | null
  attemptCount: number
}

/** Read-only lifecycle lookup. Returns null if the durable store is unavailable or the row doesn't exist. */
export async function getInboundEventSnapshot(sid: string): Promise<InboundEventSnapshot | null> {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return null
  const { data, error } = await sup.client.rpc('war_room_get_twilio_inbound_event', { p_message_sid: sid })
  if (error || !Array.isArray(data) || !data.length) return null
  const row = data[0] as { state: string; provider_message_sid: string | null; provider_status: string | null; attempt_count: number }
  return {
    state: row.state,
    providerMessageSid: row.provider_message_sid,
    providerStatus: row.provider_status,
    attemptCount: row.attempt_count,
  }
}

export async function getBridgeState(): Promise<BridgeState> {
  if (!getTwilioConfig()) return 'BLOCKED_BY_ENVIRONMENT'
  const sup = tryWarRoomSupabase(); if (!sup.ok) return 'BLOCKED_BY_ENVIRONMENT'
  const { data, error } = await sup.client.rpc('war_room_get_twilio_sms_bridge_state')
  if (error || typeof data !== 'string') return 'BLOCKED_BY_ENVIRONMENT'
  return ['ENABLED', 'DISABLED'].includes(data) ? data as BridgeState : 'BLOCKED_BY_ENVIRONMENT'
}
export async function setSmsBridgeEnabled(value: boolean): Promise<BridgeState> {
  const sup = tryWarRoomSupabase(); if (!sup.ok) return 'BLOCKED_BY_ENVIRONMENT'
  const { error } = await sup.client.rpc('war_room_set_twilio_sms_bridge_state', { p_enabled: value })
  return error ? 'BLOCKED_BY_ENVIRONMENT' : getBridgeState()
}

async function audit(message: string, metadata: Record<string, unknown>) {
  const sup = tryWarRoomSupabase()
  await insertWarRoomAuditLog(sup.ok ? sup.client : null, { actor: 'system', category: 'event', message, metadata })
}

export type CouncilDispatchResult =
  | { ok: true; conversationId: string; response: string }
  | { ok: false; code: 'SMS_BRIDGE_DISABLED' | 'BLOCKED_BY_ENVIRONMENT' | 'PERSISTENCE_FAILED' | 'COUNCIL_FAILED' }

/**
 * Idempotent per MessageSid: a retry of an already-dispatched inbound event
 * (Window 2/3 recovery — reclaimed `failed`/stale-`processing` row) neither
 * duplicates the persisted Commander message nor re-invokes Council if a
 * response for this exact MessageSid already exists.
 */
export async function submitCommanderSmsToLiveCouncil(input: { body: string; from: string; messageSid: string }): Promise<CouncilDispatchResult> {
  if (await getBridgeState() !== 'ENABLED') return { ok: false, code: 'SMS_BRIDGE_DISABLED' }
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return { ok: false, code: 'BLOCKED_BY_ENVIRONMENT' }

  const { data: resolvedConversationId, error: conversationError } = await sup.client.rpc('war_room_get_or_create_twilio_sms_conversation')
  if (conversationError || typeof resolvedConversationId !== 'string') return { ok: false, code: 'PERSISTENCE_FAILED' }
  const conversationId = resolvedConversationId

  // Window 3 recovery: a prior attempt for this MessageSid already produced and
  // persisted a Council response — reuse it instead of invoking Council again.
  const { data: existingAssistant, error: existingAssistantError } = await sup.client
    .from('war_room_messages')
    .select('content')
    .eq('conversation_id', conversationId)
    .eq('role', 'assistant')
    .eq('metadata->>inboundMessageId', input.messageSid)
    .maybeSingle()
  if (existingAssistantError) return { ok: false, code: 'PERSISTENCE_FAILED' }
  if (existingAssistant?.content) return { ok: true, conversationId, response: existingAssistant.content }

  // Window 2 recovery: only persist the Commander's inbound message once per MessageSid.
  const metadata = { idempotencyKey: `twilio:${input.messageSid}`, transport: 'SMS', source: 'COMMANDER_PHONE', channel: 'SMS', provider: 'TWILIO', inboundMessageId: input.messageSid, senderVerified: true }
  const { error: userInsertError } = await sup.client.rpc('war_room_upsert_twilio_sms_message', { p_conversation_id: conversationId, p_role: 'user', p_content: input.body, p_message_sid: input.messageSid, p_metadata: metadata })
  if (userInsertError) return { ok: false, code: 'PERSISTENCE_FAILED' }
  await audit('SMS_COUNCIL_DISPATCHED', { inboundMessageId: input.messageSid, conversationId })

  let canonical: string
  try {
    const response = await executeCouncilChatRequest(new Request('http://war-room.internal/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', 'x-war-room-sms-bridge': '1' }, body: JSON.stringify({ message: input.body, profile: 'Commander SMS transport', threadHistory: [], mode: 'live_council', toneMode: 'concise', councilSingleFamily: 'chatgpt', orchestrationAugment: 'Verified Commander SMS transport. Preserve all approval gates; never execute protected actions.', conversationId }) }))
    const payload = await response.json().catch(() => ({})) as { councilSingleResponse?: string; message?: string }
    canonical = payload.councilSingleResponse ?? payload.message ?? 'Council response unavailable.'
  } catch {
    return { ok: false, code: 'COUNCIL_FAILED' }
  }

  const { data: assistantRow, error: assistantInsertError } = await sup.client.rpc('war_room_upsert_twilio_sms_message', { p_conversation_id: conversationId, p_role: 'assistant', p_content: canonical, p_message_sid: input.messageSid, p_metadata: { transport: 'SMS', provider: 'TWILIO', inboundMessageId: input.messageSid, direction: 'OUTBOUND_PENDING' } })
  const canonicalRow = Array.isArray(assistantRow) ? assistantRow[0] : null
  if (assistantInsertError || !canonicalRow || typeof canonicalRow.content !== 'string') return { ok: false, code: 'PERSISTENCE_FAILED' }

  return { ok: true, conversationId, response: canonicalRow.content }
}

export type OutboundSmsResult =
  | { ok: true; sid: string; status: string }
  | { ok: false; code: 'SMS_BRIDGE_DISABLED' | 'OUTBOUND_FAILED' }

/**
 * Idempotent per MessageSid to the extent the architecture allows: if a prior
 * attempt already recorded a provider message SID for this inbound event, that
 * result is reused instead of sending a second SMS. The one residual gap —
 * Twilio accepts the send but the process crashes before that acceptance is
 * written back — is a real at-least-once limitation, not exactly-once; see
 * the crash-consistency repair report for the explicit statement of that
 * limitation. It is not silently claimed away here.
 */
export async function sendCouncilSmsResponse(text: string, messageSid: string): Promise<OutboundSmsResult> {
  const config = getTwilioConfig()
  if (!config || await getBridgeState() !== 'ENABLED') return { ok: false, code: 'SMS_BRIDGE_DISABLED' }

  const existing = await getInboundEventSnapshot(messageSid)
  if (existing?.providerMessageSid) {
    return { ok: true, sid: existing.providerMessageSid, status: existing.providerStatus ?? 'accepted' }
  }

  try {
    const message = await createTwilioClient(config).messages.create({ from: config.from, to: config.commander, body: smsSafeSummary(text) })
    if (!await recordOutboundAcceptance(messageSid, { sid: message.sid, status: message.status ?? 'accepted' })) return { ok: false, code: 'OUTBOUND_FAILED' }
    await audit('SMS_OUTBOUND_REQUESTED', { providerMessageId: message.sid, status: message.status ?? 'accepted' })
    return { ok: true, sid: message.sid, status: message.status ?? 'accepted' }
  } catch {
    return { ok: false, code: 'OUTBOUND_FAILED' }
  }
}
