import { sha256 } from './hash'
import { containsHiddenCot, containsSecret } from '@/lib/real-evidence/engine'
import type { HardenedExample, ObservableExample, ProvenanceRecord, ToolActionRecord, ToolResultRecord } from './types'

export function renderTrainingText(example: {
  format: string
  input: string
  contextRefs: string[]
  evidenceRefs: string[]
  toolActions: ToolActionRecord[]
  toolResults: ToolResultRecord[]
  finalResponse: string
}): string {
  const blocks = [
    '<|bos|>',
    '<|system|>',
    `You are WRIM. Format=${example.format}. Use only observable evidence. Do not emit hidden reasoning.`,
    '<|commander|>',
    example.input,
  ]
  if (example.contextRefs.length || example.evidenceRefs.length) {
    blocks.push('<|evidence|>', JSON.stringify({ contextRefs: example.contextRefs, evidenceRefs: example.evidenceRefs }))
  }
  if (example.toolActions.length || example.toolResults.length) {
    blocks.push('<|tool|>', JSON.stringify({ actions: example.toolActions, results: example.toolResults }))
  }
  blocks.push('<|assistant|>', example.finalResponse, '<|eos|>')
  return blocks.join('\n')
}

export function scanTrainingText(text: string): { secret: boolean; hiddenCot: boolean } {
  return { secret: containsSecret(text), hiddenCot: containsHiddenCot(text) }
}

export function toHardenedExample(
  base: ObservableExample,
  extras: {
    toolActions?: ToolActionRecord[]
    toolResults?: ToolResultRecord[]
    validatorSpec?: { type: string; expected: string }
    provenance: ProvenanceRecord
    engineeringFamily?: HardenedExample['engineeringFamily']
  },
): HardenedExample {
  const toolActions = extras.toolActions ?? (base.toolAction ? [{ tool: base.toolAction, arguments: {}, selected: true }] : [])
  const toolResults = extras.toolResults ?? (base.toolResult ? [{ tool: base.toolAction ?? 'unknown', result: base.toolResult, exitCode: 0 }] : [])
  const renderedTrainingText = renderTrainingText({
    format: base.format, input: base.input, contextRefs: base.contextRefs, evidenceRefs: base.evidenceRefs,
    toolActions, toolResults, finalResponse: base.finalResponse,
  })
  return {
    ...base,
    toolActions,
    toolResults,
    renderedTrainingText,
    renderedHash: sha256(renderedTrainingText),
    validatorSpec: extras.validatorSpec ?? { type: base.validator, expected: base.finalResponse },
    provenance: extras.provenance,
    engineeringFamily: extras.engineeringFamily,
  }
}
