'use client'

import { memo, useCallback, useEffect, useMemo, useState } from 'react'

import { CopyCouncilButton } from '@/components/war-room/council/CopyCouncilButton'
import { useMatrixStatus } from '@/hooks/useMatrixStatus'
import { formatMergedSourcesLine } from '@/lib/operator/canonicalIssues'
import {
  COMMANDER_MANUAL_FIX_EVIDENCE,
  countOpenOperatorGaps,
  formatGapReport,
  resolveOperatorGaps,
  type CanonicalGapSnapshot,
  type GapFinderContext,
  type GapStatus,
  type OperatorGap,
} from '@/lib/operator/gapFinder'
import {
  inboxExtrasFromGapContext,
  syncOperatorInboxFromGaps,
  type OperatorInboxSnapshot,
} from '@/lib/operator/inbox'
import {
  formatSelfAuditReport,
  gapsBySelfAuditSection,
  topSelfAuditCursorCommand,
} from '@/lib/operator/selfAudit'
import type { SelfRepairSnapshot } from '@/lib/operator/selfRepair'
import type { UpgradeQueueSnapshot } from '@/lib/operator/upgradeQueue'
import { SelfRepairActions } from './SelfRepairActions'

export type GapFinderPanelProps = {
  context: GapFinderContext
  onGapCountChange?: (count: number) => void
  onInboxSnapshotChange?: (snapshot: OperatorInboxSnapshot) => void
  onCommanderManualFix?: (gapId: string) => void
  onCommanderDismiss?: (gapId: string) => void
  repairSnapshot?: SelfRepairSnapshot
  onRepairSnapshotChange?: (snapshot: SelfRepairSnapshot) => void
  onUpgradeQueueChange?: (snapshot: UpgradeQueueSnapshot) => void
}

const SECTION_ORDER = [
  'Open Issues',
  'Suggestions',
  'Duplicates',
  'Placeholders',
  'Mobile Risks',
  'Revenue Gaps',
  'Fixed Recently',
  'Other',
] as const

