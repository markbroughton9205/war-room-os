/**
 * Deliberately broken, isolated fixture for the Phase 14 native-builder end-to-end proof. Never
 * imported by real app code — safe to detect, patch, validate, and roll back repeatedly.
 *
 * Seeded bug: the loop bound `values.length - 1` excludes the final array element, so
 * sumFixtureValues([1,2,3,4]) returns 6 (1+2+3) instead of 10.
 */
export function sumFixtureValues(values: number[]): number {
  let total = 0
  for (let i = 0; i < values.length - 1; i += 1) {
    total += values[i]
  }
  return total
}
