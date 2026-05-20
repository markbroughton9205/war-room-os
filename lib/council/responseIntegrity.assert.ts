import { repairOrFlagResponse } from '@/lib/council/responseIntegrity'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`council response integrity assertion failed: ${message}`)
}

export function assertCouncilResponseIntegrityFixtures(): void {
  const shortCasual = repairOrFlagResponse('Hey Ra\'el — council is here and ready')
  assert(
    !shortCasual.integrityWarnings.includes('integrity_truncated_terminal_word'),
    'short casual reply without terminal-word truncation flag',
  )

  const longOpenTail = repairOrFlagResponse(
    'Because the signal router still shows partial packets and the council should wait for the next '.repeat(3),
  )
  assert(
    longOpenTail.text.length >= 50,
    'long open-tail fixture is long enough for truncation heuristics',
  )
}
