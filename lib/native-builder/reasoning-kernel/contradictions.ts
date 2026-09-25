/**
 * Contradiction records. An unresolved acceptance contradiction blocks project ready.
 */
import type { FoundryContradiction, FrkContradictionType } from './types'
import { clipText } from './text'

export function createContradiction(input: {
  contradictionId: string
  type: FrkContradictionType
  summary: string
  affectsAcceptance: boolean
}): FoundryContradiction {
  return {
    contradictionId: input.contradictionId,
    type: input.type,
    summary: clipText(input.summary),
    affectsAcceptance: input.affectsAcceptance,
    resolved: false,
  }
}

export function unresolvedAcceptanceBlock(contradictions: FoundryContradiction[]): string | null {
  const open = contradictions.filter(item => item.affectsAcceptance && !item.resolved)
  if (!open.length) return null
  return `Unresolved contradiction blocks project ready: ${open.map(item => item.type).join(', ')}`
}
