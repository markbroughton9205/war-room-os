import { applyCouncilRenderGate } from '@/lib/council/councilRenderGate'
import { detectGreetingOnlyResponse, validateProviderResponseIntegrity } from '@/lib/providers/responseIntegrity'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`gemini greeting gate assertion failed: ${message}`)
}

export function assertGeminiGreetingGateFixtures(): void {
  const samples = ["Hey Ra'el!", "Hey Ra'el", 'Council Active', "Hey Ra'el! Council Active"]

  for (const sample of samples) {
    const integrity = validateProviderResponseIntegrity(sample, { councilMode: true })
    assert(
      integrity.integrity_status === 'DEGRADED_RESPONSE_QUALITY',
      `${sample} must be DEGRADED_RESPONSE_QUALITY`,
    )
    assert(detectGreetingOnlyResponse(sample), `${sample} must match greeting-only detector`)

    const gate = applyCouncilRenderGate('gemini', sample)
    assert(!gate.renderable, `${sample} must not be renderable`)
    assert(gate.degraded, `${sample} must be degraded`)
    assert(
      gate.integrityStatus === 'DEGRADED_RESPONSE_QUALITY',
      `${sample} gate integrity must be DEGRADED_RESPONSE_QUALITY`,
    )
    assert(
      gate.displayText.includes('retry/fallback required'),
      `${sample} must show Gemini degraded placeholder`,
    )
    assert(gate.diagnostics?.matchedGreetingOnly === true, `${sample} diagnostics greeting flag`)
  }
}
