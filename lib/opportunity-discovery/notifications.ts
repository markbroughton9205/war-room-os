import type { DiscoveryOpportunity, NotificationResult } from './types'

let notificationFetch: typeof fetch = fetch
export function __setNotificationFetchForTests(value: typeof fetch | null): void { notificationFetch = value ?? fetch }

export function buildDiscoveryNotification(record: DiscoveryOpportunity): string {
  const compensation = record.compensation ? `Compensation: ${record.currency ?? 'currency unknown'} ${record.compensation.minimum ?? '?'}–${record.compensation.maximum ?? '?'}` : 'Compensation: not provided'
  return [
    'WAR ROOM — NEW TECHNICAL OPPORTUNITY', record.title,
    `Organization: ${record.organization ?? 'not provided'}`,
    `Source: ${record.attribution}`,
    `Location/remote: ${record.remoteStatus}${record.location ? ` — ${record.location}` : ''}`,
    compensation,
    `Deadline: ${record.deadline ?? 'not provided'}`,
    `Matched because: ${record.matchReasons.join(', ')}`,
    `Official source: ${record.officialUrl ?? 'not provided'}`,
    'DISCOVERY ONLY — NO APPLICATION OR SUBMISSION WAS PERFORMED.',
  ].join('\n')
}

export async function notifyCommander(record: DiscoveryOpportunity, env: NodeJS.ProcessEnv = process.env): Promise<NotificationResult> {
  const body = buildDiscoveryNotification(record)
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim(); const authToken = env.TWILIO_AUTH_TOKEN?.trim(); const from = env.TWILIO_PHONE_NUMBER?.trim(); const to = env.RAEL_PHONE_NUMBER?.trim()
  if (!accountSid || !authToken || !from || !to) return { state: 'BLOCKED_BY_ENVIRONMENT', channel: null, providerMessageId: null, body, error: 'Twilio Commander SMS configuration is incomplete.' }
  const form = new URLSearchParams({ To: to, From: from, Body: body.slice(0, 1500) })
  const response = await notificationFetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form })
  const data = await response.json().catch(() => ({})) as { sid?: unknown; message?: unknown }
  if (!response.ok || typeof data.sid !== 'string') return { state: 'NOTIFICATION_GENERATED', channel: 'sms', providerMessageId: null, body, error: typeof data.message === 'string' ? data.message : `Twilio returned HTTP ${response.status}.` }
  return { state: 'EXTERNAL_DELIVERY', channel: 'sms', providerMessageId: data.sid, body, error: null }
}
