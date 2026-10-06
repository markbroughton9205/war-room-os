/**
 * ENGINE-02-CAPABILITY-MAP
 * Extract existing ATLAS / toolValue / contextPacket / receipts / adaptive records.
 * Do not duplicate ToolValueEstimate, ATLAS plans, context packets, or runtime receipts.
 */
import type { CapabilityRow } from './capabilityMap'

export const ENGINE_02_CAPABILITY_MAP: readonly CapabilityRow[] = [
  { capability: 'information-gain tool estimates', status: 'SHOULD-EXTRACT-INTO-ENGINE', source: 'intelligence/toolValue.estimateToolValue' },
  { capability: 'high-information probe picker', status: 'EXISTS', source: 'pickHighInformationProbes' },
  { capability: 'capability registry + health index', status: 'EXISTS', source: 'capabilityRegistry.lookupCapability' },
  { capability: 'tool governor / authority gate', status: 'EXISTS', source: 'toolGovernor.governStep' },
  { capability: 'NO_TOOL_REQUIRED decision', status: 'PARTIAL', source: 'ENGINE-01 stop_condition + ENGINE-02A' },
  { capability: 'typed ToolCandidate + economics split', status: 'MISSING', source: 'ENGINE-02A' },
  { capability: 'bounded retry vs deterministic no-retry', status: 'PARTIAL', source: 'gi/failureRecovery; ENGINE-02A formalizes' },
  { capability: 'health-aware dead-path avoidance', status: 'PARTIAL', source: 'capability.health; ENGINE-02A refuses DEAD' },
  { capability: 'ATLAS DAG planning', status: 'EXISTS', source: 'atlas.planWithAtlas — ATLAS remains planning role' },
  { capability: 'task graph + ready/parallel groups', status: 'EXISTS', source: 'taskGraph.taskGraphFromAtlas' },
  { capability: 'hierarchical MISSION/PHASE/TASK/TOOL_ACTION view', status: 'MISSING', source: 'ENGINE-02B wraps Atlas steps' },
  { capability: 'replan with receipt', status: 'EXISTS', source: 'replan.maybeReplan' },
  { capability: 'localized subtree replan', status: 'PARTIAL', source: 'maybeReplan supersedes affected; ENGINE-02B localizes' },
  { capability: 'plan stability / equivalent-plan detect', status: 'MISSING', source: 'ENGINE-02B' },
  { capability: 'completion-aware stop (no busywork)', status: 'PARTIAL', source: 'completion.evaluateCompletion; ENGINE-02B STOP' },
  { capability: 'authority-aware plan nodes', status: 'EXISTS', source: 'Atlas BLOCKED_BY_AUTHORITY; capability ≠ authority' },
  { capability: 'max_local_model = 1', status: 'EXISTS', source: 'adaptiveIntelligence.concurrencyPolicy' },
  { capability: 'measured parallel overlap', status: 'PARTIAL', source: 'task started_at/completed_at; ENGINE-02B measures' },
  { capability: 'per-agent context packets', status: 'SHOULD-EXTRACT-INTO-ENGINE', source: 'contextPacket.buildContextPackets' },
  { capability: 'context compression + provenance preserved', status: 'EXISTS', source: 'compressContext.provenance_preserved' },
  { capability: 'token budget compiler', status: 'PARTIAL', source: 'budget.context_chars; ENGINE-02C token_budget' },
  { capability: 'no truth upgrade in summaries', status: 'EXISTS', source: 'blackboardNeverUpgradesInference' },
  { capability: 'role-specific context', status: 'PARTIAL', source: 'packetsDiffer; ENGINE-02C explicit roles' },
  { capability: 'cross-mission contamination guard', status: 'MISSING', source: 'ENGINE-02C' },
  { capability: 'execution receipts', status: 'EXISTS', source: 'receipts.createReceipt' },
  { capability: 'GI tool-failure recovery prose', status: 'EXISTS', source: 'failureRecovery.recoverFromToolFailure' },
  { capability: 'typed causal failure taxonomy + cause graph', status: 'MISSING', source: 'ENGINE-02D' },
  { capability: 'discriminating next test', status: 'PARTIAL', source: 'hypothesis.falsify + ENGINE-02D NEXT_BEST_TEST' },
  { capability: 'MissionExperienceRecord', status: 'EXISTS', source: 'adaptiveIntelligence.experienceFromMission' },
  { capability: 'proven vs speculative failure memory', status: 'PARTIAL', source: 'ENGINE-02D confidence_class PROVEN vs HYPOTHESIS' },
  { capability: 'CouncilExecutive orchestration', status: 'EXISTS', source: 'executive.runCouncilExecutive — consume engines, do not replace' },
] as const
