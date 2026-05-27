/**
 * Automated verification for known operator-gap repairs (static UI / session context).
 * Never marks fixed without passing checks — see applyGapVerification in gapFinder.
 */

export const KNOWN_GAP_IDS = {
  OLD_DIAGNOSTICS_UX: 'old-diagnostics-old-diagnostic-notices-visible',
  ARCHIVE_COPY_CLARITY: 'confusing-ui-older-messages-hidden-from-live-view',
} as const

export type KnownGapId = (typeof KNOWN_GAP_IDS)[keyof typeof KNOWN_GAP_IDS]

export type GapVerificationContext = {
  /** Operator live view hides legacy diagnostics when false (default). */
  showOldDiagnosticsDefault: boolean
  hasShowOldDiagnosticsToggle: boolean
  hasCopyVisibleLogHint: boolean
  hasCopySessionHint: boolean
  hiddenMessageCount: number
  /** Archive banner copy when messages are hidden from live view. */
  hasArchivedCountBanner: boolean
}

export type GapVerificationResult = {
  gapId: KnownGapId
  verified: boolean
  evidence: string[]
}

export function verifyKnownGaps(ctx: GapVerificationContext): GapVerificationResult[] {
  const oldDiagnosticsEvidence: string[] = []
  if (ctx.showOldDiagnosticsDefault === false) {
    oldDiagnosticsEvidence.push('Old diagnostics hidden by default in Operator View')
  }
  if (ctx.hasShowOldDiagnosticsToggle) {
    oldDiagnosticsEvidence.push('"Show old diagnostics" toggle is present in live council')
  }
  const oldDiagnosticsVerified =
    ctx.showOldDiagnosticsDefault === false &&
    ctx.hasShowOldDiagnosticsToggle &&
    oldDiagnosticsEvidence.length >= 2

  const archiveEvidence: string[] = []
  if (ctx.hasCopyVisibleLogHint) {
    archiveEvidence.push('Copy Visible Log includes an on-screen-only hint')
  }
  if (ctx.hasCopySessionHint) {
    archiveEvidence.push('Copy Session includes full-transcript hint')
  }
  if (ctx.hiddenMessageCount > 0 && ctx.hasArchivedCountBanner) {
    archiveEvidence.push(
      `Archived count note shown (${ctx.hiddenMessageCount} message${ctx.hiddenMessageCount === 1 ? '' : 's'} hidden from live view)`,
    )
  }
  const archiveNeedsBanner = ctx.hiddenMessageCount > 0
  const archiveVerified =
    ctx.hasCopyVisibleLogHint &&
    ctx.hasCopySessionHint &&
    (!archiveNeedsBanner || ctx.hasArchivedCountBanner)

  return [
    {
      gapId: KNOWN_GAP_IDS.OLD_DIAGNOSTICS_UX,
      verified: oldDiagnosticsVerified,
      evidence: oldDiagnosticsVerified ? oldDiagnosticsEvidence : [],
    },
    {
      gapId: KNOWN_GAP_IDS.ARCHIVE_COPY_CLARITY,
      verified: archiveVerified,
      evidence: archiveVerified ? archiveEvidence : [],
    },
  ]
}
