/**
 * Greeting-mode routing: stable primary family unless the decree clearly asks for multiple voices.
 */

const MULTI_FAMILY_GREETING = new RegExp(
  [
    '\\b(full\\s+council|all\\s+families|every\\s+family|war\\s+council|summon\\s+the\\s+council)\\b',
    '\\b(everyone|each\\s+family|all\\s+of\\s+you|hear\\s+from\\s+everyone)\\b',
    '@council\\b',
  ].join('|'),
  'i',
)

/** Decree explicitly widens greeting to multiple families / full council. */
export function decreeAsksMultiFamilyGreeting(decree: string): boolean {
  return MULTI_FAMILY_GREETING.test(typeof decree === 'string' ? decree : '')
}
