/**
 * The native-builder orchestrator — the only module that drives NativeRepairState transitions.
 * Every transition is validated against NATIVE_REPAIR_TRANSITIONS, persisted via storage.ts, and
 * audit-logged via logWarRoomRepoAudit. storage.ts stays a leaf (read/write only); this module is
 * the one and only place that calls into it and decides what happens next — same direction
 * discipline as the loadSelfRepairSnapshot fix (leaf modules never call back into the driver).
 */
import { randomUUID } from 'node:crypto'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'
import { getActiveWorkspaceId } from '@/lib/repo/workspaceContext'
import { previewDiff, hashDiffSample } from '@/lib/repo/diff'
import {
  NATIVE_REPAIR_TRANSITIONS,
  type LocalReasoningLabel,
  type NativeIssueIngestInput,
  type NativeIssueRecord,
  type NativeRepairRecord,
  type NativeRepairState,
  type NativeRepairProposal,
} from './types'
import { fingerprintIssue, ingestIssue, mergeIssueOccurrence } from './issueIngest'
import { findIssueByFingerprint, getIssue, getRepair, saveIssue, saveRepair } from './storage'
import { readRepoFile, searchRepoText } from './repositoryInspector'
import { gatherHostedCoderContext } from './contextExpansion'
import {
  buildDeterministicProposal,
  councilOpinionsAsAdvisoryProposals,
  determineLocalReasoningLabel,
  requestCouncilOpinions,
  requestHostedModelProposal,
  requestLocalModelProposal,
  selectPreferredProposal,
  type HostedModelOutcome,
  type InspectionExcerpt,
  type LocalModelOutcome,
  type NativeCouncilFamily,
  type NativeCouncilInvokeFn,
} from './repairPlanner'
import { validatePatchPolicy } from './patchPolicy'
import { applyProposal } from './patchApplier'
import { listSnapshots, rollbackRepair as rollbackRepairFiles } from './rollback'
import { runValidationOperations } from './validationRunner'
import { verifyIssueResolved } from './repairVerifier'
import { deriveImmunityArtifact } from './immunity'
import { issueFromSystemHealthCheck } from './issueIngest'
import { buildCanonicalSystemHealthSnapshot, type CanonicalSystemHealthSnapshot, type SystemHealthCheck } from './systemHealthSnapshot'
import { classifyRepairScope, type RepairScopeClassification } from './repairScopeClassifier'
import { listRepairsForIssue } from './storage'

// ---------------------------------------------------------------------------
// Phase L (Hardening). A genuine concurrency bug found and fixed during this phase: two
// approveAndApply() calls racing on the SAME repairId (e.g. a double-click, or two Commander
// clients both approving before either's response returns) could both read the
// 'awaiting_local_execution_approval' state, both pass the transition() check, and both proceed
// to apply — corrupting the target file (proven by engineeringHardening.validation.ts's
// hardening_07/08 cases before this fix landed: the file ended up with fragments of both the
// broken and fixed content). The state machine (NATIVE_REPAIR_TRANSITIONS) alone is not
// sufficient serialization when two calls both read the pre-transition state before either
// writes it back — this is the standard read-then-write TOCTOU race, and it needed real
// mutual exclusion, not a bigger state machine.
//
// Fix: a small in-process, per-repairId async mutex. Deliberately in-process only (this is a
// single Node server process; storage.ts has no cross-process lock and adding one — e.g. a
// Postgres advisory lock — would be new infrastructure this phase's "no new sink unless
// demonstrated necessary" discipline argues against for a problem an in-process lock fully
// solves). Wraps every mutating native-builder entry point that can legally run against the same
// repairId (approveAndApply, commanderResolve, rollbackNow) so none of the three can race each
// other either (e.g. approve() and rollbackNow() firing concurrently).
// ---------------------------------------------------------------------------
const repairLocks = new Map<string, Promise<unknown>>()

