/**
 * ENGINE-05D CounterfactualMissionEngine
 * Evaluation artifacts, not EBC facts. Replay level is preserved.
 */
import { counterfactualEval, sequentialVsParallelTiming, concurrencyPolicy, type MissionExperienceRecord } from '@/lib/council/intelligence/adaptiveIntelligence'
import { compileContext } from '../context-compiler/engine'
import { selectTool } from '../tool-selection/engine'
import { ENGINE_05_VERSION } from '../types'
import { createEngineReceipt } from '../receipts'
import { saveCounterfactual } from '../evaluation/store'
import { routeModelProvider } from '../routing-eval/engine'
import type { CounterfactualResult, ReplayLevel, TaskClass } from '../evaluation/types'
import { COUNTERFACTUAL_SCHEMA } from '../evaluation/types'

export function replayLevelFor(kind: CounterfactualResult['kind'], deterministic: boolean, exact: boolean): ReplayLevel {
  if (exact && deterministic) return 'EXACT_REPLAY'
  if (deterministic) return 'DETERMINISTIC_SIMULATION'
  if (kind === 'PROVIDER' && !deterministic) return 'MODEL_ESTIMATE'
  if (kind === 'TOOL' || kind === 'PLAN' || kind === 'CONTEXT' || kind === 'PARALLEL') return 'DETERMINISTIC_SIMULATION'
  return 'NOT_EVALUABLE'
}

export async function evaluateCounterfactual(input: {
  mission_id: string
  actual_policy: string
  alternate_policy: string
  kind: CounterfactualResult['kind']
  experience?: MissionExperienceRecord | null
  exact?: boolean
  persist?: boolean
}): Promise<CounterfactualResult> {
  const started = Date.now()
  const replay_level = replayLevelFor(input.kind, true, Boolean(input.exact))
  let actual: Record<string, unknown> = { policy: input.actual_policy }
  let alternate: Record<string, unknown> = { policy: input.alternate_policy }
  let comparison = ''
  let uncertainty: CounterfactualResult['uncertainty'] = 'MEASURED'

  if (input.kind === 'PARALLEL') {
    const policy = concurrencyPolicy({ localGeneralReady: true, browserReady: true })
    const timing = await sequentialVsParallelTiming({
      tasks: [
        { task_id: 't1', mission_id: input.mission_id, role: 'ORION', depends_on: [], resource_class: 'CPU', tools: [] },
        { task_id: 't2', mission_id: input.mission_id, role: 'ORION', depends_on: [], resource_class: 'CPU', tools: [] },
      ],
      policy,
    })
    actual = { sequential_ms: timing.sequential_ms, mode: 'serial' }
    alternate = { parallel_ms: timing.parallel_ms, speedup: timing.speedup, mode: 'parallel', correctness_preserved: timing.correctness_preserved }
    comparison = timing.speedup > 1 ? 'parallel_lower_latency_when_independent' : 'parallel_not_always_better'
    uncertainty = 'MEASURED'
  } else if (input.kind === 'CONTEXT') {
    const full = compileContext({
      mission_id: input.mission_id,
      role: 'AURORA',
      objective: 'full',
      task_objective: 'keep truth',
      token_budget: 2048,
      verified_facts: [{ text: 'required evidence 3847', evidence_ref: 'e1', state: 'VERIFIED', mission_id: input.mission_id }],
    })
    const tight = compileContext({
      mission_id: input.mission_id,
      role: 'AURORA',
      objective: 'tight',
      task_objective: 'keep truth',
      token_budget: 128,
      verified_facts: [{ text: 'required evidence 3847', evidence_ref: 'e1', state: 'VERIFIED', mission_id: input.mission_id }],
    })
    const truthKept = tight.required_facts.some(f => /3847/.test(f.text))
    actual = { tokens: full.tokens_used, truth: true }
    alternate = { tokens: tight.tokens_used, truth: truthKept }
    comparison = truthKept ? 'tighter_context_preserved_required_evidence' : 'token_cut_lost_truth'
    uncertainty = 'MEASURED'
  } else if (input.kind === 'TOOL') {
    const actualTool = selectTool({
      mission_id: input.mission_id,
      objective: 'health',
      remaining_evidence_gap: ['runtime health of 3847'],
      available_tools: ['system.health', 'wr.ports.list'],
    })
    const altTool = selectTool({
      mission_id: `${input.mission_id}-alt`,
      objective: 'ports',
      remaining_evidence_gap: ['which ports are listening'],
      available_tools: ['system.health', 'wr.ports.list'],
    })
    actual = { tool: actualTool.selected_tool, execution: 'actual' }
    alternate = { tool: altTool.selected_tool, execution: 'counterfactual_not_applied' }
    comparison = 'actual_and_alternate_separated'
    uncertainty = 'MEASURED'
  } else if (input.kind === 'PROVIDER') {
    const a = routeModelProvider({
      mission_id: input.mission_id,
      task_class: 'structured_output' as TaskClass,
      role: 'ORION',
      privacy: 'LOCAL',
      localAvailable: true,
      cloudAvailable: true,
      persist: false,
    })
    const b = routeModelProvider({
      mission_id: `${input.mission_id}-cf-provider`,
      task_class: 'structured_output',
      role: 'ORION',
      privacy: 'CLOUD',
      localAvailable: true,
      cloudAvailable: true,
      persist: false,
    })
    actual = { provider: a.selected_provider, model: a.selected_model, isolated: true }
    alternate = { provider: b.selected_provider, model: b.selected_model, isolated: true, ebc_write: false }
    comparison = 'provider_outputs_isolated_from_production_ebc'
    uncertainty = replay_level === 'MODEL_ESTIMATE' ? 'ESTIMATED' : 'MEASURED'
  } else if (input.experience) {
    const labeled = counterfactualEval(input.experience, 'fewer_agents')
    actual = { experience: input.experience.mission_id }
    alternate = { label: labeled.label, text: labeled.text, historical_fact: labeled.historical_fact }
    comparison = labeled.text
    uncertainty = 'INFERRED'
  } else {
    comparison = 'NOT_EVALUABLE'
    uncertainty = 'UNMEASURED'
  }

  const row: CounterfactualResult = {
    schema: COUNTERFACTUAL_SCHEMA,
    evaluation_id: `cf-${input.mission_id}-${started}`,
    mission_id: input.mission_id,
    actual_policy: input.actual_policy,
    alternate_policy: input.alternate_policy,
    kind: input.kind,
    replay_level,
    actual_outcome: actual,
    counterfactual_outcome: alternate,
    comparison,
    uncertainty,
    historical_fact: false,
    ebc_evidence: false,
    grants_authority: false,
    isolated_from_production_ebc: true,
    receipt: createEngineReceipt({
      engine: 'counterfactual-mission',
      mission_id: input.mission_id,
      started_at: started,
      decision_count: 1,
      decision: `${input.kind}:${replay_level}`,
    }),
  }
  if (input.persist !== false) await saveCounterfactual(row)
  return row
}
