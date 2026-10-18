/**
 * Detect human-required page challenges. Do not bypass MFA/CAPTCHA/passkeys.
 */

const HUMAN_HINT = /\b(mfa|2fa|two[- ]factor|one[- ]time code|authenticator|captcha|i am not a robot|verify you are human|passkey|security key|webauthn|challenge)\b/i

export function detectHumanInteractionRequired(input: { title?: string; text?: string; url?: string }): boolean {
  const haystack = `${input.title ?? ''} ${input.text ?? ''} ${input.url ?? ''}`
  return HUMAN_HINT.test(haystack)
}

export function inferAuthState(input: { title?: string; text?: string; url?: string; hasStorageState?: boolean }): 'AUTHENTICATED' | 'NEEDS_REAUTH' | 'UNKNOWN_AUTH' {
  const haystack = `${input.title ?? ''} ${input.text ?? ''} ${input.url ?? ''}`
  if (/\b(sign in|log in|login|password|authenticate)\b/i.test(haystack) && !/\b(signed in|logged in|account home)\b/i.test(haystack)) {
    return 'NEEDS_REAUTH'
  }
  if (/\b(signed in|logged in|welcome back|account)\b/i.test(haystack) && !/\b(sign in|log in)\b/i.test(input.url ?? '')) {
    return 'AUTHENTICATED'
  }
  if (input.hasStorageState) return 'UNKNOWN_AUTH'
  return 'UNKNOWN_AUTH'
}