async function withRepairLock<T>(repairId: string, fn: () => Promise<T>): Promise<T> {
  const previous = repairLocks.get(repairId) ?? Promise.resolve()
  const current = previous.then(fn, fn)
  // Chain the next waiter behind THIS call's settlement (ignoring its outcome — a failed
  // approval must not deadlock the next legitimate call on the same repairId). Stored once so
  // the cleanup check below compares against the SAME promise reference it published.
  const tail = current.then(
    () => undefined,
    () => undefined,
  )
  repairLocks.set(repairId, tail)
  try {
    return await current
  } finally {
    // Only clear the map entry if nothing newer has queued behind us, so we don't leak a
    // never-cleared reference for every repairId ever touched.
    if (repairLocks.get(repairId) === tail) {
      repairLocks.delete(repairId)
    }
  }
}

export class InvalidStateTransitionError extends Error {
  constructor(from: NativeRepairState, to: NativeRepairState) {
    super(`Illegal native-repair transition: ${from} -> ${to}`)
    this.name = 'InvalidStateTransitionError'
  }
}

function transition(record: NativeRepairRecord, next: NativeRepairState, note?: string): NativeRepairRecord {
  const allowed = NATIVE_REPAIR_TRANSITIONS[record.state]
  if (!allowed.includes(next)) {
    throw new InvalidStateTransitionError(record.state, next)
  }
  const at = new Date().toISOString()
  return {
    ...record,
    state: next,
    history: [...record.history, { state: next, at, note }],
    updatedAt: at,
  }
}

async function persist(record: NativeRepairRecord, auditMessage: string): Promise<NativeRepairRecord> {
  await saveRepair(record)
  // Phase K (Observability & Audit): workspaceId is included whenever this call happened inside a
  // Phase B-resolved workspace (runInResolvedWorkspace); omitted (not fabricated) otherwise, e.g.
  // in this same suite's direct runtime.ts calls that never go through a workspace-aware route.
  const workspaceId = getActiveWorkspaceId()
  await logWarRoomRepoAudit(`native-builder: ${auditMessage}`, {
    repairId: record.id,
    state: record.state,
    issueId: record.issueId,
    ...(workspaceId ? { workspaceId } : {}),
  })
  return record
}

// ---------------------------------------------------------------------------
// 1. Issue ingestion -> repair creation
// ---------------------------------------------------------------------------

export async function reportIssue(input: NativeIssueIngestInput): Promise<{ issue: NativeIssueRecord; repair: NativeRepairRecord | null }> {
  const now = new Date().toISOString()
  const fingerprint = fingerprintIssue(input)
  const existing = await findIssueByFingerprint(fingerprint)

  if (existing) {
    const merged = mergeIssueOccurrence(existing, input, now)
    await saveIssue(merged)
    await logWarRoomRepoAudit('native-builder: issue occurrence merged', { issueId: merged.id, fingerprint, occurrenceCount: merged.occurrenceCount })
    // Re-open case: give the Commander/console a fresh repair to act on.
    if (existing.status === 'resolved') {
      const repair = await createRepairForIssue(merged)
      return { issue: merged, repair }
    }
    return { issue: merged, repair: null }
  }

  const issue = ingestIssue(input, randomUUID(), now)
  await saveIssue(issue)
  await logWarRoomRepoAudit('native-builder: issue detected', { issueId: issue.id, fingerprint, source: issue.source })
  const repair = await createRepairForIssue(issue)
  return { issue, repair }
}

async function createRepairForIssue(issue: NativeIssueRecord): Promise<NativeRepairRecord> {
  const now = new Date().toISOString()
  const record: NativeRepairRecord = {
    id: randomUUID(),
    issueId: issue.id,
    state: 'detected',
    history: [{ state: 'detected', at: now, note: 'Issue reported to native builder.' }],
    proposals: [],
    validationResults: [],
    autoRepairEligible: false,
    autoRepairMode: false,
    createdAt: now,
    updatedAt: now,
  }
  const collecting = transition(record, 'collecting_evidence', 'Evidence bundled from issue report.')
  return persist(collecting, 'repair opened, collecting evidence')
}

const UNHEALTHY_STATUSES = new Set(['degraded', 'unavailable', 'unknown'])

export type RepairSystemSweepEntry = {
  check: SystemHealthCheck
  scope: RepairScopeClassification
  issue: NativeIssueRecord
  repair: NativeRepairRecord | null
}

export type RepairSystemSweepResult = {
  snapshot: CanonicalSystemHealthSnapshot
  entries: RepairSystemSweepEntry[]
}

