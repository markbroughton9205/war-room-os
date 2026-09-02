import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { isNativeRouterV1PilotEnabled } from './nativeRouterV1PilotGate'
import { captureRuntimeTrajectory, sourceTypeForExecuteMode } from './runtimeTrajectoryCapture'
import { getUnifiedTool } from './toolCatalog'
import { executeNormalizedRequest, routeToolIntent, type ExecuteMode, type ToolExecutionObservation } from './toolRouter'
import type { ToolRouterResult } from './types'
import type { TrajectorySourceType } from './trajectorySourceTypes'

export const NATIVE_ROUTER_V1_PILOT_ARTIFACT = 'WR-NATIVE-ROUTER-V1-CONTROLLED-PILOT-001'
export const NATIVE_ROUTER_V1_CANDIDATE_ID = 'WR-NATIVE-ROUTER-V1-CANDIDATE'

export const PILOT_SIX_ROUTES = ['NO_TOOL', 'WEB', 'MEMORY', 'FILES', 'RESEARCH', 'SHA256'] as const
export type PilotSixRoute = (typeof PILOT_SIX_ROUTES)[number]

const CONFIDENT_ABSTAIN = new Set(['ROUTE_CONFIDENT', 'NO_TOOL_CONFIDENT'])
const ABSTAIN_FALLBACK = new Set([
  'ROUTE_AMBIGUOUS',
  'NO_COMPATIBLE_TOOL',
  'INSUFFICIENT_CONTEXT',
  'TOOL_OPTIONAL',
])

const CLASS_TO_TOOL: Record<string, string | null> = {
  NO_TOOL: null,
  WEB: 'web',
  MEMORY: 'memory',
  FILES: 'files',
  RESEARCH: 'research',
  SHA256: 'sha256',
}

export type NativeRouterV1ServingScore = {
  artifact: string
  predicted_class: string
  tool_id: string | null
  gate: string
  information_state: string
  deterministic: string | null
  lexical: string | null
  wrim: null
  wrim_in_serving: false
  confidence: number
  margin: number
  abstain_state: string
  disagreement: boolean
  decision_stage: string
  lexical_fallback_used: boolean
  deterministic_rule_match: boolean
  schema_ok: boolean
  schema_reason: string
  multi_tool_required: boolean
  multi_tool_families: string[]
  suggested_compact: string | null
  serving_mode: 'full_skip_wrim'
}

export type PilotFallbackReason =
  | 'flag_off'
  | 'infer_unavailable'
  | 'multi_tool_required'
  | 'unsupported_route'
  | 'abstention'
  | 'ambiguous'
  | 'schema_invalid'
  | 'compact_unavailable'
  | 'tool_unavailable'
  | 'candidate_validation_failed'
  | 'planner_blocked'

export type NativeRouterV1PilotDecision = {
  request_id: string
  timestamp: string
  pilot_flag: boolean
  candidate_eligible: boolean
  candidate_route: string | null
  candidate_confidence: number | null
  information_state: string | null
  deterministic_rule_match: boolean
  lexical_fallback_used: boolean
  schema_validation: string
  fallback_used: boolean
  fallback_reason: PilotFallbackReason | null
  existing_router_route: string
  final_route: string
  multi_tool_detected: boolean
  wrim_in_serving: false
  planner_created: false
  candidate_routing_latency_ms: number
  total_routing_latency_ms: number
  real_runtime_fresh: boolean
  routed: ToolRouterResult
}

export type NativeRouterV1ServingInfer = (text: string) => NativeRouterV1ServingScore | null

let inferHook: NativeRouterV1ServingInfer | null = null

export function configureNativeRouterV1PilotForTests(infer: NativeRouterV1ServingInfer | null): void {
  inferHook = infer
}

export function classFromRouter(routed: ToolRouterResult): string {
  if (routed.intent.decision === 'NO_TOOL' || !routed.intent.tool_id) return 'NO_TOOL'
  const map: Record<string, string> = {
    web: 'WEB',
    memory: 'MEMORY',
    files: 'FILES',
    research: 'RESEARCH',
    sha256: 'SHA256',
  }
  return map[routed.intent.tool_id] ?? 'UNSUPPORTED'
}

function inferRoot(env: NodeJS.ProcessEnv): string {
  return env.WR_NATIVE_ROUTER_V1_INFER_ROOT?.trim() || process.cwd()
}

