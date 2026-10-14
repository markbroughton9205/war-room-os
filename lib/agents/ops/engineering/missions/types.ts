import type { WorkflowResult } from '../workflow'

/**
 * An engineering mission is the operator-facing record of ONE real engineering run (plan -> authorized workspace -> local models -> tests -> verifier -> integration -> receipt).
 * The assignment log (agent-foundry.jsonl) stays the source of truth for assignment state and checkpoints; the mission record adds what that log does not carry:
 * who is working RIGHT NOW (lease), every attempt and recovery, the authorized workspace, provenance and the change receipt.
 */
export type MissionState = 'QUEUED' | 'RUNNING' | 'VERIFYING' | 'APPLYING' | 'INSTALLING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'INTERRUPTED'
export const ACTIVE_STATES: MissionState[] = ['QUEUED', 'RUNNING', 'VERIFYING', 'APPLYING', 'INSTALLING']
export const TERMINAL_STATES: MissionState[] = ['COMPLETED', 'FAILED', 'CANCELLED']

/** Who holds the mission right now. Written by the live worker only; a lease nobody renews is a dead run. */
export type Lease = {
  workerId: string
  pid: number
  /** process start time (/proc/<pid>/stat field 22) so a recycled pid is not mistaken for the worker */
  pidStart: string | 'UNKNOWN'
  bootId: string
  startedAt: string
  heartbeatAt: string
  /** last time the engine made observable progress (an event, a model delivery, a file write) */
  progressAt: string
  progressNote: string
}

export type SourceSpec = { repo: string; paths: string[] }
/** write: path prefixes (relative to the source repo) where created/changed files may be applied back; anything else is refused at integration. */
export type ScopeSpec = { source?: SourceSpec; write: string[] }

export type Attempt = {
  n: number
  kind: 'START' | 'RESUME'
  workerId: string
  pid: number
  startedAt: string
  endedAt?: string
  endState?: MissionState
  endReason?: string
  /** a RESUME attempt is the recovery worker: it continues from the checkpoint of the attempt that died */
  recoveredFrom?: { attempt: number; checkpointSeq: number | 'NONE'; filesPreserved: number }
}
export type RecoveryRecord = { at: string; detectedBy: string; reason: string; fromState: MissionState; attempt: number; checkpointSeq: number | 'NONE'; resumable: boolean; resumableWhy: string; filesPreserved: string[] }

export type WriteAuthor = { author: string; role: ProvenanceRole; deterministic: boolean }
export type ProvenanceRole = 'implementation_model' | 'test_writer' | 'test_reviewer' | 'test_candidate' | 'escalation_model' | 'fast_repair' | 'retrieval_helper' | 'research_helper' | 'deterministic_tool' | 'recovery_worker' | 'unknown'
export type FileProvenance = { path: string; author: string; role: ProvenanceRole; deterministic: boolean; autofixed: boolean; attempt: number; recovered: boolean; stepId: string; afterHash: string; at: string }

export type FileReceiptEntry = { path: string; sha256: string; bytes: number; author: string; role: ProvenanceRole }
export type ChangeReceipt = {
  missionId: string
  generatedAt: string
  attempts: number
  filesCreated: FileReceiptEntry[]
  filesModified: (FileReceiptEntry & { beforeSha256: string })[]
  filesDeleted: { path: string; beforeSha256: string }[]
  testsAdded: string[]
  testsChanged: string[]
  deterministicRepairs: { kind: string; file: string; note: string }[]
  modelGeneratedEdits: { path: string; author: string; role: ProvenanceRole }[]
  verifier: { label: string; exitCode: number | 'NOT_RUN'; summary: string; at: string }
  integration: { state: 'NOT_RUN' | 'REFUSED' | 'GATES_FAILED' | 'APPLIED'; branch?: string; commit?: string; tree?: string; gates: { name: string; exitCode: number | 'NOT_RUN'; summary: string; detail?: string }[]; refused: string[] }
  install: { state: 'NOT_REQUESTED' | 'NOT_RUN' | 'FAILED' | 'INSTALLED'; path?: string; stamp?: string; detail?: string }
  provenance: { roles: Record<string, { model: string; calls: number }[]>; files: FileProvenance[]; recoveryWorkers: { attempt: number; workerId: string }[] }
  treeSha256: string
  receiptSha256: string
}

export type MissionRecord = {
  schema: 1
  id: string
  title: string
  request: string
  acceptance: string[]
  hints: string[]
  /** files the Commander named for the feature; when present they are the plan's file list */
  targets: { path: string; action: 'create' | 'modify' }[]
  scope: ScopeSpec
  install: boolean
  createdAt: string
  createdBy: string
  state: MissionState
  stateReason: string
  stateAt: string
  workspace: { root: string; seeded: string[]; seedTreeSha256: string; baseCommit?: string }
  assignmentId: string
  agentId: string
  lease: Lease | null
  attempts: Attempt[]
  recoveries: RecoveryRecord[]
  /** the engine configuration in force (models and gates); recorded at start so provenance never depends on later config */
  config: { builder: string; testReviewer: string | null; testCandidates: string[]; escalation: string | null; flags: Record<string, boolean> }
  progress: { stepsDone: number; stepsTotal: number; modelCalls: number; repairs: number; filesChanged: string[]; lastEvent: string }
  result: { status: WorkflowResult['status']; reason: string; completionClass?: string; verifierExit: number | 'NOT_RUN' } | null
  receipt: ChangeReceipt | null
  cancelRequestedAt?: string
}

export type MissionEvent = { at: string; kind: string; detail: string; attempt: number }