/**
 * The single [ REPAIR SYSTEM ] entry point (Part 1/5): reads the canonical health snapshot,
 * finds every degraded/unavailable/unknown check, classifies whether it's realistically
 * code-repairable, and opens (or reuses) a canonical issue + repair mission per check — the
 * Commander never has to pick a subsystem manually first.
 */
export async function runRepairSystemSweep(req: Request): Promise<RepairSystemSweepResult> {
  const snapshot = await buildCanonicalSystemHealthSnapshot(req)
  const unhealthy = snapshot.checks.filter(c => UNHEALTHY_STATUSES.has(c.status))

  const entries: RepairSystemSweepEntry[] = []
  for (const check of unhealthy) {
    const evidenceText = check.evidence.map(e => e.label).join(' ')
    const scope = classifyRepairScope(evidenceText)
    const input = issueFromSystemHealthCheck({
      subsystemId: check.subsystemId,
      title: check.title,
      status: check.status,
      severity: check.severity,
      evidenceLabels: check.evidence.map(e => e.label),
    })
    const { issue, repair } = await reportIssue(input)
    let activeRepair = repair
    if (!activeRepair) {
      const existingRepairs = await listRepairsForIssue(issue.id)
      activeRepair = existingRepairs.find(r => r.state !== 'resolved' && r.state !== 'cancelled') ?? null
    }
    entries.push({ check, scope, issue, repair: activeRepair })
  }

  return { snapshot, entries }
}

// ---------------------------------------------------------------------------
// 2. Inspection + planning
// ---------------------------------------------------------------------------

async function gatherExcerpts(issue: NativeIssueRecord, targetFiles?: string[]): Promise<InspectionExcerpt[]> {
  const excerpts: InspectionExcerpt[] = []
  const candidates = targetFiles?.length ? targetFiles : [issue.affectedSubsystem]

  for (const candidate of candidates) {
    const read = await readRepoFile(candidate)
    if (read.ok) excerpts.push({ relPath: read.relPath, content: read.content })
  }

  if (excerpts.length === 0) {
    // Fall back to a bounded text search seeded by the issue title, to find plausible files when
    // affectedSubsystem isn't a literal path (e.g. a panel label, not a file).
    const query = issue.title.split(/\s+/).find(w => w.length > 4) ?? issue.title
    const hits = await searchRepoText(query)
    const distinctFiles = [...new Set(hits.map(h => h.relPath))].slice(0, 3)
    for (const file of distinctFiles) {
      const read = await readRepoFile(file)
      if (read.ok) excerpts.push({ relPath: read.relPath, content: read.content })
    }
  }

  return excerpts
}

export type PlanRepairOptions = {
  targetFiles?: string[]
  useLocalModel?: boolean
  councilFamilies?: NativeCouncilFamily[]
  /** Real provider dispatch, injected rather than statically imported (see repairPlanner.ts's
   * file header) — the API route layer passes lib/council/providerDirectCall.ts's
   * invokeDirectCouncilProvider here. Required only when councilFamilies is non-empty. */
  councilInvoke?: NativeCouncilInvokeFn
  /** Hosted-model coder proposal source (General-Purpose Coder Proposal Generation phase): a real
   * hosted provider generating a novel structured-patch proposal for a Commander request no
   * deterministic template matches. `invoke` is the same injected-dependency pattern as
   * councilInvoke — the caller passes the real invokeDirectCouncilProvider. Omitted entirely by
   * default, so every existing planRepair() caller is unaffected. */
  hostedCoder?: {
    family: NativeCouncilFamily
    invoke: NativeCouncilInvokeFn
  }
  /** Free-text Commander request included in the hosted-coder prompt when provided. Purely
   * informational context — never affects which validations run or which policy applies. */
  commanderRequestText?: string
}

/** Built only for a replan (isReplan === true): summarizes the PRIOR attempt's real validation
 * failures / verification evidence so a hosted coder proposal source can see exactly what its
 * previous attempt got wrong, instead of blindly retrying the same change. Reads only fields
 * already on the record — no new evidence collection mechanism. */
export function summarizeFailureEvidenceForReplan(record: NativeRepairRecord): string {
  const parts: string[] = []
  if (record.verification) {
    parts.push(`Verification status: ${record.verification.status}.`)
    parts.push(...record.verification.evidence)
  }
  for (const result of record.validationResults) {
    if (result.ok) continue
    const label = result.operation.targets?.length ? `${result.operation.id} (${result.operation.targets.join(', ')})` : result.operation.id
    const output = (result.stderr || result.stdout).slice(0, 2000)
    parts.push(`${label} FAILED (exit ${result.exitCode}):\n${output}`)
  }
  return parts.join('\n')
}

