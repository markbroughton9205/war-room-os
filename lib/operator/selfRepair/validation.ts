import { KNOWN_GAP_IDS, verifyKnownGaps, type KnownGapId } from '../gapVerification'
import { resolveOperatorGaps, type GapFinderContext, type OperatorGap } from '../gapFinder'
import type { RepairValidationResult, SelfRepairRecord } from './types'

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
    verified,
    checkedAt,
    evidence,
    gapStillOpen,
    knownGapVerified,
  }
}

export function formatValidationSummary(result: RepairValidationResult): string {
  const status = result.verified ? 'PASSED' : 'FAILED'
  const lines = [
    `Validation ${status} @ ${result.checkedAt}`,
    '',
    ...result.evidence.map(line => `- ${line}`),
  ]
  return lines.join('\n')
}
