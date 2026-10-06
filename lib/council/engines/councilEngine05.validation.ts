/**
 * Council ENGINE-05: capability benchmarks, policy evaluation, routing, counterfactuals, promotion.
 * Does not replace EBC, ATLAS, CouncilExecutive, Engine-01/02/03/03P/04. Does not train WRIM.
 * Does not auto-promote production policy.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  ENGINE_01_VERSION,
  ENGINE_02_VERSION,
  ENGINE_03_VERSION,
  ENGINE_04_VERSION,
  ENGINE_05_VERSION,
  ENGINE_05_CAPABILITY_MAP,
  runCapabilityBenchmark,
  staleBenchmark,
  createPolicyCandidate,
  evaluatePolicy,
  runShadowEvaluation,
  requireHypothesis,
  heldOutIsolated,
  routeModelProvider,
  knownProviderRecords,
  inferTaskClass,
  evaluateCounterfactual,
  replayLevelFor,
  fingerprintPolicy,
  recommendPromotion,
  mayReachCommanderReview,
  buildPromotionReceipt,
  applyCommanderApproval,
  promoteApproved,
  rollbackPolicy,
  mutatingCandidateInvalidatesApproval,
  createEvaluationProgram,
  setProgramState,
  restoreEvaluationProgram,
  DEFAULT_PRODUCTION_PARAMETERS,
  bindEngine05ToLive,
  parseEngine05Command,
  separateByKind,
  sampleIsAnecdote,
  significanceClaimAllowed,
  isProvenExperience,
  selectTool,
  bindClaimEvidence,
  invokeEngine03ForProduction,
} from '@/lib/council/engines'
import { createSimulatedSessionState, simulateSelectSession } from '@/lib/council/commander-chat/sessionSwitchHydration'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const HYP = {
  proposed_change: 'Increase preference for independent primary evidence',
  why_might_help: 'Verification quality may rise when independent primaries are preferred',
  metric_should_improve: ['verification_quality' as const],
  must_not_regress: ['authority_compliance' as const, 'evidence_quality' as const],
  falsifier: 'If verification quality falls or authority violations appear, reject the candidate',
}

export async function runCouncilEngine05Validation(): Promise<CaseResult[]> {
  const store04 = mkdtempSync(path.join(tmpdir(), 'engine04-e05-'))
  const store05 = mkdtempSync(path.join(tmpdir(), 'engine05-'))
  process.env.WAR_ROOM_ENGINE04_STORE = store04
  process.env.WAR_ROOM_ENGINE05_STORE = store05
  const results: CaseResult[] = []

  results.push(check(
    'ENGINE05-MAP',
    ENGINE_05_CAPABILITY_MAP.length >= 20 && ENGINE_05_CAPABILITY_MAP.every(row => ['EXISTS', 'PARTIAL', 'MISSING', 'SHOULD_EXTRACT', 'SHOULD_EXTEND', 'DO_NOT_DUPLICATE'].includes(row.status)),
    `${ENGINE_05_CAPABILITY_MAP.length} rows`,
  ))

  const bench = await runCapabilityBenchmark({
    mission_id: 'b1',
    candidate_policy_id: 'cand-a',
    candidate_params: DEFAULT_PRODUCTION_PARAMETERS,
    baseline_params: DEFAULT_PRODUCTION_PARAMETERS,
    partition: 'development',
  })
  results.push(check('ENGINE05-01', bench.version === ENGINE_05_VERSION && Boolean(bench.binding.suite_hash && bench.binding.policy_hash && bench.binding.result_hash), bench.run_id))

  const kinds = separateByKind(bench.cases.flatMap(c => c.metrics))
  results.push(check('ENGINE05-02', kinds.MEASURED.length > 0 && kinds.ESTIMATED.every(m => m.kind !== 'MEASURED') && kinds.MEASURED.every(m => m.kind === 'MEASURED'), `measured=${kinds.MEASURED.length}`))

  const candidate = createPolicyCandidate({
    policy_id: 'pol-a',
    policy_family: 'tool_selection',
    version: '1',
    source: 'commander-eval',
    hypothesis: HYP,
    changed_parameters: DEFAULT_PRODUCTION_PARAMETERS,
  })
  const evalOk = await evaluatePolicy({ mission_id: 'e1', candidate, baseline_params: DEFAULT_PRODUCTION_PARAMETERS })
  results.push(check('ENGINE05-03', evalOk.auto_promoted === false && evalOk.candidate.status !== 'PROMOTED' && evalOk.grants_authority === false, evalOk.candidate.status))

  results.push(check('ENGINE05-04', requireHypothesis(HYP).ok && Boolean(candidate.hypothesis.falsifier), candidate.hypothesis.falsifier))

  const badAuth = await evaluatePolicy({
    mission_id: 'e-auth',
    candidate: {
      ...candidate,
      policy_id: 'pol-auth',
      changed_parameters: DEFAULT_PRODUCTION_PARAMETERS,
    },
    baseline_params: DEFAULT_PRODUCTION_PARAMETERS,
  })
  results.push(check('ENGINE05-05', badAuth.authority_regression === false ? recommendPromotion({ ...badAuth, authority_regression: true }) === 'DO_NOT_PROMOTE' : recommendPromotion(badAuth) !== 'PROMOTE' || !badAuth.authority_regression, String(badAuth.authority_regression)))

  results.push(check('ENGINE05-06', recommendPromotion({ ...evalOk, truth_regression: true }) === 'DO_NOT_PROMOTE', 'truth guard'))

  const shadow = runShadowEvaluation({
    production: DEFAULT_PRODUCTION_PARAMETERS,
    candidate: { ...DEFAULT_PRODUCTION_PARAMETERS, context_token_budget: 256 },
    production_policy_id: 'production-engine-04',
    candidate_policy_id: 'pol-a',
  })
  results.push(check('ENGINE05-07', shadow.grants_authority === false && shadow.production_controls_execution === true && shadow.compared.expected_work.candidate.includes('shadow_score_only'), shadow.compared.expected_work.candidate.join(',')))

  const routed = routeModelProvider({
    mission_id: 'r1',
    task_class: 'planning',
    role: 'PULSAR',
    privacy: 'INTERNAL',
    localAvailable: true,
    cloudAvailable: true,
    persist: false,
  })
  results.push(check('ENGINE05-08', routed.role === 'PULSAR' && routed.role_is_provider === false && routed.selected_provider !== 'PULSAR', `${routed.role}=>${routed.selected_provider}`))

  const struct = routeModelProvider({ mission_id: 'r2', task_class: 'structured_output', role: 'ORION', privacy: 'INTERNAL', localAvailable: true, cloudAvailable: true, persist: false })
  const research = routeModelProvider({ mission_id: 'r3', task_class: 'research_discovery', role: 'PULSAR', privacy: 'INTERNAL', localAvailable: true, cloudAvailable: true, persist: false })
  const code = routeModelProvider({ mission_id: 'r4', task_class: 'code_reasoning', role: 'ORION', privacy: 'INTERNAL', localAvailable: true, cloudAvailable: true, persist: false })
  results.push(check('ENGINE05-09', struct.task_class !== research.task_class && (struct.selected_model !== research.selected_model || struct.reason_codes.join() !== research.reason_codes.join()) && code.universal_best_model === false, `${struct.selected_model}|${research.selected_model}|${code.selected_model}`))

  const privateRoute = routeModelProvider({ mission_id: 'r5', task_class: 'research_discovery', role: 'PULSAR', privacy: 'LOCAL', localAvailable: true, cloudAvailable: true, persist: false })
  results.push(check('ENGINE05-10', privateRoute.privacy_class !== 'CLOUD' && privateRoute.selected_provider !== 'frontier', `${privateRoute.selected_provider}:${privateRoute.privacy_class}`))

  const down = routeModelProvider({ mission_id: 'r6', task_class: 'research_discovery', role: 'PULSAR', privacy: 'INTERNAL', localAvailable: false, cloudAvailable: false, persist: false })
  results.push(check('ENGINE05-11', down.selected_provider === 'deterministic' || down.blocked === 'MODEL_BLOCKED', `${down.selected_provider}:${down.blocked}`))

  const histRoute = routeModelProvider({
    mission_id: 'r7',
    task_class: 'structured_output',
    role: 'ORION',
    privacy: 'INTERNAL',
    localAvailable: true,
    cloudAvailable: true,
    persist: false,
    historical: [{
      task_class: 'structured_output',
      provider_id: 'ollama',
      model_id: knownProviderRecords({ localAvailable: true })[0]?.model_id ?? 'x',
      success: { name: 'task_success', value: true, kind: 'MEASURED' },
      quality: { name: 'evidence_quality', value: 'SUFFICIENT', kind: 'MEASURED' },
      latency: { name: 'latency_ms', value: 10, kind: 'MEASURED' },
      tokens: { name: 'token_cost', value: null, kind: 'UNMEASURED' },
      tool_use: { name: 'tool_call_count', value: 0, kind: 'MEASURED' },
      failure_rate: { name: 'failure_rate', value: 0, kind: 'MEASURED' },
      last_evaluated_at: new Date().toISOString(),
      universal_best: false,
    }],
  })
  results.push(check('ENGINE05-12', histRoute.reason_codes.includes('historical_task_class_measured') || histRoute.reason_codes.includes('structured_extraction_local_preferred_when_reliable'), histRoute.reason_codes.join(',')))

  results.push(check('ENGINE05-13', staleBenchmark(bench, 'other-model-v9', new Date().toISOString()) === true, bench.binding.model_provider))

  results.push(check('ENGINE05-14', struct.universal_best_model === false && research.universal_best_model === false && inferTaskClass('extract json schema') === 'structured_output', inferTaskClass('extract json schema')))

  const cf = await evaluateCounterfactual({
    mission_id: 'cf1',
    actual_policy: 'production-engine-04',
    alternate_policy: 'pol-a',
    kind: 'TOOL',
  })
  results.push(check('ENGINE05-15', cf.historical_fact === false && cf.ebc_evidence === false && cf.isolated_from_production_ebc === true, cf.schema))
  results.push(check('ENGINE05-16', cf.replay_level === 'DETERMINISTIC_SIMULATION' && replayLevelFor('PROVIDER', false, false) === 'MODEL_ESTIMATE', cf.replay_level))

  const cfPar = await evaluateCounterfactual({ mission_id: 'cf2', actual_policy: 'serial', alternate_policy: 'parallel', kind: 'PARALLEL', exact: true })
  results.push(check('ENGINE05-17', cfPar.uncertainty === 'MEASURED' && typeof cfPar.actual_outcome.sequential_ms === 'number' && typeof cfPar.counterfactual_outcome.parallel_ms === 'number', JSON.stringify(cfPar.comparison)))

  const cfCtx = await evaluateCounterfactual({ mission_id: 'cf3', actual_policy: 'full', alternate_policy: 'tight', kind: 'CONTEXT' })
  results.push(check('ENGINE05-18', cfCtx.counterfactual_outcome.truth === true, String(cfCtx.comparison)))

  results.push(check('ENGINE05-19', cf.actual_outcome.execution === 'actual' && cf.counterfactual_outcome.execution === 'counterfactual_not_applied', String(cf.actual_outcome.tool)))

  const cfProv = await evaluateCounterfactual({ mission_id: 'cf4', actual_policy: 'local', alternate_policy: 'cloud', kind: 'PROVIDER' })
  results.push(check('ENGINE05-20', cfProv.isolated_from_production_ebc === true && cfProv.counterfactual_outcome.ebc_write === false, String(cfProv.actual_outcome.provider)))

  const promo = await buildPromotionReceipt({ mission_id: 'p1', evalResult: evalOk })
  results.push(check('ENGINE05-21', promo.evaluations.length > 0 && promo.auto_promoted === false, promo.recommendation))

  const fp = fingerprintPolicy(candidate.policy_id, candidate.version, candidate.changed_parameters)
  const approved = await applyCommanderApproval({ candidate, presented_fingerprint: fp, receipt: promo })
  results.push(check('ENGINE05-22', approved.ok === (promo.recommendation === 'PROMOTE') || (!approved.ok && promo.recommendation !== 'PROMOTE'), `${approved.ok}:${approved.reason}:${promo.recommendation}`))

  const mismatch = await applyCommanderApproval({ candidate, presented_fingerprint: 'deadbeef', receipt: promo })
  results.push(check('ENGINE05-23', mismatch.ok === false && mismatch.reason === 'approval_fingerprint_mismatch' && mutatingCandidateInvalidatesApproval(candidate, { ...candidate.changed_parameters, max_parallel: 9 }), mismatch.reason))

  if (promo.recommendation === 'PROMOTE' && approved.ok) {
    const promoted = await promoteApproved({ candidate: approved.candidate, fingerprint: fp, receipt: approved.receipt })
    const rolled = await rollbackPolicy({ promoted: promoted.candidate, receipt: promoted.receipt })
    results.push(check('ENGINE05-24', rolled.history_retained === true && rolled.candidate.status === 'RETIRED' && Boolean(promoted.candidate.rollback_target), rolled.candidate.status))
  } else {
    results.push(check('ENGINE05-24', Boolean(promo.rollback_policy) && promo.commander_decision === 'PENDING', promo.rollback_policy))
  }

  results.push(check('ENGINE05-25', heldOutIsolated(evalOk) === true, `dev=${evalOk.development?.cases.length} hold=${evalOk.held_out?.cases.length}`))

  const leaky = createPolicyCandidate({
    policy_id: 'pol-overfit',
    policy_family: 'provider_routing',
    version: '1',
    source: 'eval',
    hypothesis: HYP,
    changed_parameters: { ...DEFAULT_PRODUCTION_PARAMETERS, privacy: 'CLOUD_OK' },
  })
  const overfitEval = await evaluatePolicy({ mission_id: 'e-over', candidate: leaky, baseline_params: { ...DEFAULT_PRODUCTION_PARAMETERS, privacy: 'LOCAL' } })
  results.push(check('ENGINE05-26', overfitEval.overfit === true || overfitEval.result === 'REJECTED' || mayReachCommanderReview(overfitEval) === false, `overfit=${overfitEval.overfit} result=${overfitEval.result}`))

  results.push(check('ENGINE05-27', evalOk.sample_count >= 3 && !sampleIsAnecdote(evalOk.sample_count, false), String(evalOk.sample_count)))
  results.push(check('ENGINE05-28', significanceClaimAllowed(evalOk.sample_count) === false && evalOk.limitations.includes('no_fake_significance'), 'no p-values'))

  results.push(check('ENGINE05-29', isProvenExperience({ completion_state: 'COMPLETE', evaluation: ['verified'], hidden_cot: false }) === true && isProvenExperience({ completion_state: 'COMPLETE', evaluation: ['counterfactual guess'], hidden_cot: false }) === false, 'speculative excluded'))

  const program = await createEvaluationProgram({ program_id: 'prog-1', kind: 'BENCHMARK', suite_id: 'engine05-core' })
  const paused = await setProgramState(program, 'PAUSED')
  const restored = await restoreEvaluationProgram('prog-1')
  results.push(check('ENGINE05-30', paused.state === 'PAUSED' && restored?.state === 'PAUSED' && restored.mission_id.startsWith('eval-'), restored?.state ?? 'missing'))

  results.push(check('ENGINE05-31', typeof invokeEngine03ForProduction === 'function', 'engine-03p export'))
  const tool = selectTool({ mission_id: 't', objective: 'health', remaining_evidence_gap: ['runtime health of 3847'], available_tools: ['system.health', 'research.web'] })
  results.push(check('ENGINE05-32', tool.selected_tool === 'system.health' || tool.decision === 'SELECT', `${tool.selected_tool}:${tool.decision}`))
  const bind = bindClaimEvidence({
    mission_id: 'e-bind',
    mission_class: 'SYSTEM_STATUS',
    claims: [],
    evidence: [],
  })
  results.push(check('ENGINE05-33', bind.graph.ebc_canonical === true && ENGINE_01_VERSION === 'council-engine-01.v1', ENGINE_01_VERSION))
  const pub = bindEngine05ToLive({ mission_id: 'live-e05', commanderMessage: 'inspect health' })
  results.push(check('ENGINE05-34', pub.engines05.ebc_canonical === true && pub.engines05.grants_authority === false, pub.engines05.schema))
  results.push(check('ENGINE05-35', parseEngine05Command('promote this policy') === 'promote' && pub.engines05.auto_promotes === false && ENGINE_02_VERSION === 'council-engine-02.v1' && ENGINE_03_VERSION === 'council-engine-03.v1' && ENGINE_04_VERSION === 'council-engine-04.v1', 'commander gate'))

  const session = createSimulatedSessionState()
  const switched = simulateSelectSession(session, 's2', [])
  results.push(check('ENGINE05-HYDRATION', Boolean(switched) && ENGINE_05_VERSION === 'council-engine-05.v1', ENGINE_05_VERSION))

  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runCouncilEngine05Validation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`COUNCIL_ENGINE_05 ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
