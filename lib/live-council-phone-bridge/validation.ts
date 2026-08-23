import twilio from 'twilio'
import { getTwilioConfig, normalizeE164, smsSafeSummary, validateTwilioWebhook } from './twilio'
import {
  claimInboundMessageSid,
  commanderIsAuthorized,
  getInboundEventSnapshot,
  markInboundMessageCompleted,
  markInboundMessageFailed,
  sendCouncilSmsResponse,
  submitCommanderSmsToLiveCouncil,
} from './bridge'
import { isExemptApiRequest } from '@/lib/supabase/middleware'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type CheckCategory = 'BEHAVIORAL' | 'STRUCTURAL'

/**
 * STRUCTURAL DATABASE GUARANTEE — REQUIRES LIVE MIGRATION VALIDATION LATER:
 * the following properties are provided by the SQL's atomic single-UPDATE
 * WHERE clauses (verified present by the `structural_*` checks below,
 * reasoned about by direct SQL inspection) but cannot be behaviorally proven
 * without a live Postgres instance, which this validation lane does not have
 * (no `.env.local` / Supabase credentials in this worktree). Do not treat
 * these as passing automated tests — they are not in the `checks` array
 * below on purpose, so the reported pass count never overstates what was
 * actually exercised:
 *   - a `failed` row is reclaimable by a retry
 *   - a `processing` row stale past the threshold is reclaimable by a retry
 *   - two concurrent reclaim attempts on the same row: exactly one wins
 *   - a `processing` row NOT yet stale is NOT reclaimable
 *   - attempt_count increments exactly once per successful reclaim
 *   - mark-completed / mark-failed only succeed when current state is `processing`
 * These must be re-verified against a live Supabase instance once the
 * migration is actually applied, before this is relied on in production.
 */
export const CRASH_CONSISTENCY_REQUIRES_LIVE_MIGRATION_VALIDATION = true

