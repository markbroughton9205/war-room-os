export type NormalizedProviderStreamResult = {
  ok: boolean
  text: string
  partial: boolean
  httpStatus: number | 'timeout' | 'unavailable'
  error?: string
  parserError?: boolean
  firstDeltaAt?: number
  completedAt?: number
  /** Provider-reported completion reason (e.g. Gemini's 'STOP'/'MAX_TOKENS'), when the underlying
   * API exposes one. Optional and provider-specific — adapters that don't receive one from their
   * API simply never set it, same as today. Propagated through BackendMetadata.finishReason so
   * integrity/retry logic can consume a normalized signal without any adapter-specific bypass. */
  finishReason?: string | null
}

export type StreamDeltaHandler = (delta: string) => void
