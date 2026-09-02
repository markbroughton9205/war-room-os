import { createHash } from 'node:crypto'
import type { ObservableExample } from './types'

const canonical = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
    : JSON.stringify(value)

export const sha256 = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex')

export const normalizeForDedup = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()

export function observableExampleHash(example: Omit<ObservableExample, 'contentHash' | 'exampleId'>): string {
  return sha256({
    format: example.format, input: example.input, contextRefs: example.contextRefs, toolAction: example.toolAction,
    toolResult: example.toolResult, evidenceRefs: example.evidenceRefs, finalResponse: example.finalResponse,
    validator: example.validator, outcome: example.outcome, correction: example.correction, lineageIds: example.lineageIds,
  })
}

export function estimateUtf8Tokens(text: string): number {
  if (!text) return 0
  return Math.max(1, Math.ceil(Buffer.byteLength(text, 'utf8') / 3.5))
}
