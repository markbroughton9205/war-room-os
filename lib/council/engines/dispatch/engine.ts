import { lookupCapability } from '@/lib/council/intelligence/capabilityRegistry'
import { resourceClassForTask } from '@/lib/council/intelligence/adaptiveIntelligence'
import { classifyToolFailure } from '../tool-selection/engine'
import { createEngineReceipt } from '../receipts'
import { classifyAuthorityGate, maybeUpgradeAuthority } from '../execution-governor/engine'
import { DEFAULT_HANDLERS } from './handlers'
import type { DispatchResult, ToolHandler, ToolHandlerMap } from './types'
import type { CompiledContext } from '../context-compiler/types'
import type { ProofLevel } from '../execution-governor/types'
import type { FailureClass } from '../tool-selection/types'

let seq = 0
function id(prefix: string): string {
  seq += 1
  return `${prefix}-${seq.toString(36)}`
}

export function resolveHandler(tool: string, handlers?: ToolHandlerMap): ToolHandler | null {
  return handlers?.[tool] ?? DEFAULT_HANDLERS[tool] ?? null
}

export async function dispatchCapability(input: {
  mission_id: string
  wave_id: string
  task_id: string
  selected_tool: string
  requested_tool?: string
  role: string
  objective: string
  context: CompiledContext
  handlers?: ToolHandlerMap
  proof_level?: ProofLevel
  retry_number?: number
  seems_safe?: boolean
}): Promise<DispatchResult> {
  const startedMs = Date.now()
  const started_at = new Date(startedMs).toISOString()
  const selected = input.selected_tool
  const requested = input.requested_tool ?? selected
  const decision_honored = requested === selected
  const tool = selected
  const gate0 = classifyAuthorityGate(tool)
  const gate = maybeUpgradeAuthority(gate0, input.seems_safe === true)
  const cap = lookupCapability(tool)
  const receipt_id = id('disp')

  const fail = (status: DispatchResult['status'], failure: string, failure_class: FailureClass, failure_state: DispatchResult['receipt']['failure_state']): DispatchResult => {
    const completed_at = new Date().toISOString()
    return {
      mission_id: input.mission_id,
      wave_id: input.wave_id,
      task_id: input.task_id,
      tool_id: tool,
      capability: cap?.capability_id || tool,
      selected_tool: selected,
      decision_honored,
      authority: gate.class,
      started_at,
      completed_at,
      duration_ms: Math.max(0, Date.now() - startedMs),
      status,
      ok: false,
      work_product_ref: null,
      work_product: null,
      failure_ref: receipt_id,
      failure,
      failure_class,
      retry_number: input.retry_number ?? 0,
      context_tokens: input.context.tokens_used,
      context_owner: input.context.role,
      evidence_refs: [...input.context.relevant_evidence_refs],
      produces_evidence: false,
      receipt_id,
      proof_level: input.proof_level ?? 'UNIT',
      receipt: createEngineReceipt({
        engine: 'war-room-dispatch',
        mission_id: input.mission_id,
        task_id: input.task_id,
        input_refs: [tool, input.context.compiler_receipt.engine],
        output_refs: [status],
        started_at: startedMs,
        decision_count: 1,
        decision: status,
        failure_state,
      }),
    }
  }

  if (!decision_honored) {
    return fail('BLOCKED', 'dispatch refused: requested tool is not the ToolSelectionDecision', 'DETERMINISTIC', 'authority_blocked')
  }
  if (!gate.execute) {
    return fail(
      gate.class === 'COMMANDER_REQUIRED' ? 'WAITING_AUTHORITY' : 'BLOCKED',
      gate.reason,
      'AUTHORITY',
      gate.class === 'COMMANDER_REQUIRED' ? 'waiting_authority' : 'authority_blocked',
    )
  }
  const handler = resolveHandler(tool, input.handlers)
  if (!handler) {
    return fail('BLOCKED', 'no registered handler for capability', 'DETERMINISTIC', 'dispatch_failed')
  }

  let ok = false
  let summary = ''
  let claims: string[] = []
  let failure: string | null = null
  let produces_evidence = false
  let kind: NonNullable<DispatchResult['work_product']>['kind'] = 'none'
  let url: string | null = null
  let title: string | null = null
  try {
    const out = await handler({
      mission_id: input.mission_id,
      task_id: input.task_id,
      tool_id: tool,
      objective: input.objective,
      context: input.context,
      proof_level: input.proof_level ?? 'UNIT',
    })
    ok = out.ok
    summary = out.summary
    claims = out.claims ?? []
    failure = out.failure ?? (out.ok ? null : 'handler failed')
    produces_evidence = Boolean(out.produces_evidence && out.ok)
    kind = out.kind ?? (produces_evidence ? 'live_telemetry' : 'none')
    url = out.url ?? null
    title = out.title ?? null
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
    ok = false
  }

  const completed_at = new Date().toISOString()
  const duration_ms = Math.max(0, Date.now() - startedMs)
  const failure_class = classifyToolFailure(failure ?? undefined)
  const work_product_id = ok ? id('wp') : null
  void resourceClassForTask
  return {
    mission_id: input.mission_id,
    wave_id: input.wave_id,
    task_id: input.task_id,
    tool_id: tool,
    capability: cap?.capability_id || tool,
    selected_tool: selected,
    decision_honored: true,
    authority: gate.class,
    started_at,
    completed_at,
    duration_ms,
    status: ok ? 'SUCCEEDED' : 'FAILED',
    ok,
    work_product_ref: work_product_id,
    work_product: work_product_id
      ? {
        work_product_id,
        summary,
        claims,
        role: input.role,
        produces_evidence,
        kind,
        url,
        title,
      }
      : null,
    failure_ref: ok ? null : receipt_id,
    failure,
    failure_class,
    retry_number: input.retry_number ?? 0,
    context_tokens: input.context.tokens_used,
    context_owner: input.context.role,
    evidence_refs: [...input.context.relevant_evidence_refs],
    produces_evidence,
    receipt_id,
    proof_level: input.proof_level ?? 'UNIT',
    receipt: createEngineReceipt({
      engine: 'war-room-dispatch',
      mission_id: input.mission_id,
      task_id: input.task_id,
      input_refs: [tool, input.context.compiler_receipt.engine, `tokens:${input.context.tokens_used}`],
      output_refs: work_product_id ? [work_product_id] : [ok ? 'ok' : 'fail'],
      started_at: startedMs,
      decision_count: 1,
      decision: ok ? 'SUCCEEDED' : 'FAILED',
      failure_state: ok ? 'none' : 'dispatch_failed',
    }),
  }
}
