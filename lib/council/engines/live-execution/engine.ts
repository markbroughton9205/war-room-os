import { selectTool, shouldRetryTool } from '../tool-selection/engine'
import { buildHierarchicalPlan } from '../hierarchical-planning/engine'
import { compileContext } from '../context-compiler/engine'
import { diagnoseFailure } from '../failure-diagnosis/engine'
import { dispatchCapability } from '../dispatch/engine'
import { executeParallelWave } from '../parallel-wave/engine'
import { classifyAuthorityGate, createGovernor, governorAllowsDispatch, recordDispatch, stopGovernor } from '../execution-governor/engine'
import { createEngineReceipt } from '../receipts'
import { measureParallelOverlap } from '../hierarchical-planning/engine'
import { DEFAULT_HANDLERS } from '../dispatch/handlers'
import type { LiveExecutionInput, LiveExecutionResult, TaskRunRecord, ExecutionWave } from './types'
import type { DispatchResult, ToolHandlerMap } from '../dispatch/types'
import type { PlanNode } from '../hierarchical-planning/types'
import type { CompiledContext, ContextCompilerInput } from '../context-compiler/types'
import type { BoardRowProvenance, EbcEvidence } from '@/lib/council/evidence-board/types'
import { fingerprintAction } from '../checkpoint/fingerprint'

function roleOf(node: PlanNode): ContextCompilerInput['role'] {
  const role = node.assigned_role
  if (role === 'PULSAR' || role === 'ORION' || role === 'LUMEN' || role === 'PHOENIX' || role === 'AURORA' || role === 'ATLAS' || role === 'JANUS' || role === 'SENTINEL') return role
  return 'ATLAS'
}

function compileFor(node: PlanNode, input: LiveExecutionInput): CompiledContext {
  return compileContext({
    mission_id: input.mission_id,
    role: roleOf(node),
    objective: input.objective,
    task_objective: node.objective,
    token_budget: 256,
    memory_facts: input.memory_facts,
  })
}

function evidenceFromDispatch(dispatch: DispatchResult, agent: string, missionId: string): (EbcEvidence & BoardRowProvenance) | null {
  if (!dispatch.ok || !dispatch.produces_evidence || !dispatch.work_product) return null
  const now = dispatch.completed_at
  const evidence_id = `e-${dispatch.task_id}-${dispatch.tool_id}`
  return {
    evidence_id,
    kind: dispatch.work_product.kind === 'none' ? 'live_telemetry' : dispatch.work_product.kind,
    pointer: dispatch.work_product.url || dispatch.work_product.work_product_id,
    url: dispatch.work_product.url ?? undefined,
    retrieved_at: now,
    observed_at: now,
    tool_name: dispatch.tool_id,
    temporal_layer: 'CURRENT_LIVE',
    agent_id: agent === 'PULSAR' || agent === 'ORION' || agent === 'LUMEN' || agent === 'PHOENIX' || agent === 'AURORA' || agent === 'NOVA' ? agent : 'ORION',
    round: 1,
    title: dispatch.work_product.title ?? dispatch.work_product.summary.slice(0, 80),
    source_type: dispatch.work_product.kind === 'primary_external' ? 'primary_external' : 'tool_result',
    ok: true,
    summary: dispatch.work_product.summary,
    mission_id: missionId,
    timestamp: now,
    provenance: 'live_execution_dispatch',
  }
}

function wrapForcedHandler(handlers: ToolHandlerMap | undefined, force: LiveExecutionInput['force_attempts']): ToolHandlerMap {
  const base: ToolHandlerMap = { ...DEFAULT_HANDLERS, ...(handlers ?? {}) }
  if (!force) return base
  for (const [tool, spec] of Object.entries(force)) {
    const inner = base[tool]
    let remaining = spec.times
    base[tool] = async input => {
      if (remaining > 0) {
        remaining -= 1
        return { ok: false, summary: spec.error, failure: spec.error, produces_evidence: false, kind: 'none' }
      }
      if (inner) return inner(input)
      const { cpuDigestWork } = await import('../dispatch/handlers')
      const work = await cpuDigestWork(`recover:${input.task_id}`)
      return { ok: true, summary: `recovered ${work.digest.slice(0, 8)}`, claims: ['recovered after bounded retry'], produces_evidence: true, kind: 'live_telemetry' }
    }
  }
  return base
}

