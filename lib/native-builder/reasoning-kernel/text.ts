/**
 * Concise artifact text. Private reasoning markers are dropped before persistence.
 */
import { FRK_TEXT_LIMIT } from './types'

const PRIVATE_BLOCK = /<thinking>[\s\S]*?<\/thinking>/gi
const PRIVATE_LABEL = /chain[- ]of[- ]thought|hidden reasoning tokens|scratchpad transcript/gi

export function clipText(value: string): string {
  const stripped = value.replace(PRIVATE_BLOCK, ' ').replace(PRIVATE_LABEL, ' ').replace(/\s+/g, ' ').trim()
  if (!stripped) return 'omitted private reasoning'
  return stripped.slice(0, FRK_TEXT_LIMIT)
}

export function containsPrivateReasoning(value: string): boolean {
  return PRIVATE_BLOCK.test(value) || PRIVATE_LABEL.test(value)
}
