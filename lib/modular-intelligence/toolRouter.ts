import { createHash, randomUUID } from 'node:crypto'
import { coerceArgument, getUnifiedTool } from './toolCatalog'
import { parseToolIntent } from './toolIntent'
import { scoreFrozenRouterShadow, shadowFieldsForProvenance } from './frozenRouterShadow'
import { scoreNativeRouterV1Shadow, nativeRouterV1FieldsForProvenance } from './nativeRouterV1Shadow'
import { captureRuntimeTrajectory, observeAfterToolResult, sourceTypeForExecuteMode } from './runtimeTrajectoryCapture'
import type { TrajectorySourceType } from './trajectorySourceTypes'
import type {
  NormalizedToolRequest,
  ToolIntent,
  ToolResult,
  ToolRouterResult,
  ToolValidationCode,
} from './types'

export function validateToolIntent(intent: ToolIntent): { code: ToolValidationCode; errors: string[]; coerced: Record<string, string | number | boolean> } {
  if (intent.parse_status === 'MALFORMED') {
    return { code: 'INVALID', errors: intent.errors, coerced: {} }
  }
  if (intent.decision === 'NO_TOOL') {
    return { code: 'VALID', errors: [], coerced: {} }
  }
  const toolId = intent.tool_id
  if (!toolId) return { code: 'INVALID_TOOL', errors: ['missing tool id'], coerced: {} }
  const def = getUnifiedTool(toolId)
  if (!def) return { code: 'INVALID_TOOL', errors: [`unknown tool ${toolId}`], coerced: {} }
  if (!def.enabled || !def.available) return { code: 'UNAVAILABLE', errors: [`tool ${toolId} unavailable`], coerced: {} }
  if (!def.schemaSpecified) return { code: 'SCHEMA_INCOMPATIBLE', errors: [`tool ${toolId} has no compact schema`], coerced: {} }

  const errors: string[] = []
  let code: ToolValidationCode = 'VALID'
  const coerced: Record<string, string | number | boolean> = {}
  const known = new Set(def.arguments.map((a) => a.name))

  for (const [key, raw] of Object.entries(intent.arguments)) {
    if (!known.has(key)) {
      errors.push(`unknown argument ${key}`)
      code = 'UNKNOWN_ARGUMENT'
      continue
    }
    const schema = def.arguments.find((a) => a.name === key)!
    const coercedArg = coerceArgument(raw, schema.type)
    if (!coercedArg.ok) {
      errors.push(`invalid argument ${key}: ${coercedArg.reason}`)
      code = 'INVALID_ARGUMENT'
      continue
    }
    coerced[key] = coercedArg.value
  }

  for (const schema of def.arguments) {
    if (schema.required && !(schema.name in intent.arguments)) {
      errors.push(`missing required argument ${schema.name}`)
      code = 'MISSING_ARGUMENT'
    }
  }

  return { code, errors, coerced }
}

export function normalizeToolRequest(intent: ToolIntent, coerced: Record<string, string | number | boolean>): NormalizedToolRequest | null {
  if (intent.decision === 'NO_TOOL' || !intent.tool_id) return null
  return { tool: intent.tool_id, arguments: coerced }
}

/**
 * parse → validate → normalize. Stops at the execution boundary.
 * Never invokes War Room APIs or network.
 */
export function routeToolIntent(raw: string, opts?: { sourceModel?: string; sourceModule?: string | null }): ToolRouterResult {
  const intent = parseToolIntent(raw, opts)
  if (intent.parse_status === 'MALFORMED') {
    return { intent, validation: 'INVALID', normalized: null, executed: false, stageReached: 'parse', errors: intent.errors }
  }
  const validated = validateToolIntent(intent)
  intent.validation_status = validated.code
  intent.errors = validated.errors
  if (validated.code !== 'VALID') {
    return { intent, validation: validated.code, normalized: null, executed: false, stageReached: 'validate', errors: validated.errors }
  }
  const normalized = normalizeToolRequest(intent, validated.coerced)
  return {
    intent,
    validation: 'VALID',
    normalized,
    executed: false,
    stageReached: 'execution_boundary',
    errors: [],
  }
}

export type ExecuteMode = 'dry_run' | 'mock' | 'bounded_sha256'

export type ToolExecutionObservation = {
  requestText?: string
  conversationId?: string | null
  /** When omitted, source_type is derived honestly from execute mode (dry_run/mock are never REAL_RUNTIME). */
  sourceType?: TrajectorySourceType
}

function compactRequestText(request: NormalizedToolRequest): string {
  const args = Object.entries(request.arguments)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join('\n')
  return args ? `TOOL=${request.tool}\n${args}` : `TOOL=${request.tool}`
}

function observeExecution(
  request: NormalizedToolRequest,
  result: ToolResult,
  mode: ExecuteMode,
  observation?: ToolExecutionObservation,
): void {
  try {
    observeAfterToolResult(observation?.requestText ?? compactRequestText(request), result, {
      decision: 'TOOL',
      arguments: Object.fromEntries(
        Object.entries(request.arguments).map(([k, v]) => [k, String(v)]),
      ),
      validation: result.error === 'INVALID_TOOL' ? 'INVALID_TOOL' : 'VALID',
      source_type: observation?.sourceType ?? sourceTypeForExecuteMode(mode),
      insertion_point: 'lib/modular-intelligence/toolRouter.ts:executeNormalizedRequest',
      conversation_id: observation?.conversationId,
    })
  } catch (err) {
    console.error(
      '[trajectory-observer] executeNormalizedRequest observe failed:',
      err instanceof Error ? err.message : err,
    )
  }
}

