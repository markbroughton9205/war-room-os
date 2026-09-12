/**
 * #22 Phase 3 — Bounded ENGINEERING_AGENT runtime.
 * Isolated worktree writes + allowlisted validation only.
 * Does NOT commit, push, or deploy. Invocation-driven; Ascension autonomy OFF.
 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { buildGovernedAuditMetadata, insertGovernedAuditLog } from '@/lib/war-room/governedAudit'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'
import { assertEngineeringOwnerScopeMatch } from './ownership'
import {
  createEngineeringAgentIdentity,
  ENGINEERING_AGENT_AUTONOMOUS_EXECUTION_ENABLED,
  isEngineeringAgentRuntimeAvailable,
} from './identity'
import {
  assertEngineeringAgentCannotSelfApprove,
  denyEngineeringAgentAction,
} from './profile'
import { createEngineeringAgentScope, isEngineeringScopeExpired, type EngineeringAgentScope } from './scope'
import {
  classifyEngineeringStatus,
  ENGINEERING_AGENT_BOUNDARY_NOTES,
  type EngineeringAgentDenial,
  type EngineeringAgentResult,
  type EngineeringFileChange,
} from './result'
import {
  attemptArbitraryCommand,
  runApprovedEngineeringCommand,
  type EngineeringCommandResult,
} from './commands'
import {
  readBoundedFile,
  removeBoundedFile,
  resolvePathInsideWorktree,
  verifyApprovedWorktree,
  writeBoundedFile,
} from './worktree'
import { ascensionAutonomyIsOff } from '@/lib/ascension/operationalRegistry'
import type { PolicyDecision } from '@/lib/permissions/policyDecision'

export type EngineeringMutationRequest = {
  relativePath: string
  content: string
  /** If true, remove file after writing for live-safe proofs (agent-created only). */
  restoreAfter?: boolean
}

