/**
 * Which model-call failures are worth a bounded retry. Same philosophy for both classes: the call has no side effects, so the identical request is repeated;
 * everything else (request errors, cancellation, pause, invalid model, malformed/unparsable replies, policy refusals) fails immediately and honestly.
 */
export type ModelFailureKind = 'TIMEOUT' | 'TRANSIENT' | 'NO_RETRY'
export const MODEL_MAX_ATTEMPTS = 3
export const TRANSIENT_HTTP = [500, 502, 503, 504] as const
export function classifyModelFailure(detail: string, aborted: boolean): ModelFailureKind {
  if (aborted) return 'NO_RETRY' // a pause/cancel abort driven by Foundry's own gate
  const http = /^HTTP (\d{3})\b/.exec(detail.trim())
  if (http) return (TRANSIENT_HTTP as readonly number[]).includes(Number(http[1])) ? 'TRANSIENT' : 'NO_RETRY'
  return /timeout|degenerate repetition/i.test(detail) ? 'TIMEOUT' : 'NO_RETRY' // a runaway generation is retried like a timeout, with a changed prompt and sampling (see the caller)
}
