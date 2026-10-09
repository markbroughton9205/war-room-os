import { createHash } from 'node:crypto'

/**
 * FOUNDRY SOVEREIGN BUILD LAW (pure policy + records; no I/O).
 * Foundry owns the mission, plan, workspace, build, integration, validation and final acceptance. Local resources are the default. Frontier models are
 * bounded outside specialists: scoped, provenance-carrying, isolated until ingested, locally re-checked, accepted or rejected by Foundry, and measured.
 */
export type BuildIdentity = { missionId: string; buildId: string; workspaceId: string; assignmentId: string }
export const buildIdentityFor = (missionId: string, assignmentId: string, workspaceId: string): BuildIdentity => ({ missionId, assignmentId, workspaceId, buildId: `build-${createHash('sha256').update(`${missionId}|${assignmentId}|${workspaceId}`).digest('hex').slice(0, 12)}` })

export type SubtaskKind = 'MAIN_BUILD' | 'LOCAL_SUBTASK' | 'FRONTIER_ASSIST_SUBTASK' | 'LOCAL_REVIEW' | 'LOCAL_VALIDATION' | 'FINAL_INTEGRATION'
export type SubtaskRecord = { subtaskId: string; kind: SubtaskKind; title: string; files: string[]; owner: 'foundry' | `frontier:${string}`; status: string }
/** Every checkpoint step maps to exactly one sovereign subtask kind; the whole assignment is the single MAIN_BUILD that owns them all. */
export function classifySteps(steps: { id: string; title: string; status: string; layer?: string; files: string[] }[], build: BuildIdentity, frontierTasks: { subtaskId: string; file: string; accepted: boolean | null; family: string }[] = []): SubtaskRecord[] {
  const out: SubtaskRecord[] = [{ subtaskId: build.buildId, kind: 'MAIN_BUILD', title: 'controlling Foundry mission build', files: [], owner: 'foundry', status: 'CONTROLLER' }]
  for (const s of steps) {
    const kind: SubtaskKind = s.id === 'verify' ? 'FINAL_INTEGRATION' : s.id === 'accept' ? 'LOCAL_VALIDATION' : s.layer === 'tests' ? 'LOCAL_REVIEW' : 'LOCAL_SUBTASK'
    out.push({ subtaskId: `${build.buildId}:${s.id}`, kind, title: s.title, files: s.files, owner: 'foundry', status: s.status })
  }
  for (const f of frontierTasks) out.push({ subtaskId: f.subtaskId, kind: 'FRONTIER_ASSIST_SUBTASK', title: `bounded assist on ${f.file}`, files: [f.file], owner: `frontier:${f.family}`, status: f.accepted === null ? 'PENDING' : f.accepted ? 'ACCEPTED' : 'REJECTED' })
  return out
}

export const FRONTIER_RETURN_TYPES = ['PATCH_PROPOSAL', 'CODE_FRAGMENT', 'TEST_PLAN', 'REVIEW_REPORT', 'BUG_HYPOTHESIS', 'REFACTOR_PLAN', 'DEPENDENCY_RESEARCH', 'ALTERNATE_BUILD'] as const
export type FrontierReturnType = (typeof FRONTIER_RETURN_TYPES)[number]
/** Return types that carry code and may, after the ingestion gate, become a Foundry-written change. Everything else is advisory text: stored and hashed, never applied. */
export const CODE_RETURN_TYPES: FrontierReturnType[] = ['PATCH_PROPOSAL', 'CODE_FRAGMENT']
export const FORBIDDEN_ACTIONS = ['write or modify any file other than the allowed files', 'commit, push, merge or deploy', 'read or request credentials, environment files or secrets', 'run commands or install dependencies', 'change or relax the acceptance criteria or any test expectation to make a failure pass', 'act on the rest of the project'] as const
export const MAX_FRONTIER_CONTEXT_CHARS = 14_000
export const MAX_FRONTIER_FILES = 3

