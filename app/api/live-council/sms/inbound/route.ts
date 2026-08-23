import { NextResponse } from 'next/server'
import {
  claimInboundMessageSid,
  commanderIsAuthorized,
  markInboundMessageCompleted,
  markInboundMessageFailed,
  sendCouncilSmsResponse,
  submitCommanderSmsToLiveCouncil,
  touchInboundProcessing, INBOUND_HEARTBEAT_INTERVAL_MS,
  type InboundFailureCode,
} from '@/lib/live-council-phone-bridge/bridge'
import { SMS_MAX_BODY_LENGTH, validateTwilioWebhook } from '@/lib/live-council-phone-bridge/twilio'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'MALFORMED_REQUEST' }, { status: 400 })
  const params = Object.fromEntries([...form.entries()].filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  if (!validateTwilioWebhook(req.headers.get('x-twilio-signature'), params)) return NextResponse.json({ error: 'INVALID_TWILIO_SIGNATURE' }, { status: 401 })
  const from = params.From ?? '', body = params.Body?.trim() ?? '', messageSid = params.MessageSid ?? ''
  if (!from || !body || !messageSid || body.length > SMS_MAX_BODY_LENGTH) return NextResponse.json({ error: 'MALFORMED_REQUEST' }, { status: 400 })
  if (!commanderIsAuthorized(from)) return NextResponse.json({ error: 'UNAUTHORIZED_SENDER' }, { status: 403 })

  // Claim is the durable idempotency boundary: a fresh MessageSid, or an
  // atomic reclaim of a `failed`/stale-`processing` row (crash recovery).
  // Everything after this point runs under that claim and must always end in
  // either markInboundMessageCompleted or markInboundMessageFailed so no
  // MessageSid is left stuck in `processing` forever.
  const claim = await claimInboundMessageSid(messageSid)
  if (claim === 'duplicate') return NextResponse.json({ duplicate: true }, { status: 200 })
  if (claim === 'schema_required') return NextResponse.json({ error: 'IDEMPOTENCY_SCHEMA_REQUIRED' }, { status: 503 })

  let heartbeatFailed = false
  const heartbeat = setInterval(() => { void touchInboundProcessing(messageSid).then(ok => { heartbeatFailed ||= !ok }) }, INBOUND_HEARTBEAT_INTERVAL_MS)
  try {
    const council = await submitCommanderSmsToLiveCouncil({ body, from, messageSid })
    if (heartbeatFailed) throw new Error('processing heartbeat failed')
    if (!council.ok) {
      const code: InboundFailureCode = council.code === 'PERSISTENCE_FAILED' || council.code === 'COUNCIL_FAILED'
        ? council.code
        : 'BRIDGE_DISABLED'
      await markInboundMessageFailed(messageSid, code)
      return NextResponse.json({ error: council.code }, { status: 503 })
    }

    const outbound = await sendCouncilSmsResponse(council.response, messageSid)
    if (!outbound.ok) {
      await markInboundMessageFailed(messageSid, outbound.code === 'SMS_BRIDGE_DISABLED' ? 'BRIDGE_DISABLED' : 'OUTBOUND_FAILED')
      return NextResponse.json({ error: outbound.code }, { status: 503 })
    }

    if (heartbeatFailed) return NextResponse.json({ error: 'PROCESSING_FAILED' }, { status: 503 })
    const completed = await markInboundMessageCompleted(messageSid, { sid: outbound.sid, status: outbound.status })
    if (!completed) return NextResponse.json({ error: 'PROCESSING_FAILED' }, { status: 503 })
    return NextResponse.json({ accepted: true, conversationId: council.conversationId, outbound: { sid: outbound.sid, status: outbound.status } })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    const code: InboundFailureCode = /timeout/i.test(message) ? 'PROCESSING_TIMEOUT' : 'UNKNOWN_FAILURE'
    await markInboundMessageFailed(messageSid, code)
    return NextResponse.json({ error: 'PROCESSING_FAILED' }, { status: 503 })
  } finally { clearInterval(heartbeat) }
}
