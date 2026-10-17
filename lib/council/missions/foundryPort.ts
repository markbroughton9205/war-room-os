/**
 * The only door from Council to Foundry. The production implementation (foundryPort.server.ts) calls Foundry's existing mission
 * service; tests substitute a fake. Nothing in the Council layer knows how a mission is executed.
 */
export type FoundryMissionView = {
  id: string
  state: string
  stateReason: string
  stateAt: string
  progress?: { stepsDone: number; stepsTotal: number; modelCalls: number; filesChanged: string[]; lastEvent: string } | null
  result?: { status: string; reason: string; completionClass?: string; verifierExit: number | string } | null
  receipt?: {
    receiptSha256: string
    verifier: { label: string; exitCode: number | string; summary: string; at: string }
    integration: { state: string; branch?: string; commit?: string; tree?: string }
    filesCreated: { path: string }[]
    filesModified: { path: string }[]
    testsAdded: string[]
  } | null
  receiptCheck?: { ok: boolean; mismatches: string[] } | 'NO_RECEIPT'
}

export type FoundryStartBody = {
  action?: 'start'
  title: string
  request: string
  acceptance: string[]
  targets: Array<{ path: string; action: 'create' | 'modify' }>
  scope: { paths: string[]; write: string[] }
  install: boolean
}

/** A plain-language engineering command as Foundry's autonomous controller sees it (Council only mirrors it). */
export type FoundryCommandView = {
  id: string
  state: string
  stateReason: string
  stateAt: string
  title: string
  missionId: string | null
  stepIndex: number
  stepCount: number
  ladder: { codeGenerated: boolean; testsPassed: boolean; verificationPassed: boolean; buildCreated: boolean; installed: boolean; running: boolean; uiProof: string; promoted: boolean }
  installPath: string | null
  mission: FoundryMissionView | null
}

export type FoundryPort = {
  /** the autonomous controller: one sentence in, a tracked mission out. Council never executes anything itself. */
  submitCommand?(text: string, origin: { conversationId: string; ownerId: string }, actor: string): Promise<{ commandId: string; missionId: string | null; state: string; reason: string }>
  getCommand?(commandId: string): FoundryCommandView | null
  cancelCommand?(commandId: string, actor: string, reason: string): Promise<void>
  /** truthful availability (is a repository configured, is the engine reachable) */
  availability(): { ok: true } | { ok: false; reason: string }
  start(body: FoundryStartBody, actor: string): Promise<{ missionId: string; state: string }>
  get(missionId: string): FoundryMissionView | null
  cancel(missionId: string, actor: string, reason: string): void
}