export type FrontierRequest = {
  missionId: string; buildId: string; subtaskId: string; objective: string; context: string; constraints: string[]; acceptance: string[]
  allowedFiles: string[]; forbiddenActions: readonly string[]; expectedReturn: FrontierReturnType
}
/** Builds a bounded request. Refuses (throws) anything that would hand the whole project or mission to an outside model. */
export function buildFrontierRequest(build: BuildIdentity, i: { subtaskId: string; objective: string; context: string; constraints?: string[]; acceptance: string[]; allowedFiles: string[]; expectedReturn: FrontierReturnType }): FrontierRequest {
  if (!i.subtaskId || !i.objective.trim()) throw new Error('a frontier request needs a subtask id and a bounded objective')
  if (!i.allowedFiles.length || i.allowedFiles.length > MAX_FRONTIER_FILES) throw new Error(`a frontier request is scoped to 1-${MAX_FRONTIER_FILES} allowed files (got ${i.allowedFiles.length}); whole-project hand-off is forbidden`)
  if (i.context.length > MAX_FRONTIER_CONTEXT_CHARS) throw new Error(`frontier context is capped at ${MAX_FRONTIER_CONTEXT_CHARS} characters (got ${i.context.length}); send the minimal context only`)
  if (!(FRONTIER_RETURN_TYPES as readonly string[]).includes(i.expectedReturn)) throw new Error(`unknown frontier return type ${i.expectedReturn}`)
  if (/\.env|secret|credential|password|api[_-]?key/i.test(i.allowedFiles.join(' '))) throw new Error('credential-like paths can never be sent to a frontier model')
  return { missionId: build.missionId, buildId: build.buildId, subtaskId: i.subtaskId, objective: i.objective, context: i.context, constraints: i.constraints ?? [], acceptance: i.acceptance, allowedFiles: i.allowedFiles, forbiddenActions: FORBIDDEN_ACTIONS, expectedReturn: i.expectedReturn }
}
export function renderFrontierRequest(r: FrontierRequest): string {
  return [
    `MISSION ${r.missionId} / BUILD ${r.buildId} / SUBTASK ${r.subtaskId}`,
    `OBJECTIVE: ${r.objective}`,
    r.acceptance.length ? `ACCEPTANCE CRITERIA (authoritative; never weaken them):\n${r.acceptance.map((a) => `- ${a}`).join('\n')}` : '',
    r.constraints.length ? `CONSTRAINTS:\n${r.constraints.map((c) => `- ${c}`).join('\n')}` : '',
    `ALLOWED FILES (you may only return content for these): ${r.allowedFiles.join(', ')}`,
    `FORBIDDEN:\n${r.forbiddenActions.map((f) => `- ${f}`).join('\n')}`,
    `EXPECTED RETURN TYPE: ${r.expectedReturn}`,
    `MINIMAL CONTEXT:\n${r.context}`,
  ].filter(Boolean).join('\n\n')
}

/** Local-first: assistance is justified only by established evidence of a bounded need, and only while the per-build budget allows. */
export type AssistEvidence = { minRefuted?: number; refutedLocalHypotheses: number; localEscalationAlreadyTried: boolean; file: string | null; assistsOnThisFile: number; callsSoFar: number; maxCalls: number; providerAvailable: boolean }
export type AssistDecision = { justified: boolean; basis: string }
export const ASSIST_MIN_REFUTED = 2
export function assistJustified(e: AssistEvidence): AssistDecision {
  if (!e.providerAvailable) return { justified: false, basis: 'no frontier provider is available (local-only build)' }
  if (!e.file) return { justified: false, basis: 'no specific file/symbol is implicated; assistance must be bounded to one' }
  if (e.callsSoFar >= e.maxCalls) return { justified: false, basis: `per-build frontier budget exhausted (${e.callsSoFar}/${e.maxCalls})` }
  if (e.assistsOnThisFile >= 1) return { justified: false, basis: `${e.file} already received one bounded assist` }
  const need = e.minRefuted ?? ASSIST_MIN_REFUTED
  if (e.refutedLocalHypotheses < need) return { justified: false, basis: `local resources are not yet exhausted (${e.refutedLocalHypotheses}/${need} distinct local hypotheses refuted)` }
  return { justified: true, basis: `${e.refutedLocalHypotheses} distinct local hypotheses were refuted on ${e.file}${e.localEscalationAlreadyTried ? ' after local escalation' : ''}; a bounded assist is justified` }
}

