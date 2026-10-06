/**
 * ENGINE-03P production invocation coordinator.
 * Async boundary around the existing sync CouncilExecutive.
 * Does not replace EBC. Does not grant authority. Not a second Council.
 */
import { createEvidenceBoard } from '@/lib/council/evidence-board/board'
import { createToolRunner, type ToolRunner } from '@/lib/council/evidence-board/tools'
import type { ToolCallRecord } from '@/lib/council/evidence-board/types'
import type { EbcMissionClass, MissionEvidenceBoard } from '@/lib/council/evidence-board/types'
import { liveHandlerMap } from '../dispatch/handlers'
import type { ToolHandlerMap } from '../dispatch/types'
import type { DispatchResult } from '../dispatch/types'
import { runLiveExecution } from '../live-execution/engine'
import type { LiveExecutionInput, LiveExecutionResult } from '../live-execution/types'
import type { ProofLevel } from '../execution-governor/types'

export const ENGINE03_PRODUCTION_PHASES = ['PLANNING', 'SELECTING', 'EXECUTING', 'VERIFYING', 'SYNTHESIZING'] as const
export type Engine03ProductionPhase = (typeof ENGINE03_PRODUCTION_PHASES)[number]

const EBC_FROM_ENGINE: Record<string, string> = {
  'system.health': 'wr.core.health',
  'wr.ui.health': 'wr.ui.health',
  'wr.ports.list': 'wr.ports.list',
  'wr.council.backend': 'wr.council.backend',
  'browser.status': 'wr.broker.status',
  'research.web': 'broker.fetch',
  'browser.fetch': 'broker.fetch',
  verification: 'verification',
  synthesis: 'synthesis',
  adversarial_review: 'adversarial_review',
  'git.commit': 'git.commit',
}

const ENGINE_FROM_EBC: Record<string, string> = {
  'wr.core.health': 'system.health',
  'wr.ui.health': 'wr.ui.health',
  'wr.ports.list': 'wr.ports.list',
  'wr.council.backend': 'wr.council.backend',
  'wr.broker.status': 'browser.status',
  'broker.fetch': 'research.web',
  'browser.fetch': 'browser.fetch',
  'research.web': 'research.web',
  'system.health': 'system.health',
  verification: 'verification',
  synthesis: 'synthesis',
  adversarial_review: 'adversarial_review',
  'git.commit': 'git.commit',
}

const COMMANDER_GATED = new Set(['git.commit', 'git.push', 'deploy.run', 'finance.spend', 'finance.trade', 'finance.wager', 'finance.settlement_submit', 'foundry.execute'])
const RESEARCH_TOOLS = new Set(['broker.fetch', 'research.web', 'browser.fetch', 'browser.navigate'])

function blockedCall(toolName: string, args: Record<string, unknown> | undefined, reason: string): ToolCallRecord {
  return {
    tool_name: toolName,
    args_fingerprint: `engine03p-block:${toolName}`,
    ok: false,
    blocked: true,
    denied: /authority|Commander/i.test(reason),
    summary: reason,
    pointer: toolName,
    url: null,
    title: null,
    kind: 'tool_result',
    retrieved_at: new Date().toISOString(),
    temporal_layer: 'CURRENT_LIVE',
  }
}

export function mapEbcToolToEngine03(tool: string): string {
  return ENGINE_FROM_EBC[tool] ?? tool
}

export function mapEngine03ToolToEbc(tool: string): string {
  return EBC_FROM_ENGINE[tool] ?? tool
}

export function formatCommanderApprovalRequest(action: string): string {
  return [
    'Foundry can perform this action.',
    `Action: ${action}`,
    'Authority required: Commander',
    'Approve / Decline',
  ].join('\n')
}

export function dispatchToToolCall(dispatch: DispatchResult): ToolCallRecord {
  const tool_name = mapEngine03ToolToEbc(dispatch.tool_id)
  const kind = dispatch.work_product?.kind === 'primary_external' ? 'primary_external' : dispatch.ok ? 'live_telemetry' : 'tool_result'
  return {
    tool_name,
    args_fingerprint: `engine03:${dispatch.receipt_id}`,
    ok: dispatch.ok,
    blocked: dispatch.status === 'BLOCKED' || dispatch.status === 'WAITING_AUTHORITY' || dispatch.status === 'SKIPPED',
    denied: dispatch.authority === 'COMMANDER_REQUIRED' || dispatch.authority === 'PROHIBITED' || dispatch.status === 'WAITING_AUTHORITY',
    summary: dispatch.work_product?.summary ?? dispatch.failure ?? dispatch.status,
    pointer: dispatch.work_product?.url || dispatch.work_product_ref || dispatch.tool_id,
    url: dispatch.work_product?.url ?? null,
    title: dispatch.work_product?.title ?? null,
    kind,
    retrieved_at: dispatch.completed_at,
    temporal_layer: 'CURRENT_LIVE',
  }
}

