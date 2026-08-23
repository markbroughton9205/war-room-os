import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'

function getTwilioConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_PHONE_NUMBER
  const to = process.env.RAEL_PHONE_NUMBER

  if (!accountSid || !authToken || !from || !to) {
    return { configured: false, accountSid, authToken, from, to }
  }

  return { configured: true, accountSid, authToken, from, to }
}

export async function POST(req: Request) {
  const commander = await requireCommanderSession('Legacy SMS send'); if (!commander.ok) return commander.response
  const config = getTwilioConfig()
  const body = await req.json().catch(() => ({}))
  const message = String(body.message ?? '').trim()

  if (!message || message.length > 1500) {
    return NextResponse.json({
      tool: 'sms-bridge',
      status: 'error',
      message: 'SMS message body is required',
    }, { status: 400 })
  }

  if (!config.configured || !config.accountSid || !config.authToken || !config.from || !config.to) {
    return NextResponse.json({
      tool: 'sms-bridge',
      status: 'not_configured',
      message: 'Twilio SMS Bridge is not configured',
    }, { status: 503 })
  }

  const form = new URLSearchParams({
    To: config.to,
    From: config.from,
    Body: message.slice(0, 1500),
  })

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  })

  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    return NextResponse.json({
      tool: 'sms-bridge',
      status: 'error',
      message: typeof data.message === 'string' ? data.message : 'Twilio send failed',
    }, { status: 502 })
  }

  return NextResponse.json({
    tool: 'sms-bridge',
    status: 'complete',
    message: 'SMS notification sent',
    sid: data.sid ?? null,
    sentAt: new Date().toISOString(),
  })
}