/** The only evidence that may justify bounded outside help. `implemented` says whether the workflow can currently detect and act on that trigger. */
export const ESCALATION_TRIGGERS = {
  LOCAL_HYPOTHESES_REFUTED: { implemented: true, meaning: 'distinct local repair hypotheses on one file were acted on and refuted (the same local failure repeated after bounded repair)' },
  ACCEPTANCE_FAILED_SAME_COMPONENT: { implemented: true, meaning: 'the independent acceptance keeps failing on the same bounded component after local repairs' },
  LOCAL_CANDIDATES_DISAGREE: { implemented: false, meaning: 'implementation confidence is low and local alternative attempts disagree' },
  DEPENDENCY_UNRESOLVED_LOCALLY: { implemented: false, meaning: 'a dependency/version problem remains unresolved by local research' },
  HARD_SUBPROBLEM_FROM_REVIEW: { implemented: false, meaning: 'local review identified a hard architectural/debugging subproblem' },
} as const
export type EscalationTrigger = keyof typeof ESCALATION_TRIGGERS

/** Helpers (competing candidates, writer fallback, frontier) share a bounded slice of the assignment and never touch the reserve held for the main build and the final verifier. */
export type HelperPolicy = { share?: number; reserveCalls?: number; runtimeShare?: number }
export const DEFAULT_HELPER_POLICY = { share: 0.25, reserveCalls: 8, runtimeShare: 0.7 } as const
export function helperBudgetLeft(i: { helperCalls: number; modelCalls: number; maxModelCalls: number; elapsedMs: number; maxRuntimeMs: number; policy?: HelperPolicy }): { ok: boolean; why: string } {
  const share = i.policy?.share ?? DEFAULT_HELPER_POLICY.share, rsv = Math.max(i.policy?.reserveCalls ?? DEFAULT_HELPER_POLICY.reserveCalls, Math.ceil(i.maxModelCalls * 0.2)), rt = i.policy?.runtimeShare ?? DEFAULT_HELPER_POLICY.runtimeShare
  const cap = Math.ceil(i.maxModelCalls * share)
  if (i.helperCalls >= cap) return { ok: false, why: `helper share exhausted (${i.helperCalls}/${cap} calls)` }
  if (i.modelCalls >= i.maxModelCalls - rsv) return { ok: false, why: `the last ${rsv} model calls are reserved for the main build and the final verifier (${i.modelCalls}/${i.maxModelCalls} used)` }
  if (i.elapsedMs >= i.maxRuntimeMs * rt) return { ok: false, why: `${Math.round(rt * 100)}% of the runtime is spent; the rest is reserved for the main build and the final verifier` }
  return { ok: true, why: 'within the helper share' }
}

export type IngestionStage = 'RECEIVE' | 'PROVENANCE' | 'SCOPE' | 'STATIC_VALIDATION' | 'LOCAL_REVIEW' | 'INTEGRATION_CANDIDATE' | 'TESTS' | 'INDEPENDENT_VERIFICATION'
export type IngestionStep = { stage: IngestionStage; ok: boolean; note: string }
export type IngestionRecord = {
  subtaskId: string; buildId: string; missionId: string; provider: string; model: string; at: string; task: string; contextScope: { files: string[]; contextChars: number }
  /** governance: why Foundry escalated, how much local effort preceded it, what was shared and what it cost */
  reasonForEscalation: { trigger: EscalationTrigger; basis: string }; localAttemptsBefore: number; sharedFiles: string[]; tokensEstimated: { in: number; out: number }; cost: 'UNKNOWN'; cleanOutcomeImpact: 'PENDING' | 'CLEAN_AFTER_ACCEPTED_ASSIST' | 'ASSIST_REJECTED' | 'NOT_CLEAN'
  returnType: FrontierReturnType; artifactHash: string; artifactPath: string | null; steps: IngestionStep[]
  decision: 'ACCEPTED' | 'REJECTED' | 'PENDING'; reason: string; measuredBenefit: string
}
export const sha = (t: string) => createHash('sha256').update(t).digest('hex').slice(0, 16)

