import {
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
  )
  assert(complete.integrity_status === 'COMPLETE', 'full sentence passes complete')

  assert(
    isOperatorUnsafeProviderFragment('Decision Summary: The incomplete'),
    'operator unsafe fragment detected',
  )
}