export function observeToolRouterResult(
  raw: string,
  routed: ToolRouterResult,
  extras?: { conversationId?: string | null; sourceType?: TrajectorySourceType },
): void {
  try {
    const shadow = scoreFrozenRouterShadow(raw, routed)
    const nativeShadow = scoreNativeRouterV1Shadow(raw, routed)
    captureRuntimeTrajectory({
      request_text: raw,
      conversation_id: extras?.conversationId,
      decision: routed.intent.decision,
      tool_id: routed.intent.decision === 'NO_TOOL' ? null : routed.intent.tool_id,
      arguments: routed.intent.arguments,
      router_validation_status: routed.validation,
      execution_status: routed.executed ? 'executed' : 'not_executed',
      tool_result_status: 'not_executed',
      tool_result: { executed: routed.executed, validation: routed.validation, errors: routed.errors },
      error: routed.errors[0] ?? null,
      no_tool_reason:
        routed.intent.decision === 'NO_TOOL'
          ? routed.validation === 'UNAVAILABLE'
            ? 'TOOL_UNAVAILABLE'
            : routed.validation === 'INVALID_TOOL'
              ? 'UNSUPPORTED_TOOL'
              : routed.intent.parse_status === 'MALFORMED'
                ? null
                : 'TOOL_NOT_REQUIRED'
          : null,
      source_type: extras?.sourceType ?? 'REAL_RUNTIME',
      insertion_point: 'lib/modular-intelligence/toolRouter.ts:routeToolIntent',
      context_dependence: 'STANDALONE',
      provenance: {
        stage: routed.stageReached,
        executed: String(routed.executed),
        ...shadowFieldsForProvenance(shadow),
        ...nativeRouterV1FieldsForProvenance(nativeShadow),
      },
    })
  } catch (err) {
    console.error(
      '[trajectory-observer] observeToolRouterResult failed:',
      err instanceof Error ? err.message : err,
    )
  }
}

export function executeNormalizedRequest(
  request: NormalizedToolRequest,
  mode: ExecuteMode,
  observation?: ToolExecutionObservation,
): ToolResult {
  const started = new Date()
  const requestId = randomUUID()
  const finish = (result: ToolResult): ToolResult => {
    if (observation) observeExecution(request, result, mode, observation)
    return result
  }
  const def = getUnifiedTool(request.tool)
  if (!def) {
    const completed = new Date()
    return finish({
      tool_id: request.tool,
      status: 'error',
      result: null,
      error: 'INVALID_TOOL',
      provenance: { mode, boundary: 'executeNormalizedRequest' },
      started_at: started.toISOString(),
      completed_at: completed.toISOString(),
      duration_ms: completed.getTime() - started.getTime(),
      request_id: requestId,
    })
  }
  if (mode === 'dry_run') {
    const completed = new Date()
    return finish({
      tool_id: request.tool,
      status: 'dry_run',
      result: { would_call: def.executionProvider, arguments: request.arguments },
      error: null,
      provenance: { mode, authority: def.authority, executed: 'false' },
      started_at: started.toISOString(),
      completed_at: completed.toISOString(),
      duration_ms: completed.getTime() - started.getTime(),
      request_id: requestId,
    })
  }
  if (mode === 'mock') {
    const completed = new Date()
    return finish({
      tool_id: request.tool,
      status: 'mock',
      result: { mock: true, arguments: request.arguments },
      error: null,
      provenance: { mode, authority: def.authority, executed: 'false' },
      started_at: started.toISOString(),
      completed_at: completed.toISOString(),
      duration_ms: completed.getTime() - started.getTime(),
      request_id: requestId,
    })
  }
  if (mode === 'bounded_sha256') {
    if (request.tool !== 'sha256' || def.executionProvider !== 'agi_gym_sha256') {
      const completed = new Date()
      return finish({
        tool_id: request.tool,
        status: 'error',
        result: null,
        error: 'bounded_sha256 mode only executes the gym sha256 tool',
        provenance: { mode },
        started_at: started.toISOString(),
        completed_at: completed.toISOString(),
        duration_ms: completed.getTime() - started.getTime(),
        request_id: requestId,
      })
    }
    const text = String(request.arguments.text ?? '')
    const digest = createHash('sha256').update(text).digest('hex')
    const completed = new Date()
    return finish({
      tool_id: 'sha256',
      status: 'ok',
      result: { digest },
      error: null,
      provenance: { mode, authority: def.authority, reversible: 'true' },
      started_at: started.toISOString(),
      completed_at: completed.toISOString(),
      duration_ms: completed.getTime() - started.getTime(),
      request_id: requestId,
    })
  }
  const completed = new Date()
  return finish({
    tool_id: request.tool,
    status: 'not_executed',
    result: null,
    error: 'no uncontrolled execution path in Phase 1',
    provenance: { mode },
    started_at: started.toISOString(),
    completed_at: completed.toISOString(),
    duration_ms: completed.getTime() - started.getTime(),
    request_id: requestId,
  })
}

export function formatModelObservation(result: ToolResult, maxValue = 512): string {
  const status = result.status === 'ok' ? 'ok' : result.status
  let value = result.error ?? (typeof result.result === 'string' ? result.result : JSON.stringify(result.result))
  if (value.length > maxValue) value = value.slice(0, maxValue)
  return `TOOL_RESULT=${result.tool_id}\nstatus=${status}\nvalue=${value}`
}