function findDispatch(live: LiveExecutionResult, ebcTool: string): DispatchResult | undefined {
  const engineTool = mapEbcToolToEngine03(ebcTool)
  return live.dispatches.find(row => row.tool_id === ebcTool || row.tool_id === engineTool || mapEngine03ToolToEbc(row.tool_id) === ebcTool)
}

export function wrapToolRunnerForEngine03(inner: ToolRunner, live: LiveExecutionResult, unexpected_failure = false): ToolRunner {
  const missionNoTool = live.tasks.some(row => row.decision === 'NO_TOOL_REQUIRED') && live.dispatches.length === 0
  const missionBlocked = live.completion === 'BLOCKED' || live.tasks.some(row => row.decision === 'TOOL_BLOCKED' && !row.dispatch)
  const waiting = live.completion === 'WAITING_AUTHORITY'
  return async (toolName, args = {}) => {
    if (unexpected_failure && RESEARCH_TOOLS.has(toolName)) {
      return blockedCall(toolName, args, 'Engine-03 invocation failed; ungoverned fallback refused')
    }
    if (waiting && COMMANDER_GATED.has(toolName)) {
      return blockedCall(toolName, args, 'Commander approval required; execution waits')
    }
    const hit = findDispatch(live, toolName)
    if (hit) return dispatchToToolCall(hit)
    const halted = live.tasks.some(row => /already completed|new waves halted|paused/i.test(row.skipped_reason || ''))
    if (halted) {
      return blockedCall(toolName, args, 'already completed or halted; not rerun')
    }
    if (missionNoTool && RESEARCH_TOOLS.has(toolName)) {
      return blockedCall(toolName, args, 'NO_TOOL_REQUIRED; Engine-03 issued zero dispatches')
    }
    if (missionBlocked && (RESEARCH_TOOLS.has(toolName) || toolName === mapEngine03ToolToEbc(live.tasks.find(row => row.decision === 'TOOL_BLOCKED')?.selected_tool || ''))) {
      return blockedCall(toolName, args, 'TOOL_BLOCKED; no hidden fallback')
    }
    return inner(toolName, args)
  }
}

export function handlersFromToolRunner(runner: ToolRunner): ToolHandlerMap {
  const names = ['system.health', 'wr.ui.health', 'wr.ports.list', 'wr.council.backend', 'browser.status', 'research.web', 'browser.fetch', 'verification', 'synthesis', 'adversarial_review']
  const map: ToolHandlerMap = {}
  for (const engineTool of names) {
    const ebcTool = mapEngine03ToolToEbc(engineTool)
    map[engineTool] = async input => {
      const rec = await runner(ebcTool, { mission_id: input.mission_id, query: input.objective, objective: input.objective, task_id: input.task_id })
      if (!rec.ok && (engineTool === 'verification' || engineTool === 'synthesis' || engineTool === 'adversarial_review')) {
        return {
          ok: true,
          summary: `${engineTool} deferred to Evidence Board Council`,
          claims: [],
          produces_evidence: false,
          kind: 'none' as const,
        }
      }
      return {
        ok: rec.ok && !rec.blocked && !rec.denied,
        summary: rec.summary,
        claims: rec.ok ? [rec.summary] : [],
        failure: rec.ok ? null : rec.summary,
        produces_evidence: Boolean(rec.ok && !rec.blocked),
        kind: rec.kind === 'primary_external' ? 'primary_external' : rec.ok ? 'live_telemetry' : 'none',
        url: rec.url ?? null,
        title: rec.title ?? null,
      }
    }
  }
  return map
}

export type ProductionLiveInvocation = {
  live: LiveExecutionResult
  production_invoked: true
  injection: false
  phases: Engine03ProductionPhase[]
  unexpected_failure: boolean
  approval_request: string | null
}