export async function planRepair(repairId: string, opts: PlanRepairOptions = {}): Promise<NativeRepairRecord> {
  const record = await requireRepair(repairId)
  const issue = await requireIssue(record.issueId)

  // NATIVE_REPAIR_TRANSITIONS already declares two distinct legal entries into 'planning':
  //   - collecting_evidence -> inspecting_repository -> planning   (first-time planning)
  //   - {verification_failed, blocked, partially_verified, rolled_back,
  //      escalation_recommended} -> planning directly                (replanning/iteration)
  // Previously this function always forced the first path regardless of the record's actual
  // state, which made the second, already-designed set of edges unreachable — replanning from
  // any of those five states threw InvalidStateTransitionError because none of them may legally
  // enter 'inspecting_repository'. The fix is to route through whichever edge the record's
  // current state actually permits; transition() still enforces NATIVE_REPAIR_TRANSITIONS exactly
  // as before; no state is granted a new edge and no check is weakened.
  const allowedFromCurrent = NATIVE_REPAIR_TRANSITIONS[record.state]
  const isReplan = !allowedFromCurrent.includes('inspecting_repository') && allowedFromCurrent.includes('planning')

  let preInspection = record
  if (!isReplan) {
    preInspection = await persist(
      transition(record, 'inspecting_repository', 'Reading relevant source files.'),
      'inspecting repository',
    )
  }

  // Re-running gatherExcerpts on a replan is deliberate: the repository may have changed since
  // the prior attempt (a partially-applied patch, a rollback, files touched by validation), so a
  // fresh read is more honest than reusing stale excerpts — this is real re-inspection work, it
  // is simply not gated behind a second formal 'inspecting_repository' state hop, because that
  // hop is not a legal transition from these five states.
  const excerpts = await gatherExcerpts(issue, opts.targetFiles)
  const planningNote = isReplan
    ? `Re-inspected ${excerpts.length} file(s) ahead of replanning from ${record.state}.`
    : `Inspected ${excerpts.length} file(s).`
  const planning = await persist(
    transition(preInspection, 'planning', planningNote),
    isReplan ? 'replanning repair' : 'planning repair',
  )

  const proposals: NativeRepairProposal[] = []

  const deterministic = buildDeterministicProposal(issue, excerpts)
  if (deterministic) proposals.push(deterministic)

  let localModelOutcome: LocalModelOutcome | null = null
  if (opts.useLocalModel !== false) {
    localModelOutcome = await requestLocalModelProposal(issue, excerpts)
    if (localModelOutcome.status === 'proposal') proposals.push(localModelOutcome.proposal)
  }

  let hostedModelOutcome: HostedModelOutcome | null = null
  if (opts.hostedCoder) {
    // Only a genuine replan carries prior failure evidence — a first-time hosted proposal has no
    // prior attempt to summarize. `record` here is the ORIGINAL pre-transition record (its
    // validationResults/verification reflect whatever the last apply cycle produced), not
    // `withProposals`, which is correct: we want the evidence from before this planning pass.
    const priorFailureEvidence = isReplan ? summarizeFailureEvidenceForReplan(record) : undefined
    // Phase H: the hosted-coder path specifically gets an expanded, bounded context (target files
    // + one-hop import relationships + a few search matches + symbol-usage locations + scoped git
    // context) built from the exact same read surface — deterministic/local-model proposals above
    // are untouched and keep using the plain `excerpts`. See contextExpansion.ts.
    const expandedContext = await gatherHostedCoderContext(issue, opts.targetFiles, excerpts)
    hostedModelOutcome = await requestHostedModelProposal(issue, expandedContext.excerpts, opts.hostedCoder.family, opts.hostedCoder.invoke, {
      priorFailureEvidence,
      commanderRequestText: opts.commanderRequestText,
    })
    if (hostedModelOutcome.status === 'proposal') {
      hostedModelOutcome.proposal.contextSources = expandedContext.sources
      proposals.push(hostedModelOutcome.proposal)
    }
  }

  if (opts.councilFamilies?.length && opts.councilInvoke) {
    const opinions = await requestCouncilOpinions(issue, excerpts, opts.councilFamilies, opts.councilInvoke)
    proposals.push(...councilOpinionsAsAdvisoryProposals(issue, opinions))
  }

  const selected = selectPreferredProposal(proposals)
  const policyResult = selected ? validatePatchPolicy(selected) : undefined
  const reasoningLabel: LocalReasoningLabel = determineLocalReasoningLabel({
    deterministicFound: Boolean(deterministic),
    localModelOutcome,
    externalEscalationApproved: false,
  })

  const withProposals: NativeRepairRecord = {
    ...planning,
    proposals,
    selectedProposal: selected ?? undefined,
    policyResult,
  }

  if (selected && policyResult?.ok) {
    const next = await persist(
      transition(withProposals, 'awaiting_local_execution_approval', `Selected proposal from ${selected.proposerId} (${reasoningLabel}).`),
      'plan ready, awaiting Commander approval',
    )
    return next
  }

  if (proposals.some(p => p.sourceKind === 'council_family')) {
    return persist(
      transition(withProposals, 'escalation_recommended', 'No executable local/deterministic proposal passed policy; council diagnoses available for review.'),
      'escalation recommended',
    )
  }

  return persist(
    transition(withProposals, 'blocked', policyResult ? `Selected proposal failed patch policy: ${policyResult.violations.map(v => v.rule).join(', ')}` : 'No proposal could be generated from available evidence.'),
    'planning blocked',
  )
}

