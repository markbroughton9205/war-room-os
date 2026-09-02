import type { ToolIntent } from './types'

const TOOL_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/
const NO_TOOL_IDS = new Set(['none', 'NO_TOOL', 'no_tool', 'NONE'])
const MAX_ARGS = 16
const MAX_VALUE_LEN = 2048
const MAX_RAW_LEN = 8192

function malformed(raw: string, errors: string[], sourceModel: string, sourceModule: string | null): ToolIntent {
  return {
    decision: 'NO_TOOL',
    tool_id: null,
    arguments: {},
    confidence: null,
    source_model: sourceModel,
    source_module: sourceModule,
    raw_intent: raw,
    parse_status: 'MALFORMED',
    validation_status: 'INVALID',
    errors,
  }
}

/** Deterministic parser. No execution. Does not invent missing fields. */
export function parseToolIntent(
  raw: string,
  opts?: { sourceModel?: string; sourceModule?: string | null },
): ToolIntent {
  const sourceModel = opts?.sourceModel ?? 'WRIM-0'
  const sourceModule = opts?.sourceModule ?? null
  if (typeof raw !== 'string') return malformed(String(raw), ['raw intent is not a string'], sourceModel, sourceModule)
  if (raw.length > MAX_RAW_LEN) return malformed(raw, ['raw intent exceeds bound'], sourceModel, sourceModule)
  const trimmedProbe = raw.trim()
  if (raw.includes('<tool_call>') || trimmedProbe.startsWith('{') || trimmedProbe.startsWith('[')) {
    return malformed(raw, ['runtime JSON / XML tool wrappers are not accepted in the model dialect'], sourceModel, sourceModule)
  }

  const lines = raw.replace(/\r\n/g, '\n').split('\n').map((ln) => ln.trim()).filter((ln) => ln.length > 0)
  if (lines.length === 0) return malformed(raw, ['empty intent'], sourceModel, sourceModule)
  if (!lines[0].startsWith('TOOL=')) {
    return malformed(raw, ['first non-empty line must be TOOL=<id>'], sourceModel, sourceModule)
  }
  const toolId = lines[0].slice('TOOL='.length).trim()
  if (toolId === '') return malformed(raw, ['empty tool id; refusing to hallucinate'], sourceModel, sourceModule)

  const args: Record<string, string> = {}
  const errors: string[] = []
  for (const ln of lines.slice(1)) {
    const eq = ln.indexOf('=')
    if (eq < 0) {
      errors.push(`malformed argument line ${JSON.stringify(ln)}`)
      continue
    }
    const key = ln.slice(0, eq).trim()
    const value = ln.slice(eq + 1)
    if (!KEY_RE.test(key)) {
      errors.push(`invalid argument key ${JSON.stringify(key)}`)
      continue
    }
    if (Object.prototype.hasOwnProperty.call(args, key)) {
      errors.push(`duplicate argument ${key}`)
      continue
    }
    if (Object.keys(args).length >= MAX_ARGS) {
      errors.push('too many arguments')
      continue
    }
    if (value.length > MAX_VALUE_LEN) {
      errors.push(`argument ${key} exceeds value bound`)
      continue
    }
    args[key] = value
  }
  if (errors.length) return malformed(raw, errors, sourceModel, sourceModule)

  if (NO_TOOL_IDS.has(toolId)) {
    const extra = Object.keys(args).filter((k) => k !== 'WHY')
    if (extra.length) return malformed(raw, [`NO_TOOL does not accept arguments ${extra.join(',')}`], sourceModel, sourceModule)
    return {
      decision: 'NO_TOOL',
      tool_id: null,
      arguments: {},
      confidence: null,
      source_model: sourceModel,
      source_module: sourceModule,
      raw_intent: raw,
      parse_status: 'PARSED',
      validation_status: 'UNVALIDATED',
      errors: [],
    }
  }

  if (!TOOL_ID_RE.test(toolId)) {
    return malformed(raw, [`invalid tool id ${JSON.stringify(toolId)}`], sourceModel, sourceModule)
  }

  return {
    decision: 'TOOL',
    tool_id: toolId,
    arguments: args,
    confidence: null,
    source_model: sourceModel,
    source_module: sourceModule,
    raw_intent: raw,
    parse_status: 'PARSED',
    validation_status: 'UNVALIDATED',
    errors: [],
  }
}
