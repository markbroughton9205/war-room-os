import { headingDeltaDeg, wrapHeadingDeg } from './geometry'
import type { StreetViewItem } from './types'

const TURN_HEADING_TOLERANCE_DEG = 70

export function selectAdjacentIndex(itemCount: number, index: number, step: -1 | 1): number | null {
  if (itemCount < 2) return null
  return (index + step + itemCount) % itemCount
}

export function selectTurnIndex(
  items: readonly StreetViewItem[],
  currentIndex: number,
  direction: 'left' | 'right',
): number | null {
  const current = items[currentIndex]
  if (!current || current.headingDeg == null) return null
  const target = wrapHeadingDeg(current.headingDeg + (direction === 'left' ? -90 : 90))
  let bestIndex: number | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (let index = 0; index < items.length; index += 1) {
    if (index === currentIndex) continue
    const heading = items[index]?.headingDeg
    if (heading == null) continue
    const delta = Math.abs(headingDeltaDeg(target, heading))
    if (delta > TURN_HEADING_TOLERANCE_DEG) continue
    const score = delta + Math.min(40, items[index].distanceMeters) / 40
    if (score < bestScore) {
      bestScore = score
      bestIndex = index
    }
  }
  return bestIndex
}

export function navigationFlags(items: readonly StreetViewItem[], index: number) {
  const item = items[index] ?? null
  return {
    canPrevious: items.length > 1,
    canNext: items.length > 1,
    canTurnLeft: selectTurnIndex(items, index, 'left') !== null,
    canTurnRight: selectTurnIndex(items, index, 'right') !== null,
    canGoToLocation: Boolean(item),
    canOpenSource: Boolean(item?.viewerUrl || item?.sourceUrl),
  }
}
