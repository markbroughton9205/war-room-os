import { applyCouncilRenderGate } from '@/lib/council/councilRenderGate'
import { detectGreetingOnlyResponse, validateProviderResponseIntegrity } from '@/lib/providers/responseIntegrity'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`gemini greeting gate assertion failed: ${message}`)
}

export function assertGeminiGreetingGateFixtures(): void {
  const samples = ["Hey Ra'el!", "Hey Ra'el", 'Council Active', "Hey Ra'el! Council Active"]
  const strictBlocked = new Set(['DEGRADED_RESPONSE_QUALITY', 'EMPTY', 'INCOMPLETE', 'TRUNCATED'])

  for (const sample of samples) {
    const integrity = validateProviderResponseIntegrity(sample, { councilMode: true })
    assert(
      strictBlocked.has(integrity.integrity_status),
      `${sample} must not pass strict council integrity (got ${integrity.integrity_status})`,
    )
    assert(detectGreetingOnlyResponse(sample), `${sample} must match greeting-only detector`)

    const gate = applyCouncilRenderGate('gemini', sample)
    assert(!gate.renderable, `${sample} must not be renderable`)
    assert(gate.degraded, `${sample} must be degraded`)
    assert(!gate.renderable, `${sample} gate must not be renderable under strict decree`)
    assert(
      gate.displayText.includes('retry/fallback required'),
      `${sample} must show Gemini degraded placeholder`,
    )
    assert(gate.diagnostics?.matchedGreetingOnly === true, `${sample} diagnostics greeting flag`)
  }
}