export async function invokeEngine03ForProduction(input: {
  mission_id: string
  objective: string
  mission_class: EbcMissionClass
  atlas_plan?: LiveExecutionInput['atlas_plan']
  remaining_evidence_gap?: readonly string[]
  available_tools?: readonly string[]
  ebc_satisfied?: boolean
  tools?: ToolRunner
  board?: MissionEvidenceBoard | null
  proof_level?: ProofLevel
  tool_health?: LiveExecutionInput['tool_health']
  force_attempts?: LiveExecutionInput['force_attempts']
  onPhase?: (phase: Engine03ProductionPhase) => void
  skip_task_ids?: readonly string[]
  completed_dispatch_ids?: readonly string[]
  current_verified_memory?: boolean
  stale_freshness_gap?: boolean
  memory_facts?: LiveExecutionInput['memory_facts']
  approved_fingerprints?: readonly string[]
  launch_new_waves?: boolean
  spent?: LiveExecutionInput['spent']
}): Promise<ProductionLiveInvocation> {
  const phases: Engine03ProductionPhase[] = []
  const emit = (phase: Engine03ProductionPhase) => {
    phases.push(phase)
    input.onPhase?.(phase)
  }
  emit('PLANNING')
  const board = input.board ?? createEvidenceBoard({
    mission_id: input.mission_id,
    mission_class: input.mission_class,
    question: input.objective,
    agents: ['ORION', 'PULSAR', 'LUMEN', 'PHOENIX', 'AURORA'],
    ttl_seconds: 120,
    budget_tokens: 4000,
    budget_ms: 60_000,
  })
  const handlers = input.tools ? handlersFromToolRunner(input.tools) : liveHandlerMap()
  const proof = input.proof_level ?? (input.tools ? 'UNIT' : 'LIVE_INSTALLED')
  emit('SELECTING')
  emit('EXECUTING')
  let live: LiveExecutionResult
  let unexpected_failure = false
  try {
    live = await runLiveExecution({
      mission_id: input.mission_id,
      objective: input.objective,
      atlas_plan: input.atlas_plan,
      remaining_evidence_gap: input.remaining_evidence_gap,
      available_tools: input.available_tools,
      ebc_satisfied: input.ebc_satisfied,
      handlers,
      board,
      proof_level: proof,
      tool_health: input.tool_health,
      force_attempts: input.force_attempts,
      optional_task_ids: [],
      stop_when_complete: true,
      skip_task_ids: input.skip_task_ids,
      completed_dispatch_ids: input.completed_dispatch_ids,
      current_verified_memory: input.current_verified_memory,
      stale_freshness_gap: input.stale_freshness_gap,
      memory_facts: input.memory_facts,
      approved_fingerprints: input.approved_fingerprints,
      launch_new_waves: input.launch_new_waves,
      spent: input.spent,
    })
  } catch (error) {
    unexpected_failure = true
    const message = error instanceof Error ? error.message : String(error)
    live = {
      mission_id: input.mission_id,
      proof_level: proof,
      waves: [],
      wave_models: [],
      tasks: [],
      dispatches: [],
      avoided_tool_calls: 0,
      cancelled_tasks: [],
      replans: 0,
      diagnoses: [],
      overlap_ms: 0,
      parallelism: 'SERIAL',
      completion: 'FAILED',
      ebc_evidence_ids: [],
      receipt_ids: [],
      governor: (await import('../execution-governor/engine')).createGovernor(input.mission_id),
      plan: { mission_id: input.mission_id, nodes: [], edges: [], parallel_groups: [], atlas_role: 'ATLAS', grants_authority: false, equivalent_to_previous: false, stopped_for_completion: true, change_reason: message },
      grants_authority: false,
      ebc_canonical: true,
      receipts: [],
    }
  }
  emit('VERIFYING')
  emit('SYNTHESIZING')
  const gatedSteps = (input.atlas_plan?.steps ?? []).filter(step =>
    step.approval_required
    || step.status === 'BLOCKED_BY_AUTHORITY'
    || step.required_capabilities.some(cap => COMMANDER_GATED.has(cap)),
  )
  if (
    gatedSteps.length
    && live.completion !== 'WAITING_AUTHORITY'
    && !live.dispatches.some(row => COMMANDER_GATED.has(row.tool_id) && row.ok)
  ) {
    for (const step of gatedSteps) {
      const row = live.tasks.find(task => task.task_id === step.step_id)
      if (row && row.state !== 'SUCCEEDED') {
        row.state = 'WAITING_AUTHORITY'
        row.selected_tool = step.required_capabilities.find(cap => COMMANDER_GATED.has(cap)) ?? row.selected_tool
        row.decision = row.decision ?? 'SELECT'
      }
    }
    live = { ...live, completion: 'WAITING_AUTHORITY' }
  }
  const waiting = live.tasks.find(row => row.state === 'WAITING_AUTHORITY')
  const approval_request = live.completion === 'WAITING_AUTHORITY'
    ? formatCommanderApprovalRequest(waiting?.selected_tool || waiting?.task_id || 'restricted action')
    : null
  return {
    live,
    production_invoked: true,
    injection: false,
    phases,
    unexpected_failure,
    approval_request,
  }
}

export function defaultProductionToolRunner(live: LiveExecutionResult, unexpected_failure: boolean): ToolRunner {
  const disabled = unexpected_failure ? ['broker.fetch', 'browser.fetch', 'research.web'] : []
  return wrapToolRunnerForEngine03(createToolRunner({ disabledTools: disabled, denyBrowser: unexpected_failure }), live, unexpected_failure)
}
