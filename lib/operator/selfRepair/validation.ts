import { KNOWN_GAP_IDS, verifyKnownGaps, type KnownGapId } from '../gapVerification'
import { resolveOperatorGaps, type GapFinderContext, type OperatorGap } from '../gapFinder'
import type { LegacyRepairValidationResult, RepairValidationResult, SelfRepairRecord } from './types'

function isKnownGapId(id: string): id is KnownGapId {
  return id === KNOWN_GAP_IDS.OLD_DIAGNOSTICS_UX || id === KNOWN_GAP_IDS.ARCHIVE_COPY_CLARITY
}

function gapById(gaps: OperatorGap[], gapId: string): OperatorGap | undefined {
  return gaps.find(g => g.id === gapId)
}

export function validateRepairAgainstGaps(
  record: SelfRepairRecord,
  ctx: GapFinderContext,
): RepairValidationResult {
  const checkedAt = new Date().toISOString()
  const evidence: string[] = []
  const gapId = record.gapId || record.plan.sourceId
  const gaps = resolveOperatorGaps(ctx)
  const gap = gapById(gaps, gapId)

  let knownGapVerified = false
  if (ctx.gapVerification && isKnownGapId(gapId)) {
    const verification = verifyKnownGaps(ctx.gapVerification).find(row => row.gapId === gapId)
    if (verification?.verified && verification.evidence.length) {
      knownGapVerified = true
      evidence.push(...verification.evidence.map(line => `[known-gap] ${line}`))
    } else if (verification) {
      evidence.push(`Known gap "${gapId}" not yet passing automated checks`)
    }
  }

  let gapStillOpen = false
  if (gap) {
    if (gap.status === 'fixed') {
      evidence.push(`Self-audit: gap "${gap.title}" marked fixed`)
      if (gap.verificationEvidence?.length) {
        evidence.push(...gap.verificationEvidence.map(line => `[self-audit] ${line}`))
      }
    } else if (gap.status === 'needs_review') {
      evidence.push('Gap awaits Commander review after manual fix')
      gapStillOpen = true
    } else {
      gapStillOpen = true
      evidence.push(`Self-audit: gap still open (${gap.status})`)
    }
  } else {
    evidence.push('Gap no longer reported by self-audit heuristics')
  }

  const verified =
    !gapStillOpen &&
    (knownGapVerified || gap?.status === 'fixed' || (!gap && evidence.length > 0))

  return {
    outcome: verified ? 'verified' : 'failed',
    checkedAt,
    evidence,
    gapStillOpen,
    knownGapVerified,
  }
}

export function formatValidationSummary(result: RepairValidationResult): string {
  const status =
    result.outcome === 'verified' ? 'PASSED' : result.outcome === 'cannot_verify' ? 'CANNOT VERIFY' : 'FAILED'
  const lines = [
    `Validation ${status} @ ${result.checkedAt}`,
    '',
    ...result.evidence.map(line => `- ${line}`),
  ]
  return lines.join('\n')
}

/** What to actually show for a stored validation record, whichever shape it's in. Distinct from
 * `RepairValidationOutcome` because 'legacy_passed'/'legacy_failed' must never be conflated with
 * current 'verified'/'failed' (the legacy shape carries no fresh-check guarantee at all — it may
 * predate refresh-first validation entirely) and must never silently collapse into 'failed' just
 * because the modern `outcome` field happens to be absent. */
export type ValidationDisplayState =
  | 'verified'
  | 'failed'
  | 'cannot_verify'
  | 'legacy_passed'
  | 'legacy_failed'
  | 'unavailable'

/** Duck-types the stored record: current shape always has a defined `outcome`; legacy records
 * have `verified` instead. Checks `outcome` first so any current record — including one that
 * happens to also carry a stray `verified` key — is read as current, never legacy. */
export function describeValidationForDisplay(
  validation: RepairValidationResult | LegacyRepairValidationResult | undefined,
): ValidationDisplayState {
  if (!validation) return 'unavailable'
  if ('outcome' in validation && validation.outcome !== undefined) {
    return validation.outcome
  }
  if ('verified' in validation && typeof validation.verified === 'boolean') {
    return validation.verified ? 'legacy_passed' : 'legacy_failed'
  }
  return 'unavailable'
}

const VALIDATION_DISPLAY_LABELS: Record<ValidationDisplayState, string> = {
  verified: 'passed',
  failed: 'failed',
  cannot_verify: 'cannot verify',
  legacy_passed: 'passed (previous format)',
  legacy_failed: 'failed (previous format)',
  unavailable: 'unavailable',
}

export function validationDisplayLabel(
  validation: RepairValidationResult | LegacyRepairValidationResult | undefined,
): string {
  return VALIDATION_DISPLAY_LABELS[describeValidationForDisplay(validation)]
}