export const GapFinderPanel = memo(function GapFinderPanel({
  context,
  onGapCountChange,
  onInboxSnapshotChange,
  onCommanderManualFix,
  onCommanderDismiss,
  repairSnapshot,
  onRepairSnapshotChange,
  onUpgradeQueueChange,
}: GapFinderPanelProps) {
  const { signalSuccess, signalError, signalWorking } = useMatrixStatus()
  const [canonical, setCanonical] = useState<CanonicalGapSnapshot | null>(context.canonicalStatus ?? null)
  const [canonicalFailed, setCanonicalFailed] = useState(context.canonicalStatusUnavailable ?? false)
  const [scanning, setScanning] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [recheckToken, setRecheckToken] = useState(0)

  const mergedContext = useMemo<GapFinderContext>(
    () => ({
      ...context,
      canonicalStatus: canonical ?? context.canonicalStatus,
      canonicalStatusUnavailable: canonicalFailed,
    }),
    [canonical, canonicalFailed, context],
  )

  const gaps = useMemo(() => {
    void recheckToken
    return resolveOperatorGaps(mergedContext)
  }, [mergedContext, recheckToken])

  const syncInbox = useCallback(
    (resolved: ReturnType<typeof resolveOperatorGaps>) => {
      const snapshot = syncOperatorInboxFromGaps(resolved, {
        extras: inboxExtrasFromGapContext(mergedContext),
        commanderManualFixedAt: mergedContext.commanderManualFixedAt as Record<string, string>,
        commanderDismissedIds: mergedContext.commanderDismissedIds as Record<string, string>,
      })
      onInboxSnapshotChange?.(snapshot)
      return snapshot
    },
    [mergedContext, onInboxSnapshotChange],
  )

  useEffect(() => {
    syncInbox(gaps)
  }, [gaps, syncInbox])

  const sections = useMemo(() => gapsBySelfAuditSection(gaps), [gaps])
  const openCount = useMemo(() => countOpenOperatorGaps(gaps), [gaps])
  const fixedCount = useMemo(() => gaps.filter(g => g.status === 'fixed').length, [gaps])
  const reviewCount = useMemo(
    () => gaps.filter(g => g.status === 'needs_review').length,
    [gaps],
  )

  useEffect(() => {
    onGapCountChange?.(openCount)
  }, [openCount, onGapCountChange])

  const recheckAfterFix = useCallback(() => {
    setRecheckToken(token => token + 1)
    signalSuccess('Self-audit rechecked after fix')
  }, [signalSuccess])

  const markFixedManually = useCallback(
    (gapId: string) => {
      onCommanderManualFix?.(gapId)
      setRecheckToken(token => token + 1)
      signalSuccess('Marked for Commander review')
    },
    [onCommanderManualFix, signalSuccess],
  )

  const markNotImportant = useCallback(
    (gapId: string) => {
      onCommanderDismiss?.(gapId)
      setRecheckToken(token => token + 1)
      signalSuccess('Marked not important')
    },
    [onCommanderDismiss, signalSuccess],
  )

  const runSelfAuditScan = useCallback(async () => {
    setScanning(true)
    signalWorking('Running self-audit…')
    try {
      let snapshot: CanonicalGapSnapshot | null = mergedContext.canonicalStatus ?? null
      const res = await fetch('/api/runtime/canonical-status', { cache: 'no-store' })
      if (!res.ok) {
        setCanonicalFailed(true)
        setCanonical(null)
        snapshot = null
        signalError('Canonical status unavailable — local heuristics only')
      } else {
        snapshot = (await res.json()) as CanonicalGapSnapshot
        setCanonical(snapshot)
        setCanonicalFailed(false)
      }
      setRecheckToken(token => token + 1)
      const resolved = resolveOperatorGaps({
        ...mergedContext,
        canonicalStatus: snapshot,
        canonicalStatusUnavailable: !res.ok,
      })
      syncInbox(resolved)
      signalSuccess(
        `Self-audit complete · ${countOpenOperatorGaps(resolved)} open · ${resolved.filter(g => g.status === 'fixed').length} fixed`,
      )
    } catch {
      setCanonicalFailed(true)
      signalError('Self-audit scan failed')
    } finally {
      setScanning(false)
    }
  }, [mergedContext, signalError, signalSuccess, signalWorking, syncInbox])

  const refreshCanonical = useCallback(async () => {
    await runSelfAuditScan()
  }, [runSelfAuditScan])

  return (
    <section
      className="rounded border border-fuchsia-500/25 bg-black/30 p-3"
      data-testid="gap-finder-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-fuchsia-200">
            War Room Self-Audit
          </p>
          <p className="mt-1 text-[9px] tracking-wide text-slate-500">
            UI, runtime, and state heuristics only — no provider completions. Fixed status requires
            evidence.
          </p>
        </div>
        <span
          className="rounded-full px-2 py-0.5 text-[9px] font-bold tracking-widest"
          style={{
            border: openCount ? '1px solid rgba(248,113,113,0.5)' : '1px solid rgba(52,211,153,0.4)',
            color: openCount ? '#FCA5A5' : '#86EFAC',
          }}
        >
          {openCount} open · {fixedCount} fixed · {reviewCount} review
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={scanning}
          className="min-h-[32px] rounded px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest"
          style={{ border: '1px solid rgba(217,70,239,0.45)', color: '#E879F9', background: 'rgba(0,0,0,0.35)' }}
          onClick={() => void refreshCanonical()}
          data-testid="self-audit-run"
        >
          {scanning ? 'Auditing…' : 'Run Self-Audit'}
        </button>
        <button
          type="button"
          className="min-h-[32px] rounded px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest"
          style={{ border: '1px solid rgba(52,211,153,0.45)', color: '#86EFAC', background: 'rgba(0,0,0,0.35)' }}
          onClick={recheckAfterFix}
          data-testid="self-audit-recheck"
        >
          Recheck After Fix
        </button>
        <CopyCouncilButton
          label="Copy Gap Report"
          getText={() => formatGapReport(gaps)}
          successMessage="Copied"
          manualTitle="Gap report"
        />
        <CopyCouncilButton
          label="Copy Self-Audit Report"
          getText={() => formatSelfAuditReport(gaps)}
          successMessage="Copied"
          manualTitle="Self-audit report"
        />
        <CopyCouncilButton
          label="Copy Top Cursor Command"
          getText={() => topSelfAuditCursorCommand(gaps) ?? ''}
          successMessage="Copied"
          manualTitle="Top Cursor command"
          variant="accent"
        />
        <button
          type="button"
          className="min-h-[32px] rounded px-2 py-1.5 text-[9px] tracking-widest text-slate-500"
          onClick={() => setExpanded(prev => !prev)}
        >
          {expanded ? 'Hide sections' : 'Show sections'}
        </button>
      </div>

      {expanded ? (
        <div className="mt-3 max-h-96 space-y-4 overflow-y-auto text-[10px]">
          {SECTION_ORDER.map(sectionTitle => {
            const items = sections[sectionTitle]
            if (!items?.length) return null
            return (
              <SelfAuditSection
                key={sectionTitle}
                title={sectionTitle}
                gaps={items}
                onMarkFixedManually={markFixedManually}
                onMarkNotImportant={markNotImportant}
                gapFinderContext={mergedContext}
                repairSnapshot={repairSnapshot}
                onRepairSnapshotChange={onRepairSnapshotChange}
                onUpgradeQueueChange={onUpgradeQueueChange}
              />
            )
          })}
          {!gaps.length ? (
            <p className="text-slate-500">No findings with current heuristics.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
})

function SelfAuditSection({
  title,
  gaps,
  onMarkFixedManually,
  onMarkNotImportant,
  gapFinderContext,
  repairSnapshot,
  onRepairSnapshotChange,
  onUpgradeQueueChange,
}: {
  title: string
  gaps: OperatorGap[]
  onMarkFixedManually: (gapId: string) => void
  onMarkNotImportant: (gapId: string) => void
  gapFinderContext: GapFinderContext
  repairSnapshot?: SelfRepairSnapshot
  onRepairSnapshotChange?: (snapshot: SelfRepairSnapshot) => void
  onUpgradeQueueChange?: (snapshot: UpgradeQueueSnapshot) => void
}) {
  return (
    <div data-testid={`self-audit-section-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <p className="mb-2 text-[9px] font-bold uppercase tracking-widest text-fuchsia-200/90">
        {title} ({gaps.length})
      </p>
      <ul className="space-y-2">
        {gaps.map(g => (
          <GapRow
            key={g.id}
            gap={g}
            onMarkFixedManually={onMarkFixedManually}
            onMarkNotImportant={onMarkNotImportant}
            gapFinderContext={gapFinderContext}
            repairSnapshot={repairSnapshot}
            onRepairSnapshotChange={onRepairSnapshotChange}
            onUpgradeQueueChange={onUpgradeQueueChange}
          />
        ))}
      </ul>
    </div>
  )
}

function GapRow({
  gap,
  onMarkFixedManually,
  onMarkNotImportant,
  gapFinderContext,
  repairSnapshot,
  onRepairSnapshotChange,
  onUpgradeQueueChange,
}: {
  gap: OperatorGap
  onMarkFixedManually: (gapId: string) => void
  onMarkNotImportant: (gapId: string) => void
  gapFinderContext: GapFinderContext
  repairSnapshot?: SelfRepairSnapshot
  onRepairSnapshotChange?: (snapshot: SelfRepairSnapshot) => void
  onUpgradeQueueChange?: (snapshot: UpgradeQueueSnapshot) => void
}) {
  const severityColor =
    gap.severity === 'high' ? '#F87171' : gap.severity === 'medium' ? '#FBBF24' : '#94A3B8'
  const statusColor = statusBadgeColor(gap.status)

  return (
    <li className="rounded border border-white/10 bg-black/40 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold tracking-widest text-slate-200">{gap.title}</span>
        <span className="text-[8px] uppercase tracking-widest" style={{ color: severityColor }}>
          {gap.severity}
        </span>
        <span className="text-[8px] uppercase tracking-widest" style={{ color: statusColor }}>
          {gap.status.replace('_', ' ')}
        </span>
        <span className="text-[8px] uppercase tracking-widest text-slate-600">{gap.category}</span>
      </div>
      <p className="mt-1 text-emerald-100/90">{gap.plainLanguage}</p>
      <p className="mt-1 text-slate-500">{gap.meaning}</p>
      {formatMergedSourcesLine(gap) ? (
        <p className="mt-1 text-[8px] text-sky-300/70">{formatMergedSourcesLine(gap)}</p>
      ) : null}
      <p className="mt-1 text-[9px] text-emerald-200/80">{gap.recommendedFix}</p>
      {gap.verificationEvidence?.length ? (
        <ul className="mt-2 list-inside list-disc text-[9px] text-sky-200/80">
          {gap.verificationEvidence.map(line => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {gap.lastCheckedAt ? (
        <p className="mt-1 text-[8px] text-slate-600">Last checked: {gap.lastCheckedAt}</p>
      ) : null}
      {gap.status === 'open' ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className="min-h-[28px] rounded px-2 py-1 text-[8px] font-bold uppercase tracking-widest"
            style={{ border: '1px solid rgba(251,191,36,0.45)', color: '#FCD34D' }}
            onClick={() => onMarkFixedManually(gap.id)}
            title={COMMANDER_MANUAL_FIX_EVIDENCE}
          >
            Mark Fixed Manually
          </button>
          <button
            type="button"
            className="min-h-[28px] rounded px-2 py-1 text-[8px] font-bold uppercase tracking-widest"
            style={{ border: '1px solid rgba(148,163,184,0.45)', color: '#94A3B8' }}
            onClick={() => onMarkNotImportant(gap.id)}
          >
            Mark as Not Important
          </button>
        </div>
      ) : null}
      {repairSnapshot && onRepairSnapshotChange ? (
        <SelfRepairActions
          source={{ type: 'gap', gap }}
          gapFinderContext={gapFinderContext}
          repairSnapshot={repairSnapshot}
          onRepairSnapshotChange={onRepairSnapshotChange}
          onUpgradeQueueChange={onUpgradeQueueChange}
          compact
        />
      ) : null}
    </li>
  )
}

function statusBadgeColor(status: GapStatus): string {
  if (status === 'fixed') return '#86EFAC'
  if (status === 'needs_review') return '#FCD34D'
  return '#FCA5A5'
}