export async function runLiveExecution(input: LiveExecutionInput): Promise<LiveExecutionResult> {
  const started = Date.now()
  const proof = input.proof_level ?? 'UNIT'
  let governor = createGovernor(input.mission_id, input.budget, input.spent)
  const planned = buildHierarchicalPlan({
    mission_id: input.mission_id,
    objective: input.objective,
    atlas_plan: input.atlas_plan,
    ebc_satisfied: input.ebc_satisfied,
  })
  const missionDecision = selectTool({
    mission_id: input.mission_id,
    objective: input.objective,
    available_tools: input.available_tools ?? ['research.web', 'browser.fetch', 'system.health', 'wr.ports.list', 'wr.ui.health', 'verification', 'synthesis'],
    remaining_evidence_gap: input.stale_freshness_gap
      ? [...(input.remaining_evidence_gap ?? []), 'stale evidence refresh required']
      : input.remaining_evidence_gap,
    ebc_satisfied: input.ebc_satisfied && !input.stale_freshness_gap,
    current_verified_memory: input.current_verified_memory,
    stale_freshness_gap: input.stale_freshness_gap,
    tool_health: input.tool_health,
  })

  const tasks: TaskRunRecord[] = planned.plan.nodes.filter(node => node.kind === 'TASK').map(node => ({
    task_id: node.id,
    state: 'PLANNED',
    selected_tool: null,
    decision: null,
    dispatch: null,
    skipped_reason: null,
  }))
  const waves: LiveExecutionResult['waves'] = []
  const wave_models: ExecutionWave[] = []
  const dispatches: DispatchResult[] = []
  const diagnoses: LiveExecutionResult['diagnoses'] = []
  const cancelled: string[] = []
  const receipts = [planned.receipt, missionDecision.receipt, governor.receipt]
  let avoided = 0
  let replans = 0
  const handlers = wrapForcedHandler(input.handlers, input.force_attempts)
  const succeeded = new Set<string>()
  const remaining = new Set(tasks.map(row => row.task_id))
  const skip = new Set(input.skip_task_ids ?? [])
  const doneDispatch = new Set(input.completed_dispatch_ids ?? [])
  for (const row of tasks) {
    if (skip.has(row.task_id) || doneDispatch.has(row.task_id)) {
      row.state = 'SUCCEEDED'
      row.skipped_reason = 'already completed; not rerun'
      remaining.delete(row.task_id)
      succeeded.add(row.task_id)
      avoided += 1
    }
  }
  const nodeById = new Map(planned.plan.nodes.map(node => [node.id, node]))
  let evidenceCount = 0

  if (input.ebc_satisfied || missionDecision.decision === 'NO_TOOL_REQUIRED') {
    for (const row of tasks) {
      if (succeeded.has(row.task_id)) continue
      row.state = 'SKIPPED'
      row.decision = 'NO_TOOL_REQUIRED'
      row.skipped_reason = missionDecision.reason
      remaining.delete(row.task_id)
    }
    avoided = tasks.filter(row => row.state === 'SKIPPED' || row.skipped_reason === 'already completed; not rerun').length
    governor = stopGovernor(governor, 'NO_TOOL_REQUIRED', input.mission_id)
  } else if (missionDecision.decision === 'TOOL_BLOCKED') {
    for (const row of tasks) {
      row.state = 'BLOCKED'
      row.decision = 'TOOL_BLOCKED'
      row.skipped_reason = missionDecision.reason
      remaining.delete(row.task_id)
    }
    avoided = tasks.length
    governor = stopGovernor(governor, 'TOOL_BLOCKED', input.mission_id)
  }

  const optional = new Set(input.optional_task_ids ?? ['s4'])
  const stopWhenComplete = input.stop_when_complete !== false
  const launch = input.launch_new_waves !== false

  while (remaining.size) {
    if (!launch) {
      for (const id of [...remaining]) {
        const row = tasks.find(task => task.task_id === id)
        if (row && row.state !== 'WAITING_AUTHORITY') {
          row.state = 'SKIPPED'
          row.skipped_reason = row.skipped_reason ?? 'new waves halted; existing work preserved'
        }
        remaining.delete(id)
      }
      break
    }
    if (governor.stopped) {
      for (const id of [...remaining]) {
        const row = tasks.find(task => task.task_id === id)
        if (row) {
          row.state = 'CANCELLED'
          row.skipped_reason = governor.stop_reason || 'governor stopped'
        }
        cancelled.push(id)
        remaining.delete(id)
      }
      break
    }
    if (stopWhenComplete && evidenceCount > 0 && [...remaining].every(id => optional.has(id))) {
      for (const id of [...remaining]) {
        const row = tasks.find(task => task.task_id === id)
        if (row) {
          row.state = 'CANCELLED'
          row.skipped_reason = 'mission complete; skip remaining optional work'
        }
        cancelled.push(id)
        remaining.delete(id)
      }
      break
    }

    const ready: PlanNode[] = []
    for (const id of remaining) {
      const node = nodeById.get(id)
      if (!node) {
        remaining.delete(id)
        continue
      }
      const deps = node.dependencies.filter(dep => nodeById.get(dep)?.kind === 'TASK' || tasks.some(row => row.task_id === dep))
      const unmet = deps.filter(dep => !succeeded.has(dep))
      const row = tasks.find(task => task.task_id === id)!
      if (unmet.length) {
        row.state = 'WAITING_DEPENDENCY'
        continue
      }
      ready.push(node)
    }
    if (!ready.length) break

    const waitMs = ready.some(node => node.dependencies.length)
      ? Math.max(0, ...ready.flatMap(node => node.dependencies.map(dep => {
        const disp = tasks.find(row => row.task_id === dep)?.dispatch
        return disp ? 1 : 0
      })))
      : 0

    const wave_id = `wave-${waves.length + 1}`
    let runnable = ready.filter(node => {
      const row = tasks.find(task => task.task_id === node.id)!
      const decision = selectTool({
        mission_id: input.mission_id,
        task_id: node.id,
        objective: node.objective || input.objective,
        available_tools: node.candidate_tools.length ? node.candidate_tools : (input.available_tools ?? ['system.health']),
        remaining_evidence_gap: input.remaining_evidence_gap ?? [node.objective],
        tool_health: input.tool_health,
        ebc_satisfied: false,
        current_verified_memory: input.current_verified_memory,
        stale_freshness_gap: input.stale_freshness_gap,
      })
      row.decision = decision.decision
      row.selected_tool = decision.selected_tool
      receipts.push(decision.receipt)
      if (decision.decision === 'NO_TOOL_REQUIRED') {
        row.state = 'SKIPPED'
        row.skipped_reason = decision.reason
        remaining.delete(node.id)
        avoided += 1
        return false
      }
      if (decision.decision === 'TOOL_BLOCKED' || !decision.selected_tool) {
        row.state = 'BLOCKED'
        row.skipped_reason = decision.reason
        remaining.delete(node.id)
        avoided += 1
        return false
      }
      const gate = classifyAuthorityGate(decision.selected_tool)
      const fp = fingerprintAction(decision.selected_tool, node.id)
      const approved = gate.class === 'COMMANDER_REQUIRED' && (input.approved_fingerprints ?? []).includes(fp)
      if (!gate.execute && !approved) {
        row.state = gate.class === 'COMMANDER_REQUIRED' ? 'WAITING_AUTHORITY' : 'BLOCKED'
        row.skipped_reason = gate.reason
        remaining.delete(node.id)
        return false
      }
      const allow = governorAllowsDispatch(governor, 'new')
      if (!allow.ok) {
        row.state = 'CANCELLED'
        row.skipped_reason = allow.reason
        cancelled.push(node.id)
        remaining.delete(node.id)
        governor = stopGovernor(governor, allow.reason, input.mission_id)
        return false
      }
      row.state = 'READY'
      return true
    })

    const capacity = Math.max(0, governor.budget.max_tool_calls - governor.tool_calls)
    if (runnable.length > capacity) {
      for (const extra of runnable.slice(capacity)) {
        const row = tasks.find(task => task.task_id === extra.id)!
        row.state = 'CANCELLED'
        row.skipped_reason = 'mission tool-call budget reached'
        cancelled.push(extra.id)
        remaining.delete(extra.id)
      }
      runnable = runnable.slice(0, capacity)
      if (!capacity) governor = stopGovernor(governor, 'mission tool-call budget reached', input.mission_id)
    }

    wave_models.push({
      wave_id,
      mission_id: input.mission_id,
      task_ids: ready.map(node => node.id),
      tool_actions: runnable.map(node => tasks.find(row => row.task_id === node.id)?.selected_tool ?? ''),
      dependencies: ready.map(node => node.dependencies),
      parallel_groups: [runnable.map(node => node.id)].filter(group => group.length > 1),
      authority_requirements: ready.map(node => node.authority_requirement),
      start_conditions: ['dependencies satisfied', 'authority execute', 'budget remaining'],
      stop_conditions: ['NO_TOOL_REQUIRED', 'TOOL_BLOCKED', 'WAITING_AUTHORITY', 'budget stop', 'completion'],
      budget: governor.budget,
      status: runnable.length ? 'RUNNING' : 'SKIPPED',
    })

    if (!runnable.length) continue

    const wave = await executeParallelWave({
      wave_id,
      mission_id: input.mission_id,
      dependency_wait_ms: waitMs,
      tasks: runnable.map(node => ({
        node,
        run: async () => {
          const row = tasks.find(task => task.task_id === node.id)!
          const selected = row.selected_tool!
          const context = compileFor(node, input)
          receipts.push(context.compiler_receipt)
          row.state = 'RUNNING'
          let dispatch = await dispatchCapability({
            mission_id: input.mission_id,
            wave_id,
            task_id: node.id,
            selected_tool: selected,
            requested_tool: selected,
            role: node.assigned_role,
            objective: input.objective,
            context,
            handlers,
            proof_level: proof,
            retry_number: 0,
          })
          governor = recordDispatch(governor, {
            duration_ms: dispatch.duration_ms,
            retry: false,
            local_model: /LOCAL|qwen/i.test(node.assigned_role),
            external: /research|browser|broker/.test(selected),
            mission_id: input.mission_id,
          })
          if (!dispatch.ok && dispatch.failure_class === 'TRANSIENT' && shouldRetryTool({ failure_class: 'TRANSIENT', attempts: 1 })) {
            const retryAllow = governorAllowsDispatch(governor, 'retry')
            if (retryAllow.ok) {
              dispatch = await dispatchCapability({
                mission_id: input.mission_id,
                wave_id,
                task_id: node.id,
                selected_tool: selected,
                requested_tool: selected,
                role: node.assigned_role,
                objective: input.objective,
                context,
                handlers,
                proof_level: proof,
                retry_number: 1,
              })
              governor = recordDispatch(governor, {
                duration_ms: dispatch.duration_ms,
                retry: true,
                local_model: false,
                external: /research|browser|broker/.test(selected),
                mission_id: input.mission_id,
              })
            }
          }
          if (!dispatch.ok && dispatch.failure_class === 'TRANSIENT') {
            const altDecision = selectTool({
              mission_id: input.mission_id,
              task_id: node.id,
              objective: input.objective,
              available_tools: (node.candidate_tools.length ? node.candidate_tools : (input.available_tools ?? [])).filter(tool => tool !== selected),
              remaining_evidence_gap: input.remaining_evidence_gap ?? [node.objective],
              tool_health: input.tool_health,
              previous_attempts: [{ tool_id: selected, failure_class: 'TRANSIENT', error: dispatch.failure ?? 'timeout' }],
            })
            if (altDecision.decision === 'SELECT' && altDecision.selected_tool && classifyAuthorityGate(altDecision.selected_tool).execute) {
              dispatch = await dispatchCapability({
                mission_id: input.mission_id,
                wave_id,
                task_id: node.id,
                selected_tool: altDecision.selected_tool,
                requested_tool: altDecision.selected_tool,
                role: node.assigned_role,
                objective: input.objective,
                context,
                handlers,
                proof_level: proof,
                retry_number: 1,
              })
              row.selected_tool = altDecision.selected_tool
              governor = recordDispatch(governor, {
                duration_ms: dispatch.duration_ms,
                retry: true,
                local_model: false,
                external: /research|browser|broker/.test(altDecision.selected_tool),
                mission_id: input.mission_id,
              })
            }
          }
          return dispatch
        },
      })),
    })
    waves.push(wave)
    receipts.push(wave.receipt)

    for (const dispatch of wave.results) {
      dispatches.push(dispatch)
      receipts.push(dispatch.receipt)
      const row = tasks.find(task => task.task_id === dispatch.task_id)!
      row.dispatch = dispatch
      row.state = dispatch.status
      remaining.delete(dispatch.task_id)
      if (dispatch.ok) {
        succeeded.add(dispatch.task_id)
        const evidence = evidenceFromDispatch(dispatch, nodeById.get(dispatch.task_id)?.assigned_role || 'ORION', input.mission_id)
        if (evidence && input.board) {
          input.board.evidence.push(evidence)
          evidenceCount += 1
        } else if (evidence) {
          evidenceCount += 1
        }
      } else {
        const diagnosis = diagnoseFailure({
          mission_id: input.mission_id,
          task_id: dispatch.task_id,
          symptom: dispatch.failure || dispatch.status,
          receipts: [{
            receipt_id: dispatch.receipt_id,
            capability: dispatch.capability,
            success: false,
            error: dispatch.failure,
          }],
        })
        diagnoses.push(diagnosis.diagnosis)
        receipts.push(diagnosis.receipt)
        const local = buildHierarchicalPlan({
          mission_id: input.mission_id,
          objective: input.objective,
          atlas_plan: input.atlas_plan,
          failed_task_id: dispatch.task_id,
        })
        receipts.push(local.receipt)
        replans += 1
        row.state = 'REPLANNED'
        for (const sibling of tasks) {
          if (sibling.state === 'SUCCEEDED') continue
          if (sibling.task_id === dispatch.task_id) continue
          const node = local.plan.nodes.find(item => item.id === sibling.task_id)
          if (node && node.status !== 'COMPLETE') {
            if (local.plan.change_reason?.includes(dispatch.task_id) && node.dependencies.includes(dispatch.task_id)) {
              sibling.state = 'REPLANNED'
            }
          }
        }
      }
    }
  }

  const overlap = measureParallelOverlap(dispatches.map(row => ({
    task_id: row.task_id,
    started_at: row.started_at,
    completed_at: row.completed_at,
    depends_on: nodeById.get(row.task_id)?.dependencies ?? [],
  })))
  const waiting = tasks.some(row => row.state === 'WAITING_AUTHORITY')
  const blocked = tasks.some(row => row.state === 'BLOCKED')
  const failed = tasks.some(row => row.state === 'FAILED')
  const completion = input.ebc_satisfied || missionDecision.decision === 'NO_TOOL_REQUIRED'
    ? 'COMPLETE'
    : waiting ? 'WAITING_AUTHORITY'
      : blocked && !dispatches.some(row => row.ok) ? 'BLOCKED'
        : failed && !succeeded.size ? 'FAILED'
          : succeeded.size ? 'COMPLETE'
            : 'PARTIAL'

  const ebc_evidence_ids = (input.board?.evidence ?? []).map(row => row.evidence_id).filter((id): id is string => Boolean(id))
  receipts.push(createEngineReceipt({
    engine: 'live-execution',
    mission_id: input.mission_id,
    input_refs: [missionDecision.decision],
    output_refs: [completion, `dispatches:${dispatches.length}`],
    started_at: started,
    decision_count: dispatches.length,
    decision: completion,
  }))

  return {
    mission_id: input.mission_id,
    proof_level: proof,
    waves,
    wave_models,
    tasks,
    dispatches,
    avoided_tool_calls: avoided,
    cancelled_tasks: cancelled,
    replans,
    diagnoses,
    overlap_ms: overlap.overlap_ms,
    parallelism: overlap.overlap_ms > 0 ? 'PARALLEL' : 'SERIAL',
    completion,
    ebc_evidence_ids,
    receipt_ids: dispatches.map(row => row.receipt_id),
    governor,
    plan: planned.plan,
    grants_authority: false,
    ebc_canonical: true,
    receipts,
  }
}

export { evidenceFromDispatch }
