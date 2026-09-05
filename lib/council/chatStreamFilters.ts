/**
 * Central guard: provider transport / runtime failures belong in badges and
 * `providerRuntimeStates`, not as SYSTEM / family chat bubbles.
 */

const PROVIDER_FAILURE_SUBSTRINGS = [
  'provider error',
  'operation was aborted',
  'aborterror',
  'the operation was aborted',
  'timed out',
  'fetch failed',
  'model_not_installed',
  'no enabled local registry slot',
  'provider contribution unavailable',
  'council provider calls did not return',
  "didn't get a response in this round",
] as const

export function shouldSuppressProviderFailureFromChatStream(
  text: string,
  opts?: { diagnosticsOpen?: boolean },
): boolean {
  if (!text?.trim() || opts?.diagnosticsOpen) return false
  const lower = text.toLowerCase()
  return PROVIDER_FAILURE_SUBSTRINGS.some(s => lower.includes(s))
}