function spawnServingInfer(text: string, env: NodeJS.ProcessEnv): NativeRouterV1ServingScore | null {
  const repo = inferRoot(env)
  const python = env.WR_NATIVE_ROUTER_V1_PYTHON?.trim() || join(repo, '.venv-wrim', 'bin', 'python')
  const script = join(repo, 'scripts', 'wrim-modular', 'native_router_v1_serving_infer.py')
  const result = spawnSync(python, [script, '--text', text], {
    encoding: 'utf8',
    timeout: 20_000,
    cwd: repo,
  })
  if (result.status !== 0 || !result.stdout) return null
  try {
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>
    if (parsed.error) return null
    return {
      artifact: String(parsed.artifact ?? NATIVE_ROUTER_V1_CANDIDATE_ID),
      predicted_class: String(parsed.predicted_class),
      tool_id: parsed.tool_id == null ? null : String(parsed.tool_id),
      gate: String(parsed.gate ?? ''),
      information_state: String(parsed.information_state ?? ''),
      deterministic: parsed.deterministic == null ? null : String(parsed.deterministic),
      lexical: parsed.lexical == null ? null : String(parsed.lexical),
      wrim: null,
      wrim_in_serving: false,
      confidence: Number(parsed.confidence ?? 0),
      margin: Number(parsed.margin ?? 0),
      abstain_state: String(parsed.abstain_state ?? ''),
      disagreement: Boolean(parsed.disagreement),
      decision_stage: String(parsed.decision_stage ?? ''),
      lexical_fallback_used: Boolean(parsed.lexical_fallback_used),
      deterministic_rule_match: Boolean(parsed.deterministic_rule_match),
      schema_ok: Boolean(parsed.schema_ok),
      schema_reason: String(parsed.schema_reason ?? ''),
      multi_tool_required: Boolean(parsed.multi_tool_required),
      multi_tool_families: Array.isArray(parsed.multi_tool_families)
        ? parsed.multi_tool_families.map((x) => String(x))
        : [],
      suggested_compact: parsed.suggested_compact == null ? null : String(parsed.suggested_compact),
      serving_mode: 'full_skip_wrim',
    }
  } catch {
    return null
  }
}

export function scoreNativeRouterV1Serving(
  text: string,
  env: NodeJS.ProcessEnv = process.env,
): NativeRouterV1ServingScore | null {
  try {
    return inferHook ? inferHook(text) : spawnServingInfer(text, env)
  } catch {
    return null
  }
}

function toolAvailable(predicted: string): boolean {
  const toolId = CLASS_TO_TOOL[predicted]
  if (predicted === 'NO_TOOL' || toolId == null) return true
  const def = getUnifiedTool(toolId)
  return Boolean(def?.enabled && def.available)
}

function eligibility(
  score: NativeRouterV1ServingScore | null,
): { ok: boolean; reason: PilotFallbackReason | null } {
  if (!score) return { ok: false, reason: 'infer_unavailable' }
  if (score.multi_tool_required) return { ok: false, reason: 'multi_tool_required' }
  if (!PILOT_SIX_ROUTES.includes(score.predicted_class as PilotSixRoute)) {
    return { ok: false, reason: 'unsupported_route' }
  }
  if (score.abstain_state === 'ROUTE_AMBIGUOUS' || score.gate === 'AMBIGUOUS') {
    return { ok: false, reason: 'ambiguous' }
  }
  if (ABSTAIN_FALLBACK.has(score.abstain_state) || !CONFIDENT_ABSTAIN.has(score.abstain_state)) {
    return { ok: false, reason: 'abstention' }
  }
  if (!score.schema_ok) return { ok: false, reason: 'schema_invalid' }
  if (!score.suggested_compact) return { ok: false, reason: 'compact_unavailable' }
  if (!toolAvailable(score.predicted_class)) return { ok: false, reason: 'tool_unavailable' }
  return { ok: true, reason: null }
}

