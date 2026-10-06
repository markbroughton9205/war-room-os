/**
 * ENGINE-05-CAPABILITY-MAP
 * Empirical capability evaluation, policy experimentation, model/provider routing,
 * counterfactual mission evaluation, safe policy promotion.
 * Audit/extract/extend. Do not duplicate PolicyCandidate, playbooks, WRIM staging,
 * counterfactualEval, jobRouter, ToolValueEstimate, MissionExperienceRecord, or EBC.
 */
export type Engine05CapabilityStatus =
  | 'EXISTS'
  | 'PARTIAL'
  | 'MISSING'
  | 'SHOULD_EXTRACT'
  | 'SHOULD_EXTEND'
  | 'DO_NOT_DUPLICATE'

export type Engine05CapabilityRow = {
  capability: string
  status: Engine05CapabilityStatus
  source: string
}

export const ENGINE_05_CAPABILITY_MAP: readonly Engine05CapabilityRow[] = [
  { capability: 'CouncilExecutive', status: 'DO_NOT_DUPLICATE', source: 'intelligence/executive.runCouncilExecutive' },
  { capability: 'ATLAS / PULSAR / ORION / LUMEN / PHOENIX / AURORA / JANUS / SENTINEL', status: 'DO_NOT_DUPLICATE', source: 'roles are functions, not providers' },
  { capability: 'EBC canonical truth spine', status: 'DO_NOT_DUPLICATE', source: 'evidence-board remains SoT' },
  { capability: 'Engine-01 research/source/binding/calibration', status: 'EXISTS', source: 'council-engine-01.v1' },
  { capability: 'Engine-02 tool/plan/context/diagnosis', status: 'EXISTS', source: 'council-engine-02.v1' },
  { capability: 'Engine-03 live execution/dispatch/waves/governor', status: 'EXISTS', source: 'council-engine-03.v1' },
  { capability: 'Engine-03P production invocation', status: 'EXISTS', source: 'invokeEngine03ForProduction' },
  { capability: 'Engine-04 long-horizon/checkpoint/memory/temporal', status: 'EXISTS', source: 'council-engine-04.v1' },
  { capability: 'MissionExperienceRecord (proven observations)', status: 'DO_NOT_DUPLICATE', source: 'adaptiveIntelligence.experienceFromMission — only proven counts' },
  { capability: 'Mission experience persistence', status: 'SHOULD_EXTRACT', source: 'adaptiveStore persistExperience/listExperience' },
  { capability: 'PolicyCandidate (advise-only, applies_automatically=false)', status: 'SHOULD_EXTEND', source: 'adaptiveIntelligence.PolicyCandidate + advisePolicy — add lifecycle/hypothesis/falsifier without replacing' },
  { capability: 'Recovery playbooks', status: 'DO_NOT_DUPLICATE', source: 'screenshotCrashPlaybook / routePlaybook / persistPlaybook' },
  { capability: 'ToolValueEstimate (estimated, not measured)', status: 'DO_NOT_DUPLICATE', source: 'toolValue.estimateToolValue — keep ESTIMATED' },
  { capability: 'Cheap post-mission evaluation', status: 'SHOULD_EXTEND', source: 'intelligence/evaluation.evaluateMission — not a suite runner' },
  { capability: 'Engine receipts / mission receipts / wave receipts', status: 'EXISTS', source: 'engines/receipts + live-execution' },
  { capability: 'Calibration states', status: 'EXISTS', source: 'calibration/engine.calibrateUncertainty' },
  { capability: 'Failure records / clusters', status: 'EXISTS', source: 'failure-diagnosis + clusterFailures' },
  { capability: 'counterfactualEval (COUNTERFACTUAL, historical_fact=false)', status: 'SHOULD_EXTEND', source: 'adaptiveIntelligence.counterfactualEval — add replay levels, keep out of EBC' },
  { capability: 'WRIM eval staging (trains_wrim=false)', status: 'DO_NOT_DUPLICATE', source: 'stageWrimEval + persistStagedEval' },
  { capability: 'jobRouter CognitiveJob routes (role ≠ provider)', status: 'SHOULD_EXTEND', source: 'jobRouter.routeCognitiveJob — empirical/task-class wrap' },
  { capability: 'Role fulfillment (deterministic/local/frontier, wrim_active=false)', status: 'DO_NOT_DUPLICATE', source: 'intelligence/roles.DEFAULT_ROLE_FULFILLMENT' },
  { capability: 'Local model registry (specs not invented; health via probe)', status: 'SHOULD_EXTRACT', source: 'localModelRegistry LOCAL_MODEL_REGISTRY' },
  { capability: 'Capability registry / ToolValue authority', status: 'EXISTS', source: 'capabilityRegistry + tool-selection' },
  { capability: 'Concurrency / serial vs parallel timing', status: 'SHOULD_EXTRACT', source: 'sequentialVsParallelTiming + measureParallelOverlap' },
  { capability: 'Context compiler token budget', status: 'SHOULD_EXTEND', source: 'compileContext — routing must inform budget before compile' },
  { capability: 'Completion metrics', status: 'EXISTS', source: 'completion.evaluateCompletion' },
  { capability: 'Latency / token / tool-call telemetry', status: 'PARTIAL', source: 'OrchestrationTelemetry + ModelHistoryRow — no formal measured/estimated split' },
  { capability: 'Provider/model metadata as capability records', status: 'MISSING', source: 'ENGINE-05C ProviderCapabilityRecord — do not invent specs' },
  { capability: 'Cloud-provider availability as measured health', status: 'PARTIAL', source: 'awareness local_backend_state; cloud availability not a durable record' },
  { capability: 'Measured vs Estimated vs Inferred vs Unmeasured', status: 'MISSING', source: 'ENGINE-05 principles' },
  { capability: 'CapabilityBenchmarkEngine + suites/cases', status: 'MISSING', source: 'ENGINE-05A' },
  { capability: 'Benchmark task classes', status: 'MISSING', source: 'ENGINE-05A task_class enum' },
  { capability: 'Benchmark reproducibility bindings', status: 'MISSING', source: 'ENGINE-05A suite/policy/runtime/model hashes' },
  { capability: 'Baseline comparison (never invented)', status: 'MISSING', source: 'ENGINE-05A BASELINE_UNAVAILABLE' },
  { capability: 'PolicyEvaluationEngine', status: 'MISSING', source: 'ENGINE-05B' },
  { capability: 'EmpiricalPolicyCandidate lifecycle DRAFT…RETIRED', status: 'MISSING', source: 'ENGINE-05B — extend, do not replace PolicyCandidate' },
  { capability: 'Policy hypothesis + falsifier', status: 'MISSING', source: 'ENGINE-05B' },
  { capability: 'Shadow evaluation grants_authority=false', status: 'MISSING', source: 'ENGINE-05B' },
  { capability: 'Comparable A/B evaluation', status: 'MISSING', source: 'ENGINE-05B' },
  { capability: 'Authority/truth/safety regression guards', status: 'MISSING', source: 'ENGINE-05B' },
  { capability: 'ModelProviderRoutingEngine', status: 'MISSING', source: 'ENGINE-05C wraps jobRouter, does not hard-bind callsign' },
  { capability: 'ModelRoutingDecision + receipts', status: 'MISSING', source: 'ENGINE-05C' },
  { capability: 'Privacy/authority hard gates on routing', status: 'PARTIAL', source: 'jobRouter local-first for some jobs; no privacy_class hard gate' },
  { capability: 'Unavailable provider → alternate or MODEL_BLOCKED', status: 'PARTIAL', source: 'jobRouter fallback string; not truthful MODEL_BLOCKED' },
  { capability: 'Task-specific routing (no universal best model)', status: 'PARTIAL', source: 'CognitiveJob routes exist; no empirical matrix' },
  { capability: 'Cost-aware routing as separate signal', status: 'MISSING', source: 'ENGINE-05C cost_class ≠ quality' },
  { capability: 'CounterfactualMissionEngine', status: 'MISSING', source: 'ENGINE-05D extends counterfactualEval' },
  { capability: 'Replay levels EXACT/DETERMINISTIC/SHADOW/MODEL_ESTIMATE/NOT_EVALUABLE', status: 'MISSING', source: 'ENGINE-05D' },
  { capability: 'Counterfactual isolation from EBC', status: 'EXISTS', source: 'counterfactualEval historical_fact=false — must stay' },
  { capability: 'PolicyPromotionEngine (recommendation only)', status: 'MISSING', source: 'ENGINE-05E' },
  { capability: 'Commander approval fingerprint', status: 'SHOULD_EXTRACT', source: 'checkpoint/fingerprint.ts — bind policy_id|version|params' },
  { capability: 'Policy rollback retaining history', status: 'MISSING', source: 'ENGINE-05E' },
  { capability: 'No autonomous promotion', status: 'EXISTS', source: 'PolicyCandidate.applies_automatically=false — keep + engine gate' },
  { capability: 'Held-out suite isolation / overfitting flag', status: 'MISSING', source: 'ENGINE-05 leakage control' },
  { capability: 'Sample size + statistical humility (no fake p-values)', status: 'MISSING', source: 'ENGINE-05' },
  { capability: 'Capability matrix / router fallback matrix', status: 'MISSING', source: 'ENGINE-05C' },
  { capability: 'Evaluation datastore (extend existing persistence)', status: 'MISSING', source: 'council/engine-05 sibling of engine-04/adaptive' },
  { capability: 'Long-horizon evaluation programs', status: 'SHOULD_EXTEND', source: 'Engine-04 mission_type EVALUATION + checkpoint/resume' },
  { capability: 'Engine 05 inspector', status: 'MISSING', source: 'CouncilIntelligenceInspector tab' },
  { capability: 'Commander UX from receipts (why model / would tool / is policy better)', status: 'MISSING', source: 'ENGINE-05 receipts, not CoT' },
] as const
