/** Shared shapes of the autonomous controller. A command is the Commander's sentence; everything else is derived from it and recorded. */
export type CommandOrigin =
  | { kind: 'foundry-ui' }
  | { kind: 'council'; conversationId: string; proposalId?: string; ownerId?: string }
  | { kind: 'api' }

export type Subtask = {
  n: number
  title: string
  request: string
  acceptance: string[]
  targets: { path: string; action: 'create' | 'modify' }[]
  scope: { paths: string[]; write: string[] }
  hints: string[]
  /** which independent verifier script (verify-<key>.mjs) belongs to this subtask; absent = the generic verifier */
  verifyKey?: number
  /** the Reverse Engineer pass is run first only when the area is unfamiliar or the change is high-impact */
  reverseFirst: boolean
}

/** One scripted interaction of the UI proof. Pointer steps are real input events (CDP Input.dispatchMouseEvent), never synthetic DOM calls. */
export type UiProofStep =
  | { do: 'goto'; path: string }
  | { do: 'inject-fixture' }
  | { do: 'expect'; selector: string; present: boolean; label: string }
  | { do: 'move'; x: number; y: number }
  | { do: 'expect-follows'; selector: string; x: number; y: number; tolerance: number; label: string }
  | { do: 'click-xy'; x: number; y: number }
  | { do: 'expect-count'; selector: string; min: number; max?: number; label: string; waitMs?: number }
  | { do: 'wait'; ms: number }
  | { do: 'click-selector'; selector: string; label: string }
  | { do: 'fixture-click-works' }
  | { do: 'fixture-drag-selects' }
  | { do: 'fixture-drag-moves' }
  | { do: 'expect-native-cursor'; hidden: boolean; label: string }
  | { do: 'reload-keeps'; selector: string; present: boolean; label: string }
  | { do: 'screenshot'; name: string }

export type UiProofSpec = { kind: 'cursor-skin' | 'generic'; steps: UiProofStep[] }

export type Interpretation = {
  commandText: string
  title: string
  kind: 'ui-global' | 'ui-component' | 'logic' | 'bugfix'
  complexity: 'simple' | 'moderate' | 'complex'
  subtasks: Subtask[]
  discovery: { keywords: string[]; matches: { path: string; score: number; why: string; anchored?: boolean }[]; mountPoint?: string }
  uiProof: UiProofSpec | null
  /** whether the change needs a versioned installation to be real (application code) */
  needsInstall: boolean
  interpretedBy: 'deterministic' | 'model+deterministic'
  notes: string[]
}

export type TimelineEntry = { at: string; kind: string; detail: string }

export type FailureClass = 'INFRA' | 'VERIFIER' | 'TESTS' | 'GATE' | 'INTEGRATION' | 'INSTALL' | 'ENGINE' | 'UNKNOWN'
export type Diagnosis = { cls: FailureClass; summary: string; detail: string; fingerprint: string; retriable: boolean }
export type Rung = 'initial' | 'diagnosed' | 'reverse-context' | 'split'

export type StepState = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'BLOCKED'
export type CommandStep = {
  n: number
  title: string
  subtask: Subtask
  /** the missions that tried this step, in order; the last is current */
  missions: { id: string; strategy: string; startedAt: string; endState?: string; fingerprint?: string }[]
  state: StepState
  autoResumes: number
  /** the strategy the NEXT attempt at this step will use (set after a failure, cleared when that attempt starts) */
  pendingRung?: Rung
  /** do not start the next attempt before this time (back-off after a machine/model problem) */
  retryNotBefore?: string
  /** a commit this step's mission integrated (the next step is seeded from it) */
  integratedCommit?: string
  integratedBranch?: string
}

export type CommandState = 'INTERPRETING' | 'AWAITING_AUTHORITY' | 'QUEUED' | 'WAITING_RESOURCES' | 'RUNNING' | 'PAUSED' | 'PROVING' | 'DELIVERED' | 'BLOCKED' | 'FAILED' | 'CANCELLED' | 'STOPPED'
export const TERMINAL_COMMAND_STATES: CommandState[] = ['DELIVERED', 'BLOCKED', 'FAILED', 'CANCELLED']

/** The delivery ladder. Each rung is claimed only on its own evidence; a later rung never implies an earlier one is skipped. */
export type DeliveryLadder = {
  codeGenerated: boolean
  testsPassed: boolean
  verificationPassed: boolean
  buildCreated: boolean
  installed: boolean
  running: boolean
  uiProof: 'NOT_APPLICABLE' | 'PENDING' | 'PASSED' | 'FAILED' | 'UNAVAILABLE'
  promoted: boolean
}

export type CommandRecord = {
  schema: 1
  id: string
  text: string
  origin: CommandOrigin
  createdAt: string
  createdBy: string
  state: CommandState
  stateReason: string
  stateAt: string
  interpretation: Omit<Interpretation, 'subtasks'> & { subtaskTitles: string[] }
  steps: CommandStep[]
  currentStep: number
  ladder: DeliveryLadder
  evidence: { uiProof?: { dir: string; passed: boolean; steps: { label: string; ok: boolean; detail: string }[]; at: string }; install?: { path: string; stamp?: string; commit?: string }; promotion?: { at: string; launcher: string; previousTarget: string; backup: string } }
  diagnoses: Record<string, Diagnosis[]>
  timeline: TimelineEntry[]
  /** progress messages already written back to the origin conversation (so each milestone is posted once) */
  posted: string[]
}
