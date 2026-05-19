import type { ProviderRuntimeSummary } from '@/lib/providers/health'
import { buildCanonicalProviderFamilies, normalizeEngineControlPayload } from '@/lib/runtime/canonicalStatus'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`canonical status assertion failed: ${message}`)
}

function mockIntegrity(
  overrides: Partial<ProviderRuntimeSummary['providers'][number]['integrity']> = {},
): ProviderRuntimeSummary['providers'][number]['integrity'] {
  return {
    transport_status: 'unknown',
    auth_status: 'unknown',
    latency_status: 'unknown',
    response_integrity_status: 'UNKNOWN',
    last_complete_response_at: null,
    last_incomplete_response_at: null,
    consecutive_integrity_failures: 0,
    degraded_reason: null,
    retry_count: 0,
    fallback_used: false,
    diagnostics: {
      prompt_chars: null,
      completion_chars: null,
      truncation_detected: false,
      retry_attempts: 0,
      integrity_failures: 0,
      fallback_used: false,
      last_retry_strategy: null,
      finish_reason: null,
    },
    ...overrides,
  }
}

function providerSummary(overrides: Partial<ProviderRuntimeSummary> = {}): ProviderRuntimeSummary {
  const generatedAt = '2026-01-01T00:00:00.000Z'
  return {
    generatedAt,
    cacheTtlMs: 300000,
    providers: [
      {
        id: 'openai',
        provider: 'OpenAI',
        family: 'ChatGPT family',
        optional: false,
        configured: true,
        health: 'DEGRADED',
        latencyMs: 120,
        checkedAt: generatedAt,
        lastSuccessAt: null,
        quotaState: 'unknown',
        rateLimitResetAt: null,
        activeModels: [],
        signalAvailability: false,
        note: 'Provider health check timed out.',
        integrity: mockIntegrity({ transport_status: 'reachable', auth_status: 'authenticated' }),
      },
      {
        id: 'anthropic',
        provider: 'Anthropic',
        family: 'Claude family',
        optional: false,
        configured: true,
        health: 'CONNECTED',
        latencyMs: 90,
        checkedAt: generatedAt,
        lastSuccessAt: generatedAt,
        quotaState: 'ok',
        rateLimitResetAt: null,
        activeModels: ['claude'],
        signalAvailability: false,
        note: 'Anthropic models endpoint responded.',
        integrity: mockIntegrity({ transport_status: 'reachable', auth_status: 'authenticated', response_integrity_status: 'COMPLETE' }),
      },
      {
        id: 'google',
        provider: 'Google Gemini',
        family: 'Gemini family',
        optional: false,
        configured: false,
        health: 'MISSING_KEY',
        latencyMs: null,
        checkedAt: generatedAt,
        lastSuccessAt: null,
        quotaState: 'unknown',
        rateLimitResetAt: null,
        activeModels: [],
        signalAvailability: false,
        note: 'Required provider key is not configured.',
        integrity: mockIntegrity({ auth_status: 'missing_key' }),
      },
      {
        id: 'xai',
        provider: 'xAI',
        family: 'Grok family',
        optional: false,
        configured: true,
        health: 'CONNECTED',
        latencyMs: 110,
        checkedAt: generatedAt,
        lastSuccessAt: generatedAt,
        quotaState: 'ok',
        rateLimitResetAt: null,
        activeModels: ['grok'],
        signalAvailability: false,
        note: 'xAI models endpoint responded.',
        integrity: mockIntegrity({ transport_status: 'reachable', auth_status: 'authenticated', response_integrity_status: 'COMPLETE' }),
      },
    ],
    families: {},
    signalAvailability: {
      tavily: false,
      firecrawl: false,
      liveSignalsAvailable: false,
      note: 'No live signal provider is currently connected; fallbacks must be truth-labeled.',
    },
    guardrails: {
      serverSideOnly: true,
      apiKeysSerialized: false,
      timeoutProtected: true,
      providerFailureIsolation: true,
      autonomousExecution: false,
    },
    ...overrides,
  }
}

export function assertCanonicalStatusFixtures(): void {
  const providerFamilies = buildCanonicalProviderFamilies(providerSummary())
  const chatgpt = providerFamilies.find(provider => provider.family === 'chatgpt')
  const claude = providerFamilies.find(provider => provider.family === 'claude')
  const gemini = providerFamilies.find(provider => provider.family === 'gemini')

  assert(chatgpt?.configured === true, 'configured provider remains CONFIGURED when live check fails')
  assert(chatgpt?.connected === false, 'configured provider is not CONNECTED without live success')
  assert(chatgpt?.health === 'degraded', 'provider live failure normalizes to degraded')
  assert(claude?.connected === true && claude.health === 'healthy', 'connected provider normalizes to healthy')
  assert(gemini?.health === 'unavailable', 'missing provider evidence normalizes unavailable')

  const malformed = normalizeEngineControlPayload({ engines: undefined })
  assert(Array.isArray(malformed.engines), 'malformed engine payload returns structured engines array')
  assert(malformed.routingReadiness === 'unavailable', 'malformed engine payload is unavailable, not fake-ready')
  assert(malformed.approvalRequired === false, 'empty normalized payload does not claim approved execution')

  const missingTelemetryTerms = providerFamilies.flatMap(provider => provider.missingEvidence).join(' ').toLowerCase()
  assert(!/runaway automation|silent bleeding|financial danger|compromised telemetry|no kill switch/.test(missingTelemetryTerms), 'missing telemetry does not become catastrophic language')
}