// ---------------------------------------------------------------------------
// 3. Approval -> apply -> validate -> verify
// ---------------------------------------------------------------------------

export async function approveAndApply(repairId: string, approvalGranted: boolean): Promise<NativeRepairRecord> {
  return withRepairLock(repairId, () => approveAndApplyUnlocked(repairId, approvalGranted))
}

async function approveAndApplyUnlocked(repairId: string, approvalGranted: boolean): Promise<NativeRepairRecord> {
  const record = await requireRepair(repairId)
  if (!approvalGranted) {
    throw new Error('approveAndApply requires explicit approvalGranted: true — this is a defense-in-depth check behind the API route\'s assertAutoOrApproval gate.')
  }
  if (!record.selectedProposal) {
    throw new Error('No selected proposal to apply.')
  }

  const applying = await persist(transition(record, 'applying_patch', 'Commander approved local execution.'), 'applying patch')

  const applyResult = await applyProposal(repairId, applying.selectedProposal!)
  if (!applyResult.ok) {
    const blocked = await persist(
      transition(applying, 'blocked', `Patch application failed: ${applyResult.outcomes.map(o => o.detail).join('; ')}`),
      'patch application failed',
    )
    return blocked
  }

  const validating = await persist(transition(applying, 'validating', 'Patch applied; running validations.'), 'running validations')

  const validationResults = await runValidationOperations(validating.selectedProposal!.validations)
  const issue = await requireIssue(validating.issueId)
  const verification = verifyIssueResolved(issue, validationResults)

  const diffPreview = await previewDiff({ paths: validating.selectedProposal!.relevantFiles, maxBytes: 64 * 1024 })
  // `git diff` (unstaged) never shows changes to untracked files — a brand-new file the native
  // builder itself created (create_file) or a file that was never git-added has no baseline to
  // diff against, so git legitimately returns nothing even though a real change was made. Fall
  // back to a before/after rendering built directly from the rollback snapshots we already took,
  // so diff evidence is never silently empty for a real applied patch.
  const diffText = diffPreview.diff || (await buildSnapshotDiffFallback(applying.id))
  const diffEvidence = {
    diff: diffText,
    truncated: diffPreview.truncated,
    changedFiles: validating.selectedProposal!.relevantFiles,
    diffHash: hashDiffSample(diffText),
  }

  const withEvidence: NativeRepairRecord = { ...validating, validationResults, verification, diffEvidence }

  if (verification.status === 'verification_blocked') {
    return persist(transition(withEvidence, 'verification_failed', verification.evidence.join(' ')), 'verification failed')
  }

  if (verification.status === 'partially_verified') {
    return persist(
      transition(withEvidence, 'partially_verified', 'No validation directly re-ran the exact original check — flagging as partially verified before Commander review.'),
      'partially verified, awaiting Commander decision',
    )
  }

  return persist(
    transition(withEvidence, 'awaiting_commander_review', `Verification: ${verification.status}. Awaiting final Commander acceptance.`),
    'awaiting Commander review',
  )
}

