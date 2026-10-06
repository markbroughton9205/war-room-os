/**
 * ENGINE-03-CAPABILITY-MAP
 * Live dispatch of ENGINE-02 decisions. Do not duplicate ToolValueEstimate, ATLAS, or EBC.
 */
import type { CapabilityRow } from './capabilityMap'

export const ENGINE_03_CAPABILITY_MAP: readonly CapabilityRow[] = [
  { capability: 'CouncilExecutive orchestration', status: 'EXISTS', source: 'executive.runCouncilExecutive — remains orchestrator' },
  { capability: 'ATLAS planning role', status: 'EXISTS', source: 'atlas.planWithAtlas' },
  { capability: 'ToolSelectionEngine decisions', status: 'EXISTS', source: 'ENGINE-02A selectTool — decides, does not execute' },
  { capability: 'HierarchicalPlanningEngine', status: 'EXISTS', source: 'ENGINE-02B' },
  { capability: 'ContextCompilerEngine', status: 'EXISTS', source: 'ENGINE-02C' },
  { capability: 'FailureDiagnosisEngine', status: 'EXISTS', source: 'ENGINE-02D' },
  { capability: 'CapabilityRegistry lookup', status: 'EXISTS', source: 'capabilityRegistry.lookupCapability' },
  { capability: 'Tool Governor authority gate', status: 'EXISTS', source: 'toolGovernor.governStep' },
  { capability: 'GI authority matrix', status: 'EXISTS', source: 'gi/authorityMatrix' },
  { capability: 'task graph READY/parallel groups', status: 'EXISTS', source: 'taskGraph.taskGraphFromAtlas' },
  { capability: 'scheduleWaves + mapPool', status: 'EXISTS', source: 'adaptiveIntelligence.scheduleWaves / mapPool' },
  { capability: 'max_local_model = 1', status: 'EXISTS', source: 'concurrencyPolicy' },
  { capability: 'PULSAR broker.fetch path', status: 'EXISTS', source: 'evidence-board/tools broker.fetch' },
  { capability: 'ORION telemetry tools', status: 'EXISTS', source: 'wr.ports.list / system.health' },
  { capability: 'work products', status: 'EXISTS', source: 'workProduct.workProductsFromLayers' },
  { capability: 'execution receipts', status: 'EXISTS', source: 'intelligence/receipts.createReceipt' },
  { capability: 'completion evaluator', status: 'EXISTS', source: 'completion.evaluateCompletion' },
  { capability: 'replan path', status: 'EXISTS', source: 'replan.maybeReplan + ENGINE-02B LOCAL_REPLAN' },
  { capability: 'mission budgets', status: 'EXISTS', source: 'budget.initBudget' },
  { capability: 'decision overlay actually dispatches', status: 'EXISTS', source: 'ENGINE-03A LiveExecutionEngine.runLiveExecution' },
  { capability: 'registry-driven dispatch layer', status: 'EXISTS', source: 'ENGINE-03B WarRoomDispatchEngine.dispatchCapability' },
  { capability: 'real overlapping wave executor', status: 'EXISTS', source: 'ENGINE-03C executeParallelWave + measureParallelOverlap' },
  { capability: 'execution governor (calls/retries/time/local)', status: 'EXISTS', source: 'ENGINE-03D createGovernor / recordDispatch' },
  { capability: 'NO_TOOL_REQUIRED suppresses dispatch', status: 'EXISTS', source: 'mission-level ToolSelectionDecision binds to zero dispatches' },
  { capability: 'WAITING_AUTHORITY live gate', status: 'EXISTS', source: 'classifyAuthorityGate — no self-upgrade' },
  { capability: 'receipt ≠ EBC evidence', status: 'EXISTS', source: 'evidenceFromDispatch binds work products; receipt_ids stay off the board' },
] as const
