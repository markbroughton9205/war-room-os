/**
 * Shared social-check-in detector used by turn intent, greeting pings, client roster
 * width, and memory gating. Does not replace Native Router.
 */

const SOCIAL_CHECKIN_PATTERNS: RegExp[] = [
  /^(?:(?:hey|hi|hello)\s+)?council[,!]?\s+check[\s-]?in[!?.\s]*$/i,
  /^(?:team|everybody|everyone)\s+check[\s-]?in[!?.\s]*$/i,
  /^(?:everybody|everyone)\s+here\??[!?.\s]*$/i,
  /^(?:quick\s+)?(?:team\s+)?check[\s-]?in[!?.\s]*$/i,
  /^(?:hi+|hello|hey+)\s+(?:council|team|everyone|everybody|all)[!?.\s]*$/i,
]

export function isSocialCouncilCheckin(text: string): boolean {
  const raw = typeof text === 'string' ? text.trim() : ''
  if (!raw) return false
  return SOCIAL_CHECKIN_PATTERNS.some(pattern => pattern.test(raw))
}

export function socialCheckinSystemTail(): string {
  return [
    'This is a social presence check-in, not a strategy, research, or opportunity request.',
    'Reply in 1–2 short sentences in your own voice, role-aware and respectful.',
    'Do not produce a Decision Summary, live-signal analysis, opportunity JSON, or synthesis.',
    'Do not challenge the Commander. Do not retrieve old plans.',
  ].join(' ')
}
