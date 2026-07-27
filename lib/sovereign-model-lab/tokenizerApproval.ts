/**
 * Commander approval gate for real tokenizer training (Part 8), plus the Commander-addendum
 * pre-spawn freshness recheck: immediately before a subprocess is ever spawned,
 * tokenizerRuntime.ts MUST call assertFreshBeforeSpawn and abort if anything has drifted since
 * approval — the corpus manifest on disk, the plan object, or the approval's own binding.
 *
 * Uses a real SHA-256 over the canonicalized immutable plan fields (unlike
 * lib/council/approved-call/ExplicitExecutionApproval.ts's toy 32-bit hash, which is not an
 * adequate model for gating real process execution). Mirrors
 * lib/council/approved-call/ApprovalVerifier.ts's any-field-mismatch-rejects shape.
 */
import { createHash, randomUUID } from 'node:crypto'
import type { CorpusManifest, PreflightCheckResult, TokenizerExecutionPlan, TokenizerTrainingApproval } from './types'

function sha256(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex')
}

type ImmutablePlanFields = Omit<TokenizerExecutionPlan, 'planId' | 'createdAt' | 'planHash'>

/** Picks exactly the fields that make a plan immutable/hashable — planId/createdAt/planHash are
 * identifiers and metadata, not execution-affecting content, so they're excluded explicitly here
 * rather than via a destructure-and-omit (which this project's lint config flags as unused vars). */
function immutablePlanFields(plan: TokenizerExecutionPlan | Omit<TokenizerExecutionPlan, 'planHash'>): ImmutablePlanFields {
  return {
    corpusVersion: plan.corpusVersion,
    corpusManifestId: plan.corpusManifestId,
    corpusClassification: plan.corpusClassification,
    corpusDocumentCount: plan.corpusDocumentCount,
    corpusByteCount: plan.corpusByteCount,
    estimatedTokens: plan.estimatedTokens,
    algorithm: plan.algorithm,
    requestedVocabSize: plan.requestedVocabSize,
    recommendedVocabSize: plan.recommendedVocabSize,
    vocabSizeAdjustedReason: plan.vocabSizeAdjustedReason,
    minimumFrequency: plan.minimumFrequency,
    seed: plan.seed,
    executablePath: plan.executablePath,
    argv: plan.argv,
    outputDir: plan.outputDir,
    manifestOutputPath: plan.manifestOutputPath,
    maxRuntimeMs: plan.maxRuntimeMs,
    cpuLimit: plan.cpuLimit,
    ramCeilingBytes: plan.ramCeilingBytes,
    networkPolicy: plan.networkPolicy,
    expectedArtifacts: plan.expectedArtifacts,
  }
}

function canonicalPlanPayload(plan: ImmutablePlanFields): string {
  return JSON.stringify(plan, Object.keys(plan).sort())
}

export function computePlanHash(plan: ImmutablePlanFields): string {
  return sha256(canonicalPlanPayload(plan))
}

/** Builds a plan with its planHash populated from its own immutable fields — the one place a
 * TokenizerExecutionPlan is allowed to be constructed. */
export function finalizePlanWithHash(plan: Omit<TokenizerExecutionPlan, 'planHash'>): TokenizerExecutionPlan {
  return { ...plan, planHash: computePlanHash(immutablePlanFields(plan)) }
}

export function createTokenizerApproval(plan: TokenizerExecutionPlan, corpusManifest: CorpusManifest): TokenizerTrainingApproval {
  return {
    approvalId: randomUUID(),
    planId: plan.planId,
    planHash: plan.planHash,
    corpusManifestChecksumAtApproval: corpusManifest.manifestChecksum,
    approvedAt: new Date().toISOString(),
    approvedBy: 'commander',
    singleUse: true,
    consumedAt: null,
  }
}

/** Recomputes the plan's own hash from its current fields and compares against both the plan's
 * stored planHash and the approval's bound planHash — rejects on ANY mismatch, exactly mirroring
 * ApprovalVerifier's discipline. Does not check corpus freshness (see assertFreshBeforeSpawn for
 * that additional disk-level recheck). */
export function verifyTokenizerApproval(approval: TokenizerTrainingApproval, currentPlan: TokenizerExecutionPlan): PreflightCheckResult {
  if (approval.consumedAt) {
    return { ok: false, reason: 'approval_already_consumed', detail: `Approval ${approval.approvalId} was already consumed at ${approval.consumedAt}.` }
  }
  if (approval.planId !== currentPlan.planId) {
    return { ok: false, reason: 'approval_plan_mismatch', detail: 'Approval is scoped to a different plan than the one currently active.' }
  }
  const recomputedHash = computePlanHash(immutablePlanFields(currentPlan))
  if (recomputedHash !== currentPlan.planHash) {
    return { ok: false, reason: 'plan_hash_mismatch', detail: 'The current plan\'s recomputed hash does not match its own stored planHash — the plan object was mutated after creation.' }
  }
  if (approval.planHash !== currentPlan.planHash) {
    return { ok: false, reason: 'approval_plan_hash_mismatch', detail: 'The approval\'s bound planHash does not match the current plan\'s hash — the plan changed after approval, invalidating it.' }
  }
  return { ok: true }
}

/**
 * Commander addendum: called by tokenizerRuntime.ts immediately before spawning the training
 * subprocess — never earlier, never cached. Recomputes the plan hash and the approval binding
 * (via verifyTokenizerApproval) AND independently rechecks the corpus manifest checksum against
 * what was true at approval time. Any mismatch aborts execution; the approval is invalid and a new
 * approval must be requested against a freshly created plan.
 */
export function assertFreshBeforeSpawn(args: {
  plan: TokenizerExecutionPlan
  approval: TokenizerTrainingApproval
  currentCorpusManifest: CorpusManifest
}): PreflightCheckResult {
  const approvalCheck = verifyTokenizerApproval(args.approval, args.plan)
  if (!approvalCheck.ok) return approvalCheck

  if (args.currentCorpusManifest.version !== args.plan.corpusVersion) {
    return {
      ok: false,
      reason: 'corpus_manifest_hash_mismatch',
      detail: `Corpus version at execution time (${args.currentCorpusManifest.version}) does not match the plan's corpus version (${args.plan.corpusVersion}).`,
    }
  }

  if (args.currentCorpusManifest.manifestChecksum !== args.approval.corpusManifestChecksumAtApproval) {
    return {
      ok: false,
      reason: 'corpus_manifest_hash_mismatch',
      detail: `Corpus manifest checksum changed since approval (approved ${args.approval.corpusManifestChecksumAtApproval.slice(0, 12)}…, now ${args.currentCorpusManifest.manifestChecksum.slice(0, 12)}…). Approval is invalid — request a new one.`,
    }
  }

  return { ok: true }
}

export function consumeApproval(approval: TokenizerTrainingApproval): TokenizerTrainingApproval {
  return { ...approval, consumedAt: new Date().toISOString() }
}
