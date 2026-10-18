/**
 * Recorded worker evidence for capability-aware routing.
 * Rows are observations. They are not a model ranking.
 */
import type { FrkCapability } from './reasoning-kernel/types'
import { ACCEPTED_ENGINEERING_EVIDENCE } from './foundryAcceptedCapabilityEvidence'

export const WORKER_ROUTING_CLASSES = [
  'LOCAL_ROUTINE',
  'LOCAL_PREFERRED',
  'STRONG_REASONING',
  'SPECIALIST',
  'PINNED',
  'SOVEREIGN',
] as const
export type FoundryWorkerRoutingClass = (typeof WORKER_ROUTING_CLASSES)[number]

export const WORKER_TASK_CLASSES = [
  'CLI_TOOL',
  'BUG_FIX',
  'FRONTEND_APP',
  'TEST_REPAIR',
  'BACKEND_API',
  'FULL_STACK_APP',
  'FEATURE_EXTENSION',
  'DATABASE_APP',
  'DESKTOP_APP',
  'LEGACY_CODE_MODIFICATION',
  'REFACTOR',
  'DATA_PROCESSING',
  'LIBRARY_PACKAGE',
  'STATIC_WEB',
] as const
export type FoundryWorkerTaskClass = (typeof WORKER_TASK_CLASSES)[number]

export type FoundryWorkerEvidenceRow = {
  evidenceId: string
  caseId: string | null
  provider: string
  model: string
  local: boolean
  capabilityFamily: FrkCapability
  taskClasses: FoundryWorkerTaskClass[]
  fixtureDifficulty: string
  engineeringPass: boolean
  reasoningPass: boolean
  rootCauseStatus: 'SUPPORTED' | 'PARTIAL' | 'UNSUPPORTED' | 'CONTRADICTED' | 'EXCLUDED'
  calls: number
  replans: number
  contradictions: number
  verificationResult: 'PASS' | 'FAIL'
  productionProven: false
  historicalReliability: 'RELIABLE' | 'FIXTURE' | 'INSUFFICIENT'
  sampleSize: number
}

const ROUTINE_CLASSES: FoundryWorkerTaskClass[] = [...WORKER_TASK_CLASSES]
const routineSample = ACCEPTED_ENGINEERING_EVIDENCE.length

function row(input: FoundryWorkerEvidenceRow): FoundryWorkerEvidenceRow {
  return input
}

const local = { provider: 'ollama', model: 'qwen2.5-coder:14b', local: true }
const remote = { provider: 'cursor-agent', model: 'composer-2.5', local: false }