export type RunBoundedEngineeringInput = {
  taskDescription: string
  ownerUserId: string
  requestedBy: string
  invokedBy: 'commander' | 'council' | 'astra'
  approvedWorktree: string
  allowedPaths: string[]
  allowedValidationCommands?: string[]
  mutations?: EngineeringMutationRequest[]
  filesToRead?: string[]
  missionId?: string | null
  conversationId?: string | null
  /** Optional Research Agent result — informs only; never expands authority. */
  researchHandoff?: { summary?: string; finding_refs?: string[] } | null
  /** Security recommendation — advisory only. Cannot grant commit/push/deploy. */
  securityHandoff?: {
    summary?: string
    finding_refs?: string[]
    grantCommit?: boolean
    grantPush?: boolean
    grantDeploy?: boolean
  } | null
  /** Optional Terra context — read-only; never authorizes mutation. */
  terraContextProvided?: boolean
  /** Council/ASTRA attempted scope expansion — denied. */
  attemptedScopeExpansion?: boolean
  /** Council attempt to grant push/deploy — denied. */
  councilGrantPushOrDeploy?: boolean
  /** Escape-hatch attempts for red-team. */
  attemptedAction?: string | null
  /** Arbitrary command attempt (never executed). */
  attemptedArbitraryCommand?: { cmd: string; args: string[] } | null
  /** Path write attempts outside governance (tested, never applied if denied). */
  attemptedWrites?: string[] | null
  /** When set with conversationId, enforces owner match (service role cannot bypass). */
  conversationOwnerUserId?: string | null
  supabase?: WarRoomSupabase | null
  enforceOwnership?: boolean
  allowCreateEmptyWorktree?: boolean
  nowIso?: string
  repositoryRoot?: string
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function denialFromDecision(capability: string, decision: PolicyDecision): EngineeringAgentDenial {
  return {
    capability_or_action: capability,
    reason_code: decision.reasonCode,
    reason: decision.reason,
  }
}

export async function runBoundedEngineeringAgent(
  input: RunBoundedEngineeringInput,
): Promise<EngineeringAgentResult> {
  const startedAt = input.nowIso ?? new Date().toISOString()
  const startedMs = Date.now()
  const requestId = randomUUID()
  const denials: EngineeringAgentDenial[] = []
  const warnings: string[] = []
  const limitations: string[] = [
    'ENGINEERING_AGENT runtime commit authority DENIED in this phase.',
    'Returns unstaged patch/diff only.',
  ]
  const filesRead: string[] = []
  const filesModified: EngineeringFileChange[] = []
  const agentCreated: string[] = []
  const validationResults: EngineeringCommandResult[] = []
  let boundedDiff = ''
  let auditId: string | null = null

  const repoRoot = path.resolve(input.repositoryRoot ?? resolveRepoRoot())

  const emptyScope = (): EngineeringAgentScope =>
    createEngineeringAgentScope({
      repositoryRoot: repoRoot,
      worktreePath: input.approvedWorktree || '(missing)',
      baseSha: null,
      taskDescription: input.taskDescription || '(none)',
      allowedPaths: input.allowedPaths ?? [],
      allowedValidationCommands: input.allowedValidationCommands ?? [],
      ownerUserId: input.ownerUserId,
      requestedBy: input.requestedBy,
      missionId: input.missionId,
      conversationId: input.conversationId,
      nowIso: startedAt,
    })

  const finish = async (
    status: EngineeringAgentResult['status'],
    scope: EngineeringAgentScope,
    extras?: { planSummary?: string; worktree?: string },
  ): Promise<EngineeringAgentResult> => {
    const identity = createEngineeringAgentIdentity({
      requestId,
      ownerUserId: input.ownerUserId,
      requestedBy: input.requestedBy,
      approvedWorktree: scope.worktree_path,
      repositoryRoot: scope.repository_root,
      allowedPaths: scope.allowed_paths,
      allowedCommands: scope.allowed_validation_commands,
      missionId: input.missionId,
      conversationId: input.conversationId,
      nowIso: startedAt,
    })

    const result: EngineeringAgentResult = {
      agent_id: identity.agent_id,
      agent_role: 'ENGINEERING_AGENT',
      status,
      task: scope.task_description,
      base_sha: scope.base_sha,
      worktree: extras?.worktree ?? scope.worktree_path,
      files_read: filesRead,
      files_modified: filesModified,
      diff_summary:
        filesModified.length === 0
          ? 'No agent-created file modifications.'
          : `Modified ${filesModified.length} file(s) within approved worktree scope.`,
      patch_reference: null,
      bounded_diff: boundedDiff.slice(0, 40_000),
      validation_commands: scope.allowed_validation_commands,
      validation_results: validationResults,
      warnings,
      limitations,
      denials,
      preexisting_dirty: [],
      agent_created_changes: agentCreated,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      owner_scope: input.ownerUserId,
      mission_id: input.missionId ?? null,
      conversation_id: input.conversationId ?? null,
      audit_id: auditId,
      identity,
      scope,
      plan_summary:
        extras?.planSummary ??
        'INSPECT → PLAN → MODIFY APPROVED FILES IN ISOLATED WORKTREE → VALIDATE → RETURN PATCH/DIFF/RESULTS',
      boundary_notes: ENGINEERING_AGENT_BOUNDARY_NOTES,
    }

    try {
      const decision: PolicyDecision = denials[0]
        ? {
            outcome: 'DENY',
            reasonCode: (denials[0].reason_code as PolicyDecision['reasonCode']) || 'POLICY_DENIED',
            reason: denials[0].reason,
            actionKind: 'file_modification',
            canonicalKind: 'file_modification',
            riskTier: 'TIER_2_PERSISTENT_INTERNAL_MUTATION',
            technicalReach: 'WRITE_BOUNDED',
            policyAuthority: 'BOUNDED_ALLOWED',
            requiresApproval: true,
            approvalSatisfied: false,
            httpStatus: 403,
          }
        : {
            outcome: 'ALLOW',
            reasonCode: 'ALLOWED',
            reason: 'Bounded engineering within approved worktree scope.',
            actionKind: 'file_modification',
            canonicalKind: 'file_modification',
            riskTier: 'TIER_2_PERSISTENT_INTERNAL_MUTATION',
            technicalReach: 'WRITE_BOUNDED',
            policyAuthority: 'BOUNDED_ALLOWED',
            requiresApproval: false,
            approvalSatisfied: true,
            httpStatus: 200,
          }

      const meta = buildGovernedAuditMetadata({
        decision,
        requestedBy: input.requestedBy,
        actorAgent: 'ENGINEERING_AGENT',
        missionId: input.missionId ?? null,
        tool: 'ascension.engineering_agent.runBoundedEngineeringAgent',
        target: scope.task_description.slice(0, 200),
        ownerUserId: input.ownerUserId,
        evidenceRefs: filesModified.map(f => f.path).slice(0, 20),
        executionResult:
          status === 'DENIED' ? 'denied' : status === 'FAILED' ? 'failed' : 'executed',
      })

      await insertGovernedAuditLog(input.supabase ?? null, {
        actor: input.invokedBy === 'commander' ? 'user' : 'system',
        category: 'runtime',
        message: `ENGINEERING_AGENT ${status}: ${scope.task_description.slice(0, 200)}`,
        actionId: requestId,
        metadata: meta,
        extra: {
          invocation: input.invokedBy,
          status,
          worktree: scope.worktree_path,
          base_sha: scope.base_sha,
          allowed_paths: scope.allowed_paths,
          files_read: filesRead,
          files_changed: filesModified.map(f => ({
            path: f.path,
            before_hash: f.before_hash,
            after_hash: f.after_hash,
            bytes: f.bytes_changed,
          })),
          commands_requested: scope.allowed_validation_commands,
          commands_allowed: validationResults.filter(v => !v.denied).map(v => v.command_id),
          commands_denied: [
            ...validationResults.filter(v => v.denied).map(v => v.command_id),
            ...denials.map(d => d.capability_or_action),
          ],
          validation_results: validationResults.map(v => ({
            id: v.command_id,
            ok: v.ok,
            exit: v.exit_code,
          })),
          policy_decisions: denials.map(d => ({
            action: d.capability_or_action,
            reason_code: d.reason_code,
            reason: d.reason,
          })),
          // Explicitly omit private reasoning traces
          chain_of_thought: undefined,
        },
      })
      auditId = requestId
      result.audit_id = auditId
    } catch {
      warnings.push('Audit persistence unavailable — result still returned.')
    }

    // Restore agent-created fixtures if requested
    for (const m of input.mutations ?? []) {
      if (m.restoreAfter && agentCreated.includes(m.relativePath.replace(/\\/g, '/'))) {
        removeBoundedFile({
          worktreeAbs: scope.worktree_path,
          relativePath: m.relativePath,
          allowedPathPrefixes: scope.allowed_paths,
        })
      }
    }

    return result
  }

  if (!isEngineeringAgentRuntimeAvailable()) {
    denials.push({
      capability_or_action: 'RUNTIME',
      reason_code: 'UNAVAILABLE',
      reason: 'ENGINEERING_AGENT runtime disabled via ASCENSION_ENGINEERING_AGENT_ENABLED=false.',
    })
    return finish('DENIED', emptyScope())
  }

  if (!ascensionAutonomyIsOff() || ENGINEERING_AGENT_AUTONOMOUS_EXECUTION_ENABLED) {
    denials.push({
      capability_or_action: 'ASCENSION_AUTONOMY',
      reason_code: 'POLICY_DENIED',
      reason: 'Ascension autonomy must remain OFF.',
    })
    return finish('DENIED', emptyScope())
  }

  if (!input.taskDescription?.trim()) {
    denials.push({
      capability_or_action: 'TASK',
      reason_code: 'TARGET_OUT_OF_SCOPE',
      reason: 'task_description is required.',
    })
    return finish('DENIED', emptyScope())
  }

  if (!input.approvedWorktree?.trim()) {
    denials.push({
      capability_or_action: 'WORKTREE',
      reason_code: 'WORKTREE_REQUIRED',
      reason: 'Approved isolated worktree is required.',
    })
    return finish('DENIED', emptyScope())
  }

  if (!input.allowedPaths?.length) {
    denials.push({
      capability_or_action: 'ALLOWED_PATHS',
      reason_code: 'TARGET_OUT_OF_SCOPE',
      reason: 'allowed_paths must be non-empty — no open-ended modify scope.',
    })
    return finish('DENIED', emptyScope())
  }

  // Self-approval / privilege amplification red-team
  const selfApprove = assertEngineeringAgentCannotSelfApprove()
  if (selfApprove.outcome !== 'DENY' && selfApprove.reasonCode !== 'SELF_ESCALATION_DENIED') {
    /* assertNoSelfApproval returns decision with DENY */
  }
  if (input.attemptedAction === 'self_approve' || input.attemptedAction === 'APPROVAL_CHANGE') {
    denials.push(denialFromDecision('APPROVAL_CHANGE', selfApprove))
  }
  if (input.attemptedAction === 'policy_change' || input.attemptedAction === 'POLICY_CHANGE') {
    denials.push(denialFromDecision('POLICY_CHANGE', denyEngineeringAgentAction('POLICY_CHANGE')))
  }

  if (input.attemptedAction) {
    const d = denyEngineeringAgentAction(input.attemptedAction)
    denials.push(denialFromDecision(input.attemptedAction, d))
    if (
      [
        'GIT_COMMIT',
        'GIT_PUSH',
        'PRODUCTION_DEPLOY',
        'AGENT_SPAWN',
        'SQL_EXECUTE',
        'PRODUCTION_RESTART',
      ].includes(input.attemptedAction)
    ) {
      const scope = emptyScope()
      return finish('DENIED', scope, { planSummary: 'Denied dangerous attempted_action before worktree mutation.' })
    }
  }

  if (input.councilGrantPushOrDeploy) {
    denials.push({
      capability_or_action: 'COUNCIL_PUSH_DEPLOY',
      reason_code: 'COUNCIL_CANNOT_AUTHORIZE',
      reason: 'Council cannot grant push or deploy authority.',
    })
  }

  if (input.attemptedScopeExpansion) {
    denials.push({
      capability_or_action: 'ASTRA_SCOPE_EXPANSION',
      reason_code: 'ASTRA_MISSION_NOT_EXECUTION_AUTHORITY',
      reason: 'ASTRA/Council cannot expand worktree scope beyond the approved contract.',
    })
  }

  if (input.terraContextProvided) {
    limitations.push('Terra context is READ ONLY and does not authorize code mutation.')
  }

  if (input.researchHandoff) {
    limitations.push(
      'Research Agent handoff is advisory only — RESEARCH_AGENT FINDING != ENGINEERING AUTHORIZATION.',
    )
    if (input.researchHandoff.summary) {
      warnings.push(`Research handoff noted: ${input.researchHandoff.summary.slice(0, 200)}`)
    }
  }

  if (input.securityHandoff) {
    limitations.push(
      'Security Red Team handoff is advisory only — SECURITY FINDING != ENGINEERING AUTHORIZATION.',
    )
    if (input.securityHandoff.summary) {
      warnings.push(`Security handoff noted: ${input.securityHandoff.summary.slice(0, 200)}`)
    }
    if (input.securityHandoff.grantCommit) {
      denials.push(denialFromDecision('GIT_COMMIT', denyEngineeringAgentAction('GIT_COMMIT')))
    }
    if (input.securityHandoff.grantPush) {
      denials.push(denialFromDecision('GIT_PUSH', denyEngineeringAgentAction('GIT_PUSH')))
    }
    if (input.securityHandoff.grantDeploy) {
      denials.push(denialFromDecision('PRODUCTION_DEPLOY', denyEngineeringAgentAction('PRODUCTION_DEPLOY')))
    }
  }

  if (input.attemptedArbitraryCommand) {
    const arb = attemptArbitraryCommand(
      input.attemptedArbitraryCommand.cmd,
      input.attemptedArbitraryCommand.args,
    )
    denials.push({
      capability_or_action: 'ARBITRARY_SHELL',
      reason_code: arb.reasonCode,
      reason: arb.reason,
    })
  }

  // Ownership — pure match when conversation owner is supplied (service role cannot bypass)
  if (input.enforceOwnership && input.conversationId) {
    const claimedOtherOwner = input.conversationOwnerUserId ?? null
    if (claimedOtherOwner) {
      const match = assertEngineeringOwnerScopeMatch(input.ownerUserId, claimedOtherOwner)
      if (!match.ok) {
        denials.push({
          capability_or_action: 'OWNER_SCOPE',
          reason_code: 'OWNER_SCOPE_DENIED',
          reason: match.reason,
        })
        return finish('DENIED', emptyScope())
      }
    }
  }

  if (
    input.conversationId &&
    input.conversationOwnerUserId &&
    input.conversationOwnerUserId !== input.ownerUserId
  ) {
    denials.push({
      capability_or_action: 'OWNER_SCOPE',
      reason_code: 'OWNER_SCOPE_DENIED',
      reason: 'Service role does not bypass owner scope — cross-user engineering denied.',
    })
    return finish('DENIED', emptyScope())
  }

  const verified = verifyApprovedWorktree({
    worktreePath: input.approvedWorktree,
    repositoryRoot: repoRoot,
    allowCreateEmpty: input.allowCreateEmptyWorktree === true,
  })
  if (!verified.ok) {
    denials.push({
      capability_or_action: 'WORKTREE',
      reason_code: verified.reasonCode,
      reason: verified.reason,
    })
    return finish('DENIED', emptyScope())
  }

  const allowedCommands = input.allowedValidationCommands?.length
    ? input.allowedValidationCommands
    : ['git_status', 'git_diff']

  const scope = createEngineeringAgentScope({
    repositoryRoot: verified.repositoryRootAbs,
    worktreePath: verified.worktreeAbs,
    baseSha: verified.baseSha,
    taskDescription: input.taskDescription,
    allowedPaths: input.allowedPaths,
    allowedValidationCommands: allowedCommands,
    ownerUserId: input.ownerUserId,
    requestedBy: input.requestedBy,
    missionId: input.missionId,
    conversationId: input.conversationId,
    nowIso: startedAt,
  })

  // Attach preexisting dirty into result via finish — stash on scope side-channel
  const preexistingDirty = verified.preexistingDirty

  if (isEngineeringScopeExpired(scope)) {
    denials.push({
      capability_or_action: 'SCOPE',
      reason_code: 'APPROVAL_EXPIRED',
      reason: 'Engineering scope expired.',
    })
    const r = await finish('DENIED', scope)
    r.preexisting_dirty = preexistingDirty
    return r
  }

  // Probe denied path writes (red-team) without applying
  for (const badPath of input.attemptedWrites ?? []) {
    const probe = resolvePathInsideWorktree({
      worktreeAbs: verified.worktreeAbs,
      relativePath: badPath,
      allowedPathPrefixes: scope.allowed_paths,
    })
    if (!probe.ok) {
      denials.push({
        capability_or_action: `WRITE:${badPath}`,
        reason_code: probe.reasonCode,
        reason: probe.reason,
      })
    } else {
      denials.push({
        capability_or_action: `WRITE:${badPath}`,
        reason_code: 'POLICY_DENIED',
        reason: 'Attempted write path was unexpectedly resolvable — still not applied without mutation request.',
      })
    }
  }

  // Production checkout write denial probe
  const prodProbe = resolvePathInsideWorktree({
    worktreeAbs: verified.repositoryRootAbs,
    relativePath: 'lib/ascension/engineering-agent/__should_not_write.ts',
    allowedPathPrefixes: ['lib'],
  })
  // Writing to repo root as "worktree" must already fail verify; additionally deny mutating repo root
  if (path.resolve(verified.worktreeAbs) === path.resolve(verified.repositoryRootAbs)) {
    denials.push({
      capability_or_action: 'PRODUCTION_CHECKOUT',
      reason_code: 'PRODUCTION_CHECKOUT_WRITE_DENIED',
      reason: 'Cannot use production checkout as worktree.',
    })
    const r = await finish('DENIED', scope)
    r.preexisting_dirty = preexistingDirty
    return r
  }
  void prodProbe

  // Reads
  for (const rel of input.filesToRead ?? []) {
    const read = readBoundedFile({
      worktreeAbs: verified.worktreeAbs,
      relativePath: rel,
      allowedPathPrefixes: scope.allowed_paths,
    })
    if (read.ok) filesRead.push(read.rel)
    else {
      // Also allow reading from repository root for inspection (read-only) within allowed paths
      const repoRead = readBoundedFile({
        worktreeAbs: verified.repositoryRootAbs,
        relativePath: rel,
        allowedPathPrefixes: scope.allowed_paths,
      })
      if (repoRead.ok) {
        filesRead.push(`repo:${repoRead.rel}`)
      } else {
        warnings.push(`Read denied/missed: ${rel} (${read.reason})`)
      }
    }
  }

  // Mutations
  let mutationFailed = false
  let patchBytesTotal = 0
  for (const m of input.mutations ?? []) {
    if (filesModified.length >= scope.max_files_changed) {
      denials.push({
        capability_or_action: 'MAX_FILES',
        reason_code: 'TARGET_OUT_OF_SCOPE',
        reason: `max_files_changed (${scope.max_files_changed}) exceeded — new scoped request required.`,
      })
      mutationFailed = true
      break
    }

    const beforePath = resolvePathInsideWorktree({
      worktreeAbs: verified.worktreeAbs,
      relativePath: m.relativePath,
      allowedPathPrefixes: scope.allowed_paths,
    })
    if (!beforePath.ok) {
      denials.push({
        capability_or_action: `MODIFY:${m.relativePath}`,
        reason_code: beforePath.reasonCode,
        reason: beforePath.reason,
      })
      mutationFailed = true
      continue
    }

    let beforeHash: string | null = null
    if (existsSync(beforePath.abs)) {
      beforeHash = sha256(readFileSync(beforePath.abs, 'utf8'))
    }

    const bytes = Buffer.byteLength(m.content, 'utf8')
    if (bytes > scope.max_individual_file_bytes) {
      denials.push({
        capability_or_action: `MODIFY:${m.relativePath}`,
        reason_code: 'PATCH_SIZE_EXCEEDED',
        reason: `Individual file exceeds max_individual_file_bytes.`,
      })
      mutationFailed = true
      continue
    }
    patchBytesTotal += bytes
    if (patchBytesTotal > scope.max_patch_size) {
      denials.push({
        capability_or_action: 'MAX_PATCH',
        reason_code: 'PATCH_SIZE_EXCEEDED',
        reason: `max_patch_size (${scope.max_patch_size}) exceeded.`,
      })
      mutationFailed = true
      break
    }

    const written = writeBoundedFile({
      worktreeAbs: verified.worktreeAbs,
      relativePath: m.relativePath,
      allowedPathPrefixes: scope.allowed_paths,
      content: m.content,
      maxBytes: scope.max_individual_file_bytes,
    })
    if (!written.ok) {
      denials.push({
        capability_or_action: `MODIFY:${m.relativePath}`,
        reason_code: written.reasonCode,
        reason: written.reason,
      })
      mutationFailed = true
      continue
    }

    const afterHash = sha256(m.content)
    const change: EngineeringFileChange = {
      path: written.rel,
      before_hash: beforeHash,
      after_hash: afterHash,
      bytes_changed: written.bytes,
      agent_created: beforeHash === null,
    }
    filesModified.push(change)
    agentCreated.push(written.rel)
    boundedDiff += `--- a/${written.rel}\n+++ b/${written.rel}\n@@ agent bounded write @@\nbefore:${beforeHash ?? '(new)'}\nafter:${afterHash}\nbytes:${written.bytes}\n\n`
  }

  // Runtime bound
  if (Date.now() - startedMs > scope.max_runtime_ms) {
    denials.push({
      capability_or_action: 'MAX_RUNTIME',
      reason_code: 'POLICY_DENIED',
      reason: `max_runtime_ms (${scope.max_runtime_ms}) exceeded.`,
    })
    const r = await finish('FAILED', scope)
    r.preexisting_dirty = preexistingDirty
    return r
  }

  // Validation commands (allowlisted only)
  let validationFailed = false
  let commandsRun = 0
  for (const cmdId of scope.allowed_validation_commands) {
    if (commandsRun >= scope.max_validation_commands) {
      denials.push({
        capability_or_action: 'MAX_COMMANDS',
        reason_code: 'TARGET_OUT_OF_SCOPE',
        reason: `max_validation_commands (${scope.max_validation_commands}) exceeded.`,
      })
      break
    }
    const result = await runApprovedEngineeringCommand({
      commandId: cmdId,
      cwd: verified.worktreeAbs,
      repositoryRoot: verified.repositoryRootAbs,
    })
    validationResults.push(result)
    commandsRun += 1
    if (result.denied) {
      denials.push({
        capability_or_action: `CMD:${cmdId}`,
        reason_code: 'POLICY_DENIED',
        reason: result.deny_reason ?? 'Command denied.',
      })
      validationFailed = true
    } else if (!result.ok && (cmdId === 'typecheck' || cmdId === 'build' || cmdId === 'lint')) {
      // Soft-fail git status in empty fixture worktrees
      validationFailed = true
    }
  }

  // Distinguish preexisting dirty
  const agentSet = new Set(agentCreated)
  const preexistingOnly = preexistingDirty.filter(p => !agentSet.has(p.replace(/\\/g, '/')))

  const status = classifyEngineeringStatus({
    denied: denials.some(d =>
      ['PRODUCTION_CHECKOUT_WRITE_DENIED', 'WORKTREE_REQUIRED', 'WORKTREE_MISSING', 'OWNER_SCOPE_DENIED'].includes(
        d.reason_code,
      ),
    ) && filesModified.length === 0 && mutationFailed,
    worktreeFailed: false,
    mutationFailed,
    validationFailed,
    validationSkipped: scope.allowed_validation_commands.length === 0,
    filesModified: filesModified.length,
  })

  // Failed validation must not claim COMPLETE
  let finalStatus = status
  if (validationFailed && finalStatus === 'COMPLETE') finalStatus = 'FAILED'
  if (input.councilGrantPushOrDeploy || input.attemptedScopeExpansion) {
    // Advisory denials only — do not void otherwise successful bounded work unless no mutations
    if (filesModified.length === 0 && denials.length > 0) finalStatus = 'DENIED'
  }
  if (denials.some(d => d.capability_or_action === 'ARBITRARY_SHELL') && filesModified.length === 0) {
    finalStatus = 'DENIED'
  }

  // Reclassify more carefully
  if (filesModified.length > 0 && !mutationFailed && !validationFailed) {
    finalStatus = 'COMPLETE'
  } else if (filesModified.length > 0 && validationFailed) {
    finalStatus = 'FAILED'
  } else if (mutationFailed && filesModified.length === 0) {
    finalStatus = denials.some(d => d.reason_code.includes('DENIED') || d.reason_code.includes('ESCAPE') || d.reason_code.includes('TRAVERSAL') || d.reason_code === 'SENSITIVE_PATH_DENIED' || d.reason_code === 'NON_APPROVED_PATH_DENIED' || d.reason_code === 'PRODUCTION_CHECKOUT_WRITE_DENIED')
      ? 'DENIED'
      : 'FAILED'
  }

  const r = await finish(finalStatus, scope, {
    planSummary: `Task: ${scope.task_description.slice(0, 120)}. Files modified: ${filesModified.length}. Validations: ${validationResults.length}.`,
  })
  r.preexisting_dirty = preexistingOnly
  return r
}

export function engineeringAgentResultForCouncil(result: EngineeringAgentResult) {
  return {
    agent_role: result.agent_role,
    status: result.status,
    task: result.task,
    diff_summary: result.diff_summary,
    files_modified: result.files_modified.map(f => f.path),
    validation_ok: result.validation_results.every(v => v.ok || v.command_id.startsWith('git_')),
    denials: result.denials,
    limitations: result.limitations,
    boundary_notes: result.boundary_notes,
    audit_id: result.audit_id,
  }
}

export function engineeringAgentResultForAstra(result: EngineeringAgentResult) {
  return {
    ...engineeringAgentResultForCouncil(result),
    base_sha: result.base_sha,
    worktree: result.worktree,
    bounded_diff: result.bounded_diff.slice(0, 8_000),
    agent_created_changes: result.agent_created_changes,
    preexisting_dirty: result.preexisting_dirty,
  }
}