// ---------------------------------------------------------------------------
// 4. Commander final decision
// ---------------------------------------------------------------------------

export async function commanderResolve(repairId: string, accepted: boolean): Promise<NativeRepairRecord> {
  return withRepairLock(repairId, () => commanderResolveUnlocked(repairId, accepted))
}

async function commanderResolveUnlocked(repairId: string, accepted: boolean): Promise<NativeRepairRecord> {
  const record = await requireRepair(repairId)

  if (!accepted) {
    await rollbackRepairFiles(repairId)
    return persist(transition(record, 'rolled_back', 'Commander rejected the repair; changes rolled back.'), 'commander rejected, rolled back')
  }

  const issue = await requireIssue(record.issueId)
  const resolvedIssue: NativeIssueRecord = {
    ...issue,
    status: 'resolved',
    resolvedAt: new Date().toISOString(),
    resolvedByRepairId: record.id,
  }
  await saveIssue(resolvedIssue)

  const immunityOutcome = deriveImmunityArtifact(record, issue)
  const withImmunity: NativeRepairRecord = { ...record, immunityOutcome }
  const note = immunityOutcome.created
    ? `Commander accepted the repair. Immunity added: ${immunityOutcome.artifact.type} (${immunityOutcome.artifact.files.join(', ')}).`
    : `Commander accepted the repair. No immunity artifact created: ${immunityOutcome.reason}`

  return persist(transition(withImmunity, 'resolved', note), 'commander accepted, marked resolved')
}

export async function rollbackNow(repairId: string): Promise<NativeRepairRecord> {
  return withRepairLock(repairId, () => rollbackNowUnlocked(repairId))
}

async function rollbackNowUnlocked(repairId: string): Promise<NativeRepairRecord> {
  const record = await requireRepair(repairId)
  await rollbackRepairFiles(repairId)

  // Reverting a repair's files means the underlying problem is back — if this repair was the one
  // that marked the issue resolved, reopen it so the unresolved-issue badge stays truthful.
  const issue = await requireIssue(record.issueId)
  if (issue.status === 'resolved' && issue.resolvedByRepairId === repairId) {
    await saveIssue({ ...issue, status: 'open', resolvedAt: undefined, resolvedByRepairId: undefined })
  }

  return persist(transition(record, 'rolled_back', 'Rollback executed by explicit request.'), 'rolled back on request')
}

/** Cancel before any patch has been applied — no files were ever touched, so there is nothing to
 * roll back. Legal only from the pre-apply states (see NATIVE_REPAIR_TRANSITIONS). */
export async function cancelRepair(repairId: string, reason?: string): Promise<NativeRepairRecord> {
  const record = await requireRepair(repairId)
  return persist(transition(record, 'cancelled', reason ?? 'Cancelled by Commander before any patch was applied.'), 'cancelled')
}

/** Before/after text built from this repair's own rollback snapshots (original content) plus the
 * current on-disk content — used only when `git diff` has nothing to show (untracked files). */
async function buildSnapshotDiffFallback(repairId: string): Promise<string> {
  const snapshots = await listSnapshots(repairId)
  if (!snapshots.length) return ''
  const blocks: string[] = []
  for (const snapshot of snapshots) {
    const current = await readRepoFile(snapshot.relPath)
    const after = current.ok ? current.content : '(file no longer readable)'
    const before = snapshot.existedBefore ? (snapshot.originalContent ?? '') : '(file did not exist)'
    blocks.push(`--- a/${snapshot.relPath}\n${before}\n+++ b/${snapshot.relPath}\n${after}`)
  }
  return blocks.join('\n\n')
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function requireRepair(repairId: string): Promise<NativeRepairRecord> {
  const record = await getRepair(repairId)
  if (!record) throw new Error(`No native repair record for id ${repairId}`)
  return record
}

async function requireIssue(issueId: string): Promise<NativeIssueRecord> {
  const issue = await getIssue(issueId)
  if (!issue) throw new Error(`No native issue record for id ${issueId}`)
  return issue
}
