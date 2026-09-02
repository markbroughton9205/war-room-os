export type NormalizedProviderStreamResult = {
  ok: boolean
  text: string
  partial: boolean
  httpStatus: number | 'timeout' | 'unavailable'
  error?: string
  parserError?: boolean
  firstDeltaAt?: number
  completedAt?: number
}

export type StreamDeltaHandler = (delta: string) => void