function newRequestId(): string {
  return `nrv1-pilot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function provenance(decision: NativeRouterV1PilotDecision, extras?: Record<string, string>): Record<string, string> {
  return {
    native_router_v1_pilot: decision.pilot_flag ? '1' : '0',
    native_router_v1_pilot_eligible: decision.candidate_eligible ? '1' : '0',
    native_router_v1_candidate_route: decision.candidate_route ?? '',
    native_router_v1_confidence: decision.candidate_confidence == null ? '' : String(decision.candidate_confidence),
    native_router_v1_state: decision.information_state ?? '',
    native_router_v1_det_match: decision.deterministic_rule_match ? '1' : '0',
    native_router_v1_lex_fallback: decision.lexical_fallback_used ? '1' : '0',
    native_router_v1_schema: decision.schema_validation,
    native_router_v1_fallback: decision.fallback_used ? '1' : '0',
    native_router_v1_fallback_reason: decision.fallback_reason ?? '',
    native_router_v1_existing_route: decision.existing_router_route,
    native_router_v1_final_route: decision.final_route,
    native_router_v1_multi_tool: decision.multi_tool_detected ? '1' : '0',
    native_router_v1_wrim_serving: '0',
    native_router_v1_planner: '0',
    native_router_v1_real_runtime_fresh: decision.real_runtime_fresh ? '1' : '0',
    native_router_v1_request_id: decision.request_id,
    ...extras,
  }
}

function observePilot(
  raw: string,
  decision: NativeRouterV1PilotDecision,
  extras?: { conversationId?: string | null; sourceType?: TrajectorySourceType },
): void {
  const sourceType = extras?.sourceType ?? 'REAL_RUNTIME'
  try {
    captureRuntimeTrajectory({
      request_text: raw,
      conversation_id: extras?.conversationId,
      request_id: decision.request_id,
      decision: decision.routed.intent.decision,
      tool_id: decision.routed.intent.decision === 'NO_TOOL' ? null : decision.routed.intent.tool_id,
      arguments: decision.routed.intent.arguments,
      router_validation_status: decision.routed.validation,
      execution_status: decision.routed.executed ? 'executed' : 'not_executed',
      tool_result_status: 'not_executed',
      tool_result: {
        executed: decision.routed.executed,
        validation: decision.routed.validation,
        errors: decision.routed.errors,
        executor: 'executeNormalizedRequest',
      },
      error: decision.routed.errors[0] ?? null,
      no_tool_reason:
        decision.routed.intent.decision === 'NO_TOOL'
          ? decision.fallback_reason === 'multi_tool_required'
            ? 'MULTI_TOOL_BLOCKED'
            : 'TOOL_NOT_REQUIRED'
          : null,
      source_type: sourceType,
      insertion_point: 'lib/modular-intelligence/nativeRouterV1Pilot.ts:routeServingIntent',
      duration_ms: decision.total_routing_latency_ms,
      context_dependence: extras?.conversationId ? 'CONTEXT_DEPENDENT' : 'STANDALONE',
      provenance: provenance(decision),
    })
  } catch (err) {
    console.error(
      '[native-router-v1-pilot] observe failed:',
      err instanceof Error ? err.message : err,
    )
  }
}

export function routeServingIntent(
  raw: string,
  opts?: {
    sourceModel?: string
    sourceModule?: string | null
    conversationId?: string | null
    sourceType?: TrajectorySourceType
    env?: NodeJS.ProcessEnv
    observe?: boolean
  },
): NativeRouterV1PilotDecision {
  const env = opts?.env ?? process.env
  const t0 = Date.now()
  const existing = routeToolIntent(raw, { sourceModel: opts?.sourceModel, sourceModule: opts?.sourceModule })
  const existingRoute = classFromRouter(existing)
  const requestId = newRequestId()
  const timestamp = new Date().toISOString()
  const sourceType = opts?.sourceType ?? 'REAL_RUNTIME'
  const genuineRuntime = sourceType === 'REAL_RUNTIME'

  const finish = (partial: Omit<NativeRouterV1PilotDecision, 'timestamp' | 'request_id' | 'total_routing_latency_ms' | 'wrim_in_serving' | 'planner_created'>): NativeRouterV1PilotDecision => {
    const decision: NativeRouterV1PilotDecision = {
      ...partial,
      request_id: requestId,
      timestamp,
      wrim_in_serving: false,
      planner_created: false,
      total_routing_latency_ms: Date.now() - t0,
    }
    if (opts?.observe !== false && decision.pilot_flag) {
      observePilot(raw, decision, { conversationId: opts?.conversationId, sourceType })
    }
    return decision
  }

  if (!isNativeRouterV1PilotEnabled(env)) {
    return finish({
      pilot_flag: false,
      candidate_eligible: false,
      candidate_route: null,
      candidate_confidence: null,
      information_state: null,
      deterministic_rule_match: false,
      lexical_fallback_used: false,
      schema_validation: 'not_run',
      fallback_used: false,
      fallback_reason: 'flag_off',
      existing_router_route: existingRoute,
      final_route: existingRoute,
      multi_tool_detected: false,
      candidate_routing_latency_ms: 0,
      real_runtime_fresh: false,
      routed: existing,
    })
  }

  const tInfer = Date.now()
  const scored = scoreNativeRouterV1Serving(raw, env)
  const candidateLatency = Date.now() - tInfer
  const gate = eligibility(scored)
  const multi = Boolean(scored?.multi_tool_required)

  if (!gate.ok || !scored) {
    return finish({
      pilot_flag: true,
      candidate_eligible: false,
      candidate_route: scored?.predicted_class ?? null,
      candidate_confidence: scored?.confidence ?? null,
      information_state: scored?.information_state ?? null,
      deterministic_rule_match: Boolean(scored?.deterministic_rule_match),
      lexical_fallback_used: Boolean(scored?.lexical_fallback_used),
      schema_validation: scored ? (scored.schema_ok ? 'ok' : scored.schema_reason || 'failed') : 'not_run',
      fallback_used: true,
      fallback_reason: gate.reason,
      existing_router_route: existingRoute,
      final_route: existingRoute,
      multi_tool_detected: multi,
      candidate_routing_latency_ms: candidateLatency,
      real_runtime_fresh: genuineRuntime,
      routed: existing,
    })
  }

  const compact =
    existingRoute === scored.predicted_class && raw.trim().startsWith('TOOL=')
      ? raw
      : scored.suggested_compact
  if (!compact) {
    return finish({
      pilot_flag: true,
      candidate_eligible: false,
      candidate_route: scored.predicted_class,
      candidate_confidence: scored.confidence,
      information_state: scored.information_state,
      deterministic_rule_match: scored.deterministic_rule_match,
      lexical_fallback_used: scored.lexical_fallback_used,
      schema_validation: 'compact_unavailable',
      fallback_used: true,
      fallback_reason: 'compact_unavailable',
      existing_router_route: existingRoute,
      final_route: existingRoute,
      multi_tool_detected: multi,
      candidate_routing_latency_ms: candidateLatency,
      real_runtime_fresh: genuineRuntime,
      routed: existing,
    })
  }

  const candidateRouted = routeToolIntent(compact, {
    sourceModel: opts?.sourceModel ?? 'WR-NATIVE-ROUTER-V1-CANDIDATE',
    sourceModule: opts?.sourceModule ?? 'nativeRouterV1Pilot',
  })
  if (candidateRouted.validation !== 'VALID') {
    return finish({
      pilot_flag: true,
      candidate_eligible: false,
      candidate_route: scored.predicted_class,
      candidate_confidence: scored.confidence,
      information_state: scored.information_state,
      deterministic_rule_match: scored.deterministic_rule_match,
      lexical_fallback_used: scored.lexical_fallback_used,
      schema_validation: candidateRouted.validation,
      fallback_used: true,
      fallback_reason: 'candidate_validation_failed',
      existing_router_route: existingRoute,
      final_route: existingRoute,
      multi_tool_detected: multi,
      candidate_routing_latency_ms: candidateLatency,
      real_runtime_fresh: genuineRuntime,
      routed: existing,
    })
  }

  return finish({
    pilot_flag: true,
    candidate_eligible: true,
    candidate_route: scored.predicted_class,
    candidate_confidence: scored.confidence,
    information_state: scored.information_state,
    deterministic_rule_match: scored.deterministic_rule_match,
    lexical_fallback_used: scored.lexical_fallback_used,
    schema_validation: 'VALID',
    fallback_used: false,
    fallback_reason: null,
    existing_router_route: existingRoute,
    final_route: classFromRouter(candidateRouted),
    multi_tool_detected: false,
    candidate_routing_latency_ms: candidateLatency,
    real_runtime_fresh: genuineRuntime,
    routed: candidateRouted,
  })
}

/** Chat research override only. Does not execute tools. Does not create a planner. */
export function applyPilotToResearchDecision(input: {
  text: string
  existingShouldResearch: boolean
  mandatory: boolean
  conversationId?: string | null
  env?: NodeJS.ProcessEnv
}): { shouldResearch: boolean; decision: NativeRouterV1PilotDecision } {
  const decision = routeServingIntent(input.text, {
    conversationId: input.conversationId,
    sourceType: 'REAL_RUNTIME',
    env: input.env,
  })
  if (input.mandatory) {
    return { shouldResearch: true, decision }
  }
  if (!decision.pilot_flag || !decision.candidate_eligible || decision.fallback_used) {
    return { shouldResearch: input.existingShouldResearch, decision }
  }
  if (decision.final_route === 'WEB' || decision.final_route === 'RESEARCH') {
    return { shouldResearch: true, decision }
  }
  return { shouldResearch: false, decision }
}

export function executePilotNormalizedRequest(
  decision: NativeRouterV1PilotDecision,
  mode: ExecuteMode,
  observation?: ToolExecutionObservation,
) {
  if (!decision.routed.normalized) {
    return {
      tool_id: decision.routed.intent.tool_id,
      status: 'not_executed' as const,
      result: null,
      error: 'no_normalized_request',
      provenance: { boundary: 'executeNormalizedRequest', skipped: 'true' },
    }
  }
  return executeNormalizedRequest(decision.routed.normalized, mode, {
    ...observation,
    sourceType: observation?.sourceType ?? sourceTypeForExecuteMode(mode),
  })
}

export function nativeRouterV1PilotCreatesPlanner(): false {
  return false
}