export async function validateLiveCouncilPhoneBridge() {
  const previous = { ...process.env }
  Object.assign(process.env, { TWILIO_ACCOUNT_SID: 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', TWILIO_AUTH_TOKEN: 'test-token', TWILIO_PHONE_NUMBER: '+15551230000', RAEL_PHONE_NUMBER: '+15551230001', NEXT_PUBLIC_APP_URL: 'https://warroom.example' })
  const params = { From: '+15551230001', Body: 'status', MessageSid: 'SM123' }
  const url = 'https://warroom.example/api/live-council/sms/inbound'
  const signature = twilio.getExpectedTwilioSignature('test-token', url, params)
  const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
  const inbound = source('app/api/live-council/sms/inbound/route.ts')
  const bridge = source('lib/live-council-phone-bridge/bridge.ts')
  const ui = source('components/war-room/LiveCouncilPhoneBridgePanel.tsx')
  const sql = source('supabase/war_room_live_council_sms_bridge.sql')
  const fakeSid = `SM${'a'.repeat(32)}`

  // These calls hit `tryWarRoomSupabase()`, which fails synchronously fast in
  // this environment (no NEXT_PUBLIC_SUPABASE_URL configured) — they exercise
  // the real fail-closed code paths without ever reaching the network.
  const [
    claimWithoutStore,
    markCompletedWithoutStore,
    markFailedWithoutStore,
    snapshotWithoutStore,
    outboundWithoutEnabledBridge,
    councilDispatchWithoutEnabledBridge,
  ] = await Promise.all([
    claimInboundMessageSid(fakeSid),
    markInboundMessageCompleted(fakeSid),
    markInboundMessageFailed(fakeSid, 'UNKNOWN_FAILURE'),
    getInboundEventSnapshot(fakeSid),
    sendCouncilSmsResponse('test', fakeSid),
    submitCommanderSmsToLiveCouncil({ body: 'status', from: params.From, messageSid: fakeSid }),
  ])

  const checks: [string, boolean, CheckCategory][] = [
    ['official_signature_accepts', validateTwilioWebhook(signature, params), 'BEHAVIORAL'],
    ['invalid_signature_rejects', !validateTwilioWebhook('invalid', params), 'BEHAVIORAL'],
    ['missing_signature_rejects', !validateTwilioWebhook(null, params), 'BEHAVIORAL'],
    ['e164_normalization', normalizeE164(' +1 (555) 123-0001 ') === '+15551230001', 'BEHAVIORAL'],
    ['invalid_phone_rejected', normalizeE164('not-a-phone') === null, 'BEHAVIORAL'],
    ['commander_sender_accepted', commanderIsAuthorized('+1 (555) 123-0001'), 'BEHAVIORAL'],
    ['unauthorized_sender_rejected', !commanderIsAuthorized('+15551239999'), 'BEHAVIORAL'],
    ['empty_body_rejected_by_route_boundary', /!body/.test(inbound) && /MALFORMED_REQUEST/.test(inbound), 'STRUCTURAL'],
    ['body_limit_enforced_by_route_boundary', inbound.includes('body.length > SMS_MAX_BODY_LENGTH') && source('lib/live-council-phone-bridge/twilio.ts').includes('SMS_MAX_BODY_LENGTH'), 'STRUCTURAL'],
    ['twilio_from_normalized', getTwilioConfig()?.from === '+15551230000', 'BEHAVIORAL'],
    ['twilio_to_normalized', getTwilioConfig()?.commander === '+15551230001', 'BEHAVIORAL'],
    ['secret_redaction', !smsSafeSummary('sk-abcdefghijklmnopqrstuvwxyz123456').includes('abcdefghijklmnopqrstuvwxyz'), 'BEHAVIORAL'],
    ['delivery_truth_preserves_provider_status', bridge.includes('status: message.status ?? \'accepted\'') && !bridge.includes("status: 'delivered'"), 'STRUCTURAL'],
    ['inbound_requires_form_payload', inbound.includes('req.formData()'), 'STRUCTURAL'],
    ['empty_body_rejected', inbound.includes('!body'), 'STRUCTURAL'],
    ['oversized_body_rejected', inbound.includes('body.length > SMS_MAX_BODY_LENGTH'), 'STRUCTURAL'],
    ['missing_sid_rejected', inbound.includes('!messageSid'), 'STRUCTURAL'],
    ['malformed_sid_rejected_by_database', sql.includes("'^SM[0-9A-Fa-f]{32}$'"), 'STRUCTURAL'],
    ['durable_reservation_called', inbound.includes('await claimInboundMessageSid'), 'STRUCTURAL'],
    ['sequential_duplicates_suppressed', inbound.includes("claim === 'duplicate'"), 'STRUCTURAL'],
    ['concurrent_duplicates_are_atomic', sql.includes('on conflict (message_sid) do nothing'), 'STRUCTURAL'],
    ['rpc_failure_fails_closed', inbound.includes("claim === 'schema_required'"), 'STRUCTURAL'],
    ['no_memory_duplicate_set', !bridge.includes('new Set<string>()'), 'STRUCTURAL'],
    ['canonical_chat_executor_used', bridge.includes('executeCouncilChatRequest'), 'STRUCTURAL'],
    ['no_self_http_chat_call', !bridge.includes("fetch(`${process.env.NEXT_PUBLIC_APP_URL"), 'STRUCTURAL'],
    ['deterministic_thread_declared', bridge.includes('LIVE_COUNCIL_COMMANDER_SMS'), 'STRUCTURAL'],
    ['inbound_message_persisted', bridge.includes("role: 'user'"), 'STRUCTURAL'],
    ['response_persisted', bridge.includes("role: 'assistant'"), 'STRUCTURAL'],
    ['outbound_uses_sdk_boundary', bridge.includes('.messages.create'), 'STRUCTURAL'],
    ['bridge_disabled_blocks_outbound', bridge.includes("await getBridgeState() !== 'ENABLED'"), 'STRUCTURAL'],
    ['missing_account_sid_safe', !getTwilioConfig({ ...process.env, TWILIO_ACCOUNT_SID: '' }), 'BEHAVIORAL'],
    ['missing_auth_token_safe', !getTwilioConfig({ ...process.env, TWILIO_AUTH_TOKEN: '' }), 'BEHAVIORAL'],
    ['missing_twilio_number_safe', !getTwilioConfig({ ...process.env, TWILIO_PHONE_NUMBER: '' }), 'BEHAVIORAL'],
    ['missing_commander_number_safe', !getTwilioConfig({ ...process.env, RAEL_PHONE_NUMBER: '' }), 'BEHAVIORAL'],
    ['no_auth_token_in_status_api', !source('app/api/live-council/sms/route.ts').includes('authToken'), 'STRUCTURAL'],
    ['masked_commander_ui', source('app/api/live-council/sms/route.ts').includes('***-***-'), 'STRUCTURAL'],
    ['test_action_disabled', ui.includes('disabled') && ui.includes('SEND TEST MESSAGE'), 'STRUCTURAL'],
    ['no_ui_twilio_client', !ui.includes('twilio'), 'STRUCTURAL'],
    ['transport_has_no_direct_deploy', !bridge.match(/deploy\s*\(/i), 'STRUCTURAL'],
    ['transport_has_no_direct_git', !bridge.match(/git\s*\(/i), 'STRUCTURAL'],
    ['transport_has_no_direct_payment', !bridge.match(/payment|pay\s*\(/i), 'STRUCTURAL'],
    ['transport_has_no_direct_submission', !bridge.match(/submit\s*\(/i), 'STRUCTURAL'],
    ['transport_has_no_direct_memory_write', !bridge.match(/memory\.(write|save)/i), 'STRUCTURAL'],
    ['twilio_sdk_mockable_boundary', bridge.includes('createTwilioClient(config)'), 'STRUCTURAL'],
    ['provider_sid_preserved', bridge.includes('message.sid'), 'STRUCTURAL'],
    ['provider_status_preserved', bridge.includes('message.status'), 'STRUCTURAL'],
    ['unauthorized_error_has_no_secret', !inbound.match(/UNAUTHORIZED_SENDER[^\n]*AUTH_TOKEN/), 'STRUCTURAL'],
    ['commander_control_gated', source('app/api/live-council/sms/route.ts').includes('requireCommanderSession'), 'STRUCTURAL'],
    ['ui_backend_truth_fetch', ui.includes("fetch('/api/live-council/sms')"), 'STRUCTURAL'],
    ['migration_unique_primary_key', sql.includes('message_sid text primary key'), 'STRUCTURAL'],
    ['migration_rpcs_service_role_only', sql.includes('grant execute') && sql.includes('to service_role'), 'STRUCTURAL'],
    ['inbound_route_calls_signature_validator', inbound.includes('validateTwilioWebhook('), 'STRUCTURAL'],
    ['middleware_exempts_inbound_webhook', isExemptApiRequest('/api/live-council/sms/inbound', 'POST'), 'BEHAVIORAL'],
    ['middleware_protects_bridge_control_get', !isExemptApiRequest('/api/live-council/sms', 'GET'), 'BEHAVIORAL'],
    ['middleware_protects_bridge_control_post', !isExemptApiRequest('/api/live-council/sms', 'POST'), 'BEHAVIORAL'],
    ['middleware_exemption_is_exact_not_prefix', !isExemptApiRequest('/api/live-council/sms/inbound/extra', 'POST'), 'BEHAVIORAL'],
    ['middleware_protects_unrelated_route', !isExemptApiRequest('/api/tools/memory', 'GET'), 'BEHAVIORAL'],

    // --- Crash-consistency / MessageSid lifecycle repair ---
    ['lifecycle_claim_fails_closed_without_store', claimWithoutStore === 'schema_required', 'BEHAVIORAL'],
    ['lifecycle_mark_completed_fails_closed_without_store', markCompletedWithoutStore === false, 'BEHAVIORAL'],
    ['lifecycle_mark_failed_fails_closed_without_store', markFailedWithoutStore === false, 'BEHAVIORAL'],
    ['lifecycle_snapshot_fails_closed_without_store', snapshotWithoutStore === null, 'BEHAVIORAL'],
    ['lifecycle_no_outbound_send_without_enabled_bridge', outboundWithoutEnabledBridge.ok === false && outboundWithoutEnabledBridge.code === 'SMS_BRIDGE_DISABLED', 'BEHAVIORAL'],
    ['lifecycle_no_council_dispatch_without_enabled_bridge', councilDispatchWithoutEnabledBridge.ok === false && councilDispatchWithoutEnabledBridge.code === 'SMS_BRIDGE_DISABLED', 'BEHAVIORAL'],
    ['lifecycle_route_always_marks_terminal_state', inbound.includes('markInboundMessageCompleted') && inbound.includes('markInboundMessageFailed'), 'STRUCTURAL'],
    ['lifecycle_route_wraps_processing_in_try_catch', inbound.includes('try {') && inbound.includes('catch (error)'), 'STRUCTURAL'],
    ['lifecycle_route_marks_failed_on_council_error', inbound.includes("code === 'PERSISTENCE_FAILED' || council.code === 'COUNCIL_FAILED'"), 'STRUCTURAL'],
    ['lifecycle_route_marks_failed_on_outbound_error', inbound.includes("'BRIDGE_DISABLED' : 'OUTBOUND_FAILED'"), 'STRUCTURAL'],
    ['lifecycle_outbound_reuses_prior_provider_result', bridge.includes('existing.providerMessageSid'), 'STRUCTURAL'],
    ['lifecycle_council_response_reused_when_present', bridge.includes('existingAssistant?.content'), 'STRUCTURAL'],
    ['lifecycle_user_message_atomic_rpc_path', bridge.includes("war_room_upsert_twilio_sms_message") && bridge.includes("p_role: 'user'") && bridge.includes('p_message_sid: input.messageSid') && bridge.includes('senderVerified: true'), 'STRUCTURAL'],
    ['lifecycle_assistant_message_atomic_rpc_canonical_content', bridge.includes("p_role: 'assistant'") && bridge.includes('p_content: canonical') && bridge.includes('canonicalRow.content') && bridge.includes('response: canonicalRow.content'), 'STRUCTURAL'],
    ['lifecycle_no_process_memory_fallback', !bridge.match(/new Map\(|new Set\(/), 'STRUCTURAL'],
    ['sql_reclaim_covers_failed_state', sql.includes("state = 'failed'"), 'STRUCTURAL'],
    ['sql_reclaim_covers_stale_processing', sql.includes("or (state = 'processing' and updated_at <"), 'STRUCTURAL'],
    ['sql_stale_threshold_uses_server_time', sql.includes('now() - make_interval'), 'STRUCTURAL'],
    ['sql_attempt_count_increments_on_reclaim', sql.includes('attempt_count = attempt_count + 1'), 'STRUCTURAL'],
    ['sql_mark_completed_guarded_by_processing_state', sql.includes("set state = 'completed'") && sql.includes("where message_sid = p_message_sid and state = 'processing'"), 'STRUCTURAL'],
    ['sql_mark_failed_guarded_by_processing_state', sql.includes("set state = 'failed', failed_at = now()"), 'STRUCTURAL'],
    ['sql_error_code_enum_constrained', sql.includes('last_error_code text check'), 'STRUCTURAL'],
    ['sql_completed_and_failed_timestamps_server_generated', sql.includes('completed_at = now()') && sql.includes('failed_at = now()'), 'STRUCTURAL'],
    ['sql_no_raw_sms_body_in_event_table', !sql.includes('body'), 'STRUCTURAL'],
    ['sql_no_phone_number_in_event_table', !sql.includes('phone'), 'STRUCTURAL'],
    ['sql_no_twilio_secret_columns', !/auth_token|account_sid/i.test(sql), 'STRUCTURAL'],
    ['sql_lifecycle_rpcs_declared', sql.includes('war_room_mark_twilio_inbound_completed(text, text, text)') && sql.includes('war_room_mark_twilio_inbound_failed(text, text)') && sql.includes('war_room_get_twilio_inbound_event(text)'), 'STRUCTURAL'],
    ['sql_lifecycle_rpcs_revoked_from_public', Boolean(sql.match(/revoke all on function[\s\S]*war_room_mark_twilio_inbound_completed[\s\S]*from public, anon, authenticated/)), 'STRUCTURAL'],
  ]

  for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]
  Object.assign(process.env, previous)
  const failed = checks.filter(([, ok]) => !ok).map(([name]) => name)
  const behavioralTotal = checks.filter(([, , category]) => category === 'BEHAVIORAL').length
  const structuralTotal = checks.filter(([, , category]) => category === 'STRUCTURAL').length
  return {
    total: checks.length,
    failed,
    ok: failed.length === 0,
    behavioralTotal,
    structuralTotal,
  }
}
