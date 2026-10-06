/**
 * ENGINE-04-CAPABILITY-MAP
 * Long-horizon mission + checkpoint/resume + memory retrieval + temporal world-state.
 * Audit/extract/extend. Do not duplicate EBC, MissionExperienceRecord, memory gate, or temporal.ts.
 */
export type Engine04CapabilityStatus =
  | 'EXISTS'
  | 'PARTIAL'
  | 'MISSING'
  | 'SHOULD_EXTRACT'
  | 'SHOULD_EXTEND'
  | 'DO_NOT_DUPLICATE'

export type Engine04CapabilityRow = {
  capability: string
  status: Engine04CapabilityStatus
  source: string
}

export const ENGINE_04_CAPABILITY_MAP: readonly Engine04CapabilityRow[] = [
  { capability: 'CouncilExecutive', status: 'DO_NOT_DUPLICATE', source: 'intelligence/executive.runCouncilExecutive' },
  { capability: 'ATLAS', status: 'DO_NOT_DUPLICATE', source: 'intelligence/atlas.planWithAtlas' },
  { capability: 'EBC canonical truth spine', status: 'DO_NOT_DUPLICATE', source: 'evidence-board remains SoT' },
  { capability: 'Engine-01 research/source/binding/calibration', status: 'EXISTS', source: 'council-engine-01.v1' },
  { capability: 'Engine-02 tool/plan/context/diagnosis', status: 'EXISTS', source: 'council-engine-02.v1' },
  { capability: 'Engine-03 live execution/dispatch/waves/governor', status: 'EXISTS', source: 'council-engine-03.v1' },
  { capability: 'Engine-03P production invocation', status: 'EXISTS', source: 'invokeEngine03ForProduction' },
  { capability: 'MissionExperienceRecord', status: 'DO_NOT_DUPLICATE', source: 'adaptiveIntelligence.experienceFromMission' },
  { capability: 'Mission experience persistence', status: 'SHOULD_EXTRACT', source: 'adaptiveStore persistExperience/listExperience' },
  { capability: 'mission replay (read-only)', status: 'EXISTS', source: 'orchestrationStore persistLiveMission executable=false' },
  { capability: 'task graph', status: 'EXISTS', source: 'taskGraph.taskGraphFromAtlas' },
  { capability: 'QuestionGraph', status: 'SHOULD_EXTEND', source: 'orchestrationTypes.QuestionGraph — persist across checkpoint' },
  { capability: 'HypothesisStore', status: 'SHOULD_EXTEND', source: 'hypothesis.generateHypotheses in-memory; persist on mission' },
  { capability: 'EBC board + public snapshot', status: 'DO_NOT_DUPLICATE', source: 'evidence-board/board + snapshot' },
  { capability: 'execution/wave/context receipts', status: 'EXISTS', source: 'engines/receipts + live-execution receipts' },
  { capability: 'completion records', status: 'EXISTS', source: 'completion.evaluateCompletion' },
  { capability: 'authority waits', status: 'EXISTS', source: 'execution-governor classifyAuthorityGate WAITING_AUTHORITY' },
  { capability: 'session ledger / hydration', status: 'EXISTS', source: 'commander-chat/sessionSwitchHydration' },
  { capability: 'conversation persistence', status: 'EXISTS', source: 'session-intelligence/persist + message persistence' },
  { capability: 'knowledge graph', status: 'SHOULD_EXTEND', source: 'knowledgeGraph + SUPERSEDES edge already exists' },
  { capability: 'memory gate (write policy)', status: 'DO_NOT_DUPLICATE', source: 'memoryGate.gateMissionMemory — retrieval-first wrap' },
  { capability: 'memory-write-gate Commander approval', status: 'EXISTS', source: 'memory-write-gate/* no uncontrolled writes' },
  { capability: 'temporal truth CURRENT/HISTORICAL/SUPERSEDED/STALE', status: 'SHOULD_EXTRACT', source: 'intelligence/temporal.ts resolveTemporalConflict applySupersession' },
  { capability: 'freshness DATE_UNKNOWN / OUT_OF_WINDOW', status: 'EXISTS', source: 'researchPolicy.assessFreshness' },
  { capability: 'ContextCompilerEngine', status: 'SHOULD_EXTEND', source: 'add labeled memory/temporal facts; never strip truth' },
  { capability: 'ToolSelectionEngine', status: 'SHOULD_EXTEND', source: 'consume current memory + stale freshness gap' },
  { capability: 'FailureDiagnosisEngine', status: 'SHOULD_EXTEND', source: 'checkpoint/resume/stale-memory/temporal taxonomy' },
  { capability: 'LiveExecutionEngine', status: 'DO_NOT_DUPLICATE', source: 'runLiveExecution — skip completed tasks on resume' },
  { capability: 'ExecutionGovernor budgets', status: 'SHOULD_EXTEND', source: 'persist/restore tool/retry/time/local budgets' },
  { capability: 'durable LongHorizonMission contract', status: 'MISSING', source: 'ENGINE-04A' },
  { capability: 'canonical mission identity vs session/conversation/wave/task', status: 'MISSING', source: 'ENGINE-04A' },
  { capability: 'mission persistence store (atomic, versioned)', status: 'MISSING', source: 'ENGINE-04A store next to adaptive/orchestration' },
  { capability: 'pause / resume / cancel / recover', status: 'MISSING', source: 'ENGINE-04A' },
  { capability: 'MissionPhase spanning windows', status: 'PARTIAL', source: 'hierarchical-planning phases DISCOVER/COLLECT/VERIFY/SYNTHESIZE' },
  { capability: 'MissionCheckpoint contract + integrity hash', status: 'MISSING', source: 'ENGINE-04B' },
  { capability: 'checkpoint triggers (wave/authority/pause/complete)', status: 'MISSING', source: 'ENGINE-04B' },
  { capability: 'corrupt checkpoint rejection', status: 'MISSING', source: 'ENGINE-04B' },
  { capability: 'exactly-once / skip completed dispatch', status: 'PARTIAL', source: 'EBC tool cache + need skip_task_ids on resume' },
  { capability: 'authority fingerprint across restart', status: 'MISSING', source: 'ENGINE-04B pending_approval action_fingerprint' },
  { capability: 'budget continuity across restart', status: 'MISSING', source: 'ENGINE-04A persist governor budget' },
  { capability: 'MemoryRetrievalEngine', status: 'MISSING', source: 'ENGINE-04C wraps experience/playbook/gate, does not replace' },
  { capability: 'memory types + contamination protection', status: 'PARTIAL', source: 'memoryGate truth/temporal; retrieval ranking missing' },
  { capability: 'memory budget top-K', status: 'MISSING', source: 'ENGINE-04C' },
  { capability: 'TemporalWorldStateEngine', status: 'MISSING', source: 'ENGINE-04D extracts temporal.ts + freshness' },
  { capability: 'getCurrentState / getStateAt', status: 'MISSING', source: 'ENGINE-04D' },
  { capability: 'supersession vs contradiction', status: 'PARTIAL', source: 'resolveTemporalConflict treats time as rank, not dated query' },
  { capability: 'REFRESH_REQUIRED signal', status: 'MISSING', source: 'ENGINE-04D — does not grant tools' },
  { capability: 'UI reload without restarting mission', status: 'EXISTS', source: 'sessionSwitchHydration startedMission=false' },
  { capability: 'process/runtime restart recovery of in-flight Council mission', status: 'MISSING', source: 'ENGINE-04B live test' },
  { capability: 'Commander pause/resume/cancel commands', status: 'MISSING', source: 'ENGINE-04A parse + state machine' },
  { capability: 'Engine 04 inspector', status: 'MISSING', source: 'CouncilIntelligenceInspector tab' },
] as const
