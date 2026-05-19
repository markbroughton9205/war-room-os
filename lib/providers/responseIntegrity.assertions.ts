import { assertGeminiGreetingGateFixtures } from '@/lib/providers/geminiGreetingGate.assert'
import {
  detectGreetingOnlyResponse,
  isOperatorUnsafeProviderFragment,
  validateProviderResponseIntegrity,
} from '@/lib/providers/responseIntegrity'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`response integrity assertion failed: ${message}`)
}

export function assertResponseIntegrityFixtures(): void {
  const truncated = validateProviderResponseIntegrity('Decision Summary: The War Room can improve')
  assert(truncated.integrity_status !== 'COMPLETE', 'stub decision summary is not complete')
  assert(truncated.retry_recommended, 'truncated stub recommends retry')

  const complete = validateProviderResponseIntegrity(
    'Decision Summary: Provider runtime now validates response integrity before marking families connected. Next action: refresh canonical status after deploy.',
    { councilMode: true },
  )
  assert(complete.integrity_status === 'COMPLETE', 'full sentence passes complete')

  const greeting = validateProviderResponseIntegrity("Hey Ra'el! Council Active", { councilMode: true })
  assert(greeting.integrity_status === 'DEGRADED_RESPONSE_QUALITY', 'greeting-only is degraded quality')
  assert(detectGreetingOnlyResponse("Hey Ra'el! Council Active"), 'greeting detector')

  assert(
    isOperatorUnsafeProviderFragment('Decision Summary: The incomplete'),
    'operator unsafe fragment detected',
  )
  assert(
    isOperatorUnsafeProviderFragment("Hey Ra'el! Council Active"),
    'greeting-only is operator unsafe',
  )

  assertGeminiGreetingGateFixtures()
}
