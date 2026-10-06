import type { AdminCompactFeature } from './types'

/**
 * War Room does not make territorial claims. Disputed Natural Earth features keep
 * source provenance and render as dashed, lower-opacity annotation.
 */
export function isDisputedFeature(feature: Pick<AdminCompactFeature, 'disputed' | 'disputeNote'>): boolean {
  return feature.disputed === true
}

export function disputeStrokeScale(feature: Pick<AdminCompactFeature, 'disputed'>): number {
  return feature.disputed ? 0.55 : 1
}

export function disputeDash(feature: Pick<AdminCompactFeature, 'disputed'>): number[] | null {
  return feature.disputed ? [8, 6] : null
}
