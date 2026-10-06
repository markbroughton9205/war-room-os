import type { HvsDestructionMode, HvsDestructionRegionId, HvsGuidePrimitive } from './types'

export function releaseTimeForPiece(input: {
  column: number
  row: number | null
  rows: number
  columnCount: number
  mode: HvsDestructionMode
  guides: HvsGuidePrimitive[]
  durationSec: number
}): number | null {
  const rightStart = input.columnCount - 2
  const protectRight = input.guides.some(guide => guide.kind === 'PROTECT_REGION' && guide.region === 'RIGHT')
  const releaseRight = input.guides.find(guide => guide.kind === 'RELEASE_AT' && guide.region === 'RIGHT')
  const holdRight = input.guides.find(guide => guide.kind === 'HOLD_UNTIL' && guide.region === 'RIGHT')
  const breakLeft = input.guides.find(guide => guide.kind === 'BREAK_FIRST' && guide.region === 'LEFT')
  const breakWindows = input.guides.find(guide => guide.kind === 'BREAK_FIRST' && guide.region === 'WINDOWS')
  const leftAt = breakLeft && breakLeft.kind === 'BREAK_FIRST' ? breakLeft.atSec : 0.4
  const onRight = input.column >= rightStart

  if (onRight) {
    if (protectRight && !(releaseRight && releaseRight.kind === 'RELEASE_AT')) return null
    if (releaseRight && releaseRight.kind === 'RELEASE_AT') return releaseRight.atSec
    if (holdRight && holdRight.kind === 'HOLD_UNTIL') return Math.min(input.durationSec, holdRight.untilSec)
    if (input.mode === 'PHYSICS_LED') return 0.45
    return leftAt + input.column * 0.18
  }

  if (breakWindows && breakWindows.kind === 'BREAK_FIRST' && input.row != null && input.row >= input.rows - 2) {
    return breakWindows.atSec
  }
  if (input.mode === 'PHYSICS_LED') return 0.4
  return leftAt + input.column * 0.16
}

export function guidesFromIntentParts(input: {
  prompt: string
  durationSec: number
  direction: { x: number; y: number; z: number }
  impulseClass: 'GENTLE' | 'MODERATE' | 'STRONG'
}): HvsGuidePrimitive[] {
  const text = input.prompt.toLowerCase()
  const guides: HvsGuidePrimitive[] = []
  if (text.includes('window')) {
    guides.push({ kind: 'BREAK_FIRST', region: 'WINDOWS', atSec: 0.25 })
  }
  if (text.includes('left')) {
    guides.push({ kind: 'BREAK_FIRST', region: 'LEFT', atSec: 0.4 })
    guides.push({ kind: 'IMPULSE_REGION', region: 'LEFT', vector: input.direction, strengthClass: input.impulseClass })
  } else {
    guides.push({ kind: 'BREAK_FIRST', region: 'FRONT', atSec: 0.35 })
  }
  if (text.includes('right support') || text.includes('right column') || text.includes('keep the right')) {
    guides.push({ kind: 'PROTECT_REGION', region: 'RIGHT' })
    guides.push({ kind: 'HOLD_UNTIL', region: 'RIGHT', untilSec: input.durationSec })
  }
  guides.push({ kind: 'ATTRACT_FALL_DIRECTION', vector: input.direction, strengthClass: input.impulseClass })
  return guides
}

export function protectedRegion(guides: HvsGuidePrimitive[], region: HvsDestructionRegionId): boolean {
  return guides.some(guide => guide.kind === 'PROTECT_REGION' && guide.region === region)
    && !guides.some(guide => guide.kind === 'RELEASE_AT' && guide.region === region)
}
