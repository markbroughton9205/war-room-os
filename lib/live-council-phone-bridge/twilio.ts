import twilio from 'twilio'

export const SMS_MAX_BODY_LENGTH = 4_000
export const SMS_RESPONSE_MAX_LENGTH = 1_200

export type TwilioConfig = {
  accountSid: string
  authToken: string
  from: string
  commander: string
}

export function normalizeE164(value: string | undefined): string | null {
  const compact = value?.trim().replace(/[\s().-]/g, '') ?? ''
  const normalized = compact.startsWith('00') ? `+${compact.slice(2)}` : compact
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null
}

export function getTwilioConfig(env = process.env): TwilioConfig | null {
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim() ?? ''
  const authToken = env.TWILIO_AUTH_TOKEN?.trim() ?? ''
  const from = normalizeE164(env.TWILIO_PHONE_NUMBER)
  const commander = normalizeE164(env.RAEL_PHONE_NUMBER)
  return accountSid && authToken && from && commander ? { accountSid, authToken, from, commander } : null
}

export function getConfiguredWebhookUrl(): string | null {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
  if (!base || !/^https:\/\//.test(base)) return null
  return `${base.replace(/\/$/, '')}/api/live-council/sms/inbound`
}

/** Server-only Twilio SDK boundary. Never import this module from client components. */
export function createTwilioClient(config = getTwilioConfig()) {
  if (!config) throw new Error('Twilio SMS bridge configuration is incomplete.')
  return twilio(config.accountSid, config.authToken)
}

export function validateTwilioWebhook(signature: string | null, params: Record<string, string>, config = getTwilioConfig()): boolean {
  const url = getConfiguredWebhookUrl()
  if (!signature || !config || !url) return false
  return twilio.validateRequest(config.authToken, signature, url, params)
}

export function smsSafeSummary(text: string): string {
  const scrubbed = text.replace(/(?:sk|rk|AKIA|eyJ)[-_A-Za-z0-9.]{12,}/g, '[redacted]').replace(/\s+/g, ' ').trim()
  return scrubbed.length <= SMS_RESPONSE_MAX_LENGTH ? scrubbed : `${scrubbed.slice(0, SMS_RESPONSE_MAX_LENGTH - 1)}…`
}
