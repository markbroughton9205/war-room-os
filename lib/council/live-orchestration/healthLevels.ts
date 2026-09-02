export type ProviderHealthLevel = 'AUTH_HEALTH' | 'MINIMAL_INFERENCE_HEALTH' | 'STREAMING_HEALTH' | 'FULL_COUNCIL_PATH_HEALTH'

export function healthLevelFromProbe(input: {
  configured: boolean
  authOk?: boolean
  inferenceOk?: boolean
  streamingOk?: boolean
  councilPathOk?: boolean
}): { level: ProviderHealthLevel | 'UNHEALTHY' | 'MISSING'; note: string } {
  if (!input.configured) return { level: 'MISSING', note: 'Provider secret not configured.' }
  if (input.councilPathOk) return { level: 'FULL_COUNCIL_PATH_HEALTH', note: 'Representative Council-path stream completed.' }
  if (input.streamingOk) return { level: 'STREAMING_HEALTH', note: 'Stream began and completed outside full Council payload.' }
  if (input.inferenceOk) return { level: 'MINIMAL_INFERENCE_HEALTH', note: 'Minimal completion succeeded; Council-path not proven.' }
  if (input.authOk) return { level: 'AUTH_HEALTH', note: 'Auth/probe succeeded; inference not proven.' }
  return { level: 'UNHEALTHY', note: 'Configured but Council-path health not demonstrated.' }
}
