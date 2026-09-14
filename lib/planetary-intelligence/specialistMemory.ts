/**
 * P0 preserves architectural compatibility only.
 * Specialist memory is NOT globally visible by default.
 * Do not implement storage backends in this pass.
 */

export const SPECIALIST_MEMORY_INTERFACES = {
  PULSAR: 'signal history',
  ORION: 'systems / infrastructure patterns',
  LUMEN: 'verification / source reliability',
  NOVA: 'science/economics/under-covered discoveries',
  PHOENIX: 'failed assumptions / contradictions',
  AURORA: 'past syntheses / unresolved questions',
} as const

export type SpecialistMemoryScope = 'PRIVATE' | 'RECONCILED_SUMMARY'

export function defaultMemoryScope(seat: keyof typeof SPECIALIST_MEMORY_INTERFACES): SpecialistMemoryScope {
  return seat === 'AURORA' ? 'RECONCILED_SUMMARY' : 'PRIVATE'
}