export const ACCEPTED_WORKER_CAPABILITY_EVIDENCE: FoundryWorkerEvidenceRow[] = [
  row({
    evidenceId: 'qwen-historical-routine',
    caseId: null,
    ...local,
    capabilityFamily: 'PLAN_TO_CODE_FIDELITY',
    taskClasses: ROUTINE_CLASSES,
    fixtureDifficulty: 'R1',
    engineeringPass: true,
    reasoningPass: false,
    rootCauseStatus: 'UNSUPPORTED',
    calls: 0,
    replans: 0,
    contradictions: 0,
    verificationResult: 'PASS',
    productionProven: false,
    historicalReliability: 'RELIABLE',
    sampleSize: routineSample,
  }),
  row({ evidenceId: 'qwen-holds', caseId: 'REASON-M2-HOLDS', ...local, capabilityFamily: 'AMBIGUITY_RESOLUTION', taskClasses: ['BUG_FIX'], fixtureDifficulty: 'R3', engineeringPass: false, reasoningPass: false, rootCauseStatus: 'UNSUPPORTED', calls: 6, replans: 1, contradictions: 0, verificationResult: 'FAIL', productionProven: false, historicalReliability: 'FIXTURE', sampleSize: 1 }),
  row({ evidenceId: 'qwen-invoice', caseId: 'REASON-M2-INVOICE', ...local, capabilityFamily: 'TEST_TRUTH_DISCRIMINATION', taskClasses: ['TEST_REPAIR'], fixtureDifficulty: 'R2', engineeringPass: true, reasoningPass: false, rootCauseStatus: 'PARTIAL', calls: 6, replans: 1, contradictions: 0, verificationResult: 'PASS', productionProven: false, historicalReliability: 'FIXTURE', sampleSize: 1 }),
  row({ evidenceId: 'qwen-parts', caseId: 'REASON-M2-PARTS', ...local, capabilityFamily: 'PERFORMANCE_REASONING', taskClasses: ['BUG_FIX'], fixtureDifficulty: 'R2', engineeringPass: true, reasoningPass: false, rootCauseStatus: 'UNSUPPORTED', calls: 5, replans: 0, contradictions: 0, verificationResult: 'PASS', productionProven: false, historicalReliability: 'FIXTURE', sampleSize: 1 }),
  row({ evidenceId: 'qwen-actor', caseId: 'REASON-M2-ACTOR', ...local, capabilityFamily: 'ROOT_CAUSE_DIAGNOSIS', taskClasses: ['BUG_FIX'], fixtureDifficulty: 'R2', engineeringPass: true, reasoningPass: false, rootCauseStatus: 'UNSUPPORTED', calls: 2, replans: 0, contradictions: 0, verificationResult: 'PASS', productionProven: false, historicalReliability: 'FIXTURE', sampleSize: 1 }),
  row({ evidenceId: 'qwen-events', caseId: 'REASON-M2-EVENTS', ...local, capabilityFamily: 'ROOT_CAUSE_DIAGNOSIS', taskClasses: ['BUG_FIX'], fixtureDifficulty: 'R3', engineeringPass: false, reasoningPass: false, rootCauseStatus: 'UNSUPPORTED', calls: 5, replans: 1, contradictions: 1, verificationResult: 'FAIL', productionProven: false, historicalReliability: 'FIXTURE', sampleSize: 1 }),
  row({ evidenceId: 'qwen-tag', caseId: 'REASON-M2-TAG', ...local, capabilityFamily: 'LEGACY_CONSTRAINT_REASONING', taskClasses: ['LEGACY_CODE_MODIFICATION'], fixtureDifficulty: 'R2', engineeringPass: true, reasoningPass: false, rootCauseStatus: 'CONTRADICTED', calls: 2, replans: 0, contradictions: 1, verificationResult: 'PASS', productionProven: false, historicalReliability: 'FIXTURE', sampleSize: 1 }),
  row({ evidenceId: 'qwen-sku', caseId: 'REASON-M2-SKU', ...local, capabilityFamily: 'CROSS_LAYER_REASONING', taskClasses: ['BUG_FIX'], fixtureDifficulty: 'R2', engineeringPass: true, reasoningPass: false, rootCauseStatus: 'UNSUPPORTED', calls: 2, replans: 0, contradictions: 0, verificationResult: 'PASS', productionProven: false, historicalReliability: 'FIXTURE', sampleSize: 1 }),
  row({ evidenceId: 'qwen-cents', caseId: 'REASON-M2-CENTS', ...local, capabilityFamily: 'CROSS_LAYER_REASONING', taskClasses: ['BUG_FIX'], fixtureDifficulty: 'R3', engineeringPass: false, reasoningPass: false, rootCauseStatus: 'UNSUPPORTED', calls: 6, replans: 0, contradictions: 1, verificationResult: 'FAIL', productionProven: false, historicalReliability: 'FIXTURE', sampleSize: 1 }),
  row({ evidenceId: 'qwen-bin', caseId: 'REASON-M2-BIN', ...local, capabilityFamily: 'ROOT_CAUSE_DIAGNOSIS', taskClasses: ['BUG_FIX'], fixtureDifficulty: 'R3', engineeringPass: true, reasoningPass: false, rootCauseStatus: 'UNSUPPORTED', calls: 3, replans: 0, contradictions: 0, verificationResult: 'PASS', productionProven: false, historicalReliability: 'FIXTURE', sampleSize: 1 }),
  row({ evidenceId: 'composer-holds', caseId: 'REASON-M2-HOLDS', ...remote, capabilityFamily: 'AMBIGUITY_RESOLUTION', taskClasses: ['BUG_FIX'], fixtureDifficulty: 'R3', engineeringPass: true, reasoningPass: true, rootCauseStatus: 'SUPPORTED', calls: 2, replans: 0, contradictions: 0, verificationResult: 'PASS', productionProven: false, historicalReliability: 'FIXTURE', sampleSize: 1 }),
  row({ evidenceId: 'composer-invoice', caseId: 'REASON-M2-INVOICE', ...remote, capabilityFamily: 'TEST_TRUTH_DISCRIMINATION', taskClasses: ['TEST_REPAIR'], fixtureDifficulty: 'R2', engineeringPass: true, reasoningPass: true, rootCauseStatus: 'SUPPORTED', calls: 2, replans: 1, contradictions: 0, verificationResult: 'PASS', productionProven: false, historicalReliability: 'FIXTURE', sampleSize: 1 }),
  row({ evidenceId: 'composer-parts', caseId: 'REASON-M2-PARTS', ...remote, capabilityFamily: 'PERFORMANCE_REASONING', taskClasses: ['BUG_FIX'], fixtureDifficulty: 'R2', engineeringPass: true, reasoningPass: false, rootCauseStatus: 'PARTIAL', calls: 2, replans: 0, contradictions: 0, verificationResult: 'PASS', productionProven: false, historicalReliability: 'FIXTURE', sampleSize: 1 }),
  row({ evidenceId: 'composer-actor', caseId: 'REASON-M2-ACTOR', ...remote, capabilityFamily: 'ROOT_CAUSE_DIAGNOSIS', taskClasses: ['BUG_FIX'], fixtureDifficulty: 'R2', engineeringPass: true, reasoningPass: true, rootCauseStatus: 'SUPPORTED', calls: 2, replans: 0, contradictions: 0, verificationResult: 'PASS', productionProven: false, historicalReliability: 'FIXTURE', sampleSize: 1 }),
  row({ evidenceId: 'composer-events', caseId: 'REASON-M2-EVENTS', ...remote, capabilityFamily: 'ROOT_CAUSE_DIAGNOSIS', taskClasses: ['BUG_FIX'], fixtureDifficulty: 'R3', engineeringPass: true, reasoningPass: false, rootCauseStatus: 'PARTIAL', calls: 2, replans: 0, contradictions: 0, verificationResult: 'PASS', productionProven: false, historicalReliability: 'FIXTURE', sampleSize: 1 }),
  row({ evidenceId: 'composer-tag', caseId: 'REASON-M2-TAG', ...remote, capabilityFamily: 'LEGACY_CONSTRAINT_REASONING', taskClasses: ['LEGACY_CODE_MODIFICATION'], fixtureDifficulty: 'R2', engineeringPass: true, reasoningPass: false, rootCauseStatus: 'UNSUPPORTED', calls: 2, replans: 0, contradictions: 0, verificationResult: 'PASS', productionProven: false, historicalReliability: 'FIXTURE', sampleSize: 1 }),
  row({ evidenceId: 'composer-sku', caseId: 'REASON-M2-SKU', ...remote, capabilityFamily: 'CROSS_LAYER_REASONING', taskClasses: ['BUG_FIX'], fixtureDifficulty: 'R2', engineeringPass: true, reasoningPass: true, rootCauseStatus: 'SUPPORTED', calls: 2, replans: 0, contradictions: 0, verificationResult: 'PASS', productionProven: false, historicalReliability: 'FIXTURE', sampleSize: 1 }),
  row({ evidenceId: 'composer-cents', caseId: 'REASON-M2-CENTS', ...remote, capabilityFamily: 'CROSS_LAYER_REASONING', taskClasses: ['BUG_FIX'], fixtureDifficulty: 'R3', engineeringPass: true, reasoningPass: true, rootCauseStatus: 'SUPPORTED', calls: 4, replans: 0, contradictions: 2, verificationResult: 'PASS', productionProven: false, historicalReliability: 'FIXTURE', sampleSize: 1 }),
  row({ evidenceId: 'composer-bin', caseId: 'REASON-M2-BIN', ...remote, capabilityFamily: 'ROOT_CAUSE_DIAGNOSIS', taskClasses: ['BUG_FIX'], fixtureDifficulty: 'R3', engineeringPass: true, reasoningPass: true, rootCauseStatus: 'SUPPORTED', calls: 2, replans: 0, contradictions: 0, verificationResult: 'PASS', productionProven: false, historicalReliability: 'FIXTURE', sampleSize: 1 }),
]