/** Scope + provenance checks that need no workspace: the returned artifact must carry provenance and may target only the allowed files. */
export function checkProvenanceAndScope(req: FrontierRequest, r: { provider: string; model: string; text: string; targetFile: string | null }): IngestionStep[] {
  const steps: IngestionStep[] = []
  steps.push({ stage: 'RECEIVE', ok: r.text.trim().length > 0, note: r.text.trim() ? `${r.text.length} chars received` : 'empty reply' })
  steps.push({ stage: 'PROVENANCE', ok: !!r.provider && !!r.model, note: `${r.provider}/${r.model} @ hash ${sha(r.text)}` })
  const inScope = req.expectedReturn in { PATCH_PROPOSAL: 1, CODE_FRAGMENT: 1 } ? !!r.targetFile && req.allowedFiles.includes(r.targetFile) : true
  steps.push({ stage: 'SCOPE', ok: inScope, note: inScope ? `target ${r.targetFile ?? 'n/a (advisory)'} is within the allowed files` : `target ${r.targetFile ?? 'none'} is outside the allowed files ${req.allowedFiles.join(', ')}` })
  return steps
}

/** Per-build frontier usage: scarce, measured, and fed back into Forge so unnecessary calls decline over time. */
export type FrontierUsage = {
  frontier_calls: number; frontier_tokens: { in: number; out: number; basis: 'ESTIMATED_CHARS_DIV_4' }; frontier_cost: 'UNKNOWN'; frontier_tasks: string[]
  accepted_contributions: number; rejected_contributions: number; clean_outcome_delta: number | 'UNKNOWN'; unavailable: string | null
  /** escalation criteria that were met but could not be served (no provider / budget): evidence of how often local-only was insufficient */
  escalation_needed_unmet: { trigger: EscalationTrigger; file: string; basis: string; reason: string }[]
}
export class FrontierLedger {
  readonly records: IngestionRecord[] = []
  calls = 0; charsIn = 0; charsOut = 0; unavailable: string | null = null
  readonly unmet: FrontierUsage['escalation_needed_unmet'] = []
  constructor(readonly maxCalls: number) {}
  spend(inChars: number, outChars: number) { this.calls += 1; this.charsIn += inChars; this.charsOut += outChars }
  assistsOn(file: string) { return this.records.filter((r) => r.contextScope.files.includes(file)).length }
  /** clean_outcome_delta: +1 when a frontier contribution was accepted and the build finished CLEAN; 0 when assist changed nothing; -1 when assists were rejected and cost a call. UNKNOWN without a verdict. */
  usage(finalClean: boolean | null): FrontierUsage {
    const acc = this.records.filter((r) => r.decision === 'ACCEPTED').length, rej = this.records.filter((r) => r.decision === 'REJECTED').length
    return { frontier_calls: this.calls, frontier_tokens: { in: Math.round(this.charsIn / 4), out: Math.round(this.charsOut / 4), basis: 'ESTIMATED_CHARS_DIV_4' }, frontier_cost: 'UNKNOWN', frontier_tasks: this.records.map((r) => `${r.subtaskId}:${r.task}`), accepted_contributions: acc, rejected_contributions: rej, clean_outcome_delta: finalClean === null || !this.calls ? 'UNKNOWN' : acc > 0 && finalClean ? 1 : acc === 0 ? (rej > 0 ? -1 : 0) : 0, unavailable: this.unavailable, escalation_needed_unmet: this.unmet }
  }
}

/** Forge feedback: history of past builds' frontier usage decides how much assistance is still worth allowing. */
export function frontierBudgetFromHistory(history: { frontier_calls: number; accepted_contributions: number }[], defaultMax = 3): { maxCalls: number; basis: string } {
  const calls = history.reduce((n, h) => n + h.frontier_calls, 0), acc = history.reduce((n, h) => n + h.accepted_contributions, 0)
  if (calls >= 4 && acc === 0) return { maxCalls: 0, basis: `${calls} past assist calls produced 0 accepted contributions; assistance is switched off until local evidence changes` }
  if (calls >= 4 && acc / calls < 0.25) return { maxCalls: 1, basis: `only ${acc}/${calls} past assists were accepted; budget reduced to 1` }
  return { maxCalls: defaultMax, basis: calls ? `${acc}/${calls} past assists accepted; default budget` : 'no history; default budget' }
}
