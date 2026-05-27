'use client'

import { memo, useCallback, useEffect, useMemo, useState } from 'react'

import { CopyCouncilButton } from '@/components/war-room/council/CopyCouncilButton'
import { useMatrixStatus } from '@/hooks/useMatrixStatus'
import {
  COMMANDER_MANUAL_FIX_EVIDENCE,
  countOpenOperatorGaps,
  formatGapReport,
  resolveOperatorGaps,
  topGapCursorCommand,
  type CanonicalGapSnapshot,
  type GapFinderContext,
  type GapStatus,
  type OperatorGap,
} from '@/lib/operator/gapFinder'

export type GapFinderPanelProps = {
  context: GapFinderContext
  onGapCountChange?: (count: number) => void
}

export const GapFinderPanel = memo(function GapFinderPanel({
  context,
  onGapCountChange,
}: GapFinderPanelProps) {
  const { signalSuccess, signalError, signalWorking } = useMatrixStatus()
  const [canonical, setCanonical] = useState<CanonicalGapSnapshot | null>(context.canonicalStatus ?? null)
  const [canonicalFailed, setCanonicalFailed] = useState(context.canonicalStatusUnavailable ?? false)
  const [scanning, setScanning] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [recheckToken, setRecheckToken] = useState(0)
  const [commanderManualFixedAt, setCommanderManualFixedAt] = useState<
    Partial<Record<string, string>>
  >(context.commanderManualFixedAt ?? {})

  const mergedContext = useMemo<GapFinderContext>(
    () => ({
      ...context,
      canonicalStatus: canonical ?? context.canonicalStatus,
      canonicalStatusUnavailable: canonicalFailed,
      commanderManualFixedAt,
    }),
    [canonical, canonicalFailed, commanderManualFixedAt, context],
  )

  const gaps = useMemo(() => {
    void recheckToken
    return resolveOperatorGaps(mergedContext)
  }, [mergedContext, recheckToken])

  const openGaps = useMemo(() => gaps.filter(g => g.status === 'open'), [gaps])
  const fixedGaps = useMemo(() => gaps.filter(g => g.status === 'fixed'), [gaps])
  const needsReviewGaps = useMemo(() => gaps.filter(g => g.status === 'needs_review'), [gaps])

  useEffect(() => {
    onGapCountChange?.(countOpenOperatorGaps(gaps))
  }, [gaps, onGapCountChange])

  const recheckGaps = useCallback(() => {
    setRecheckToken(token => token + 1)
    signalSuccess('Gap verification rechecked')
  }, [signalSuccess])

  const markFixedManually = useCallback(
    (gapId: string) => {
      const markedAt = new Date().toISOString()
      setCommanderManualFixedAt(prev => ({ ...prev, [gapId]: markedAt }))
      signalSuccess('Gap marked for Commander review')
    },
    [signalSuccess],
  )

  const refreshCanonical = useCallback(async () => {
    setScanning(true)
    signalWorking('Scanning for gaps…')
    try {
      const res = await fetch('/api/runtime/canonical-status', { cache: 'no-store' })
      if (!res.ok) {
        setCanonicalFailed(true)
        setCanonical(null)
        signalError('Canonical status unavailable')
        return
      }
      const data = (await res.json()) as CanonicalGapSnapshot
      setCanonical(data)
      setCanonicalFailed(false)
      const resolved = resolveOperatorGaps({ ...mergedContext, canonicalStatus: data })
      signalSuccess(
        `Gap scan complete · ${countOpenOperatorGaps(resolved)} open · ${resolved.filter(g => g.status === 'fixed').length} fixed`,
      )
      setRecheckToken(token => token + 1)
    } catch {
      setCanonicalFailed(true)
      signalError('Gap scan failed')
    } finally {
      setScanning(false)
    }
  }, [mergedContext, signalError, signalSuccess, signalWorking])

  return (
    <section
      className="rounded border border-fuchsia-500/25 bg-black/30 p-3"
      data-testid="gap-finder-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-fuchsia-200">Operator Gap Finder</p>
          <p className="mt-1 text-[9px] tracking-wide text-slate-500">
            Local heuristics + repair verification. Fixed status requires evidence — no auto-claim without proof.
          </p>
        </div>
        <span
          className="rounded-full px-2 py-0.5 text-[9px] font-bold tracking-widest"
          style={{
            border: openGaps.length ? '1px solid rgba(248,113,113,0.5)' : '1px solid rgba(52,211,153,0.4)',
            color: openGaps.length ? '#FCA5A5' : '#86EFAC',
          }}
        >
          {openGaps.length} open · {fixedGaps.length} fixed · {needsReviewGaps.length} review
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={scanning}
          className="min-h-[32px] rounded px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest"
          style={{ border: '1px solid rgba(217,70,239,0.45)', color: '#E879F9', background: 'rgba(0,0,0,0.35)' }}
          onClick={() => void refreshCanonical()}
        >
          {scanning ? 'Scanning…' : 'Find Gaps'}
        </button>
        <button
          type="button"
          className="min-h-[32px] rounded px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest"
          style={{ border: '1px solid rgba(52,211,153,0.45)', color: '#86EFAC', background: 'rgba(0,0,0,0.35)' }}
          onClick={recheckGaps}
          data-testid="gap-finder-recheck"
        >
          Recheck Gaps
        </button>
        <CopyCouncilButton
          label="Copy Gap Report"
          getText={() => formatGapReport(gaps)}
          successMessage="Gap report copied"
        />
        <CopyCouncilButton
          label="Copy Next Cursor Command"
          getText={() => topGapCursorCommand(gaps) ?? ''}
          successMessage="Cursor command copied"
          variant="accent"
        />
        <button
          type="button"
          className="min-h-[32px] rounded px-2 py-1.5 text-[9px] tracking-widest text-slate-500"
          onClick={() => setExpanded(prev => !prev)}
        >
          {expanded ? 'Hide list' : 'Show list'}
        </button>
      </div>

      {expanded ? (
        <div className="mt-3 max-h-80 space-y-4 overflow-y-auto text-[10px]">
          <GapSection
            title="Open gaps"
            emptyLabel="No open gaps with current heuristics."
            gaps={openGaps}
            onMarkFixedManually={markFixedManually}
          />
          <GapSection
            title="Fixed gaps"
            emptyLabel="No automatically verified fixes yet."
            gaps={fixedGaps}
            onMarkFixedManually={markFixedManually}
          />
          <GapSection
            title="Needs review"
            emptyLabel="No Commander manual closures pending review."
            gaps={needsReviewGaps}
            onMarkFixedManually={markFixedManually}
          />
        </div>
      ) : null}
    </section>
  )
})

function GapSection({
  title,
  emptyLabel,
  gaps,
  onMarkFixedManually,
}: {
  title: string
  emptyLabel: string
  gaps: OperatorGap[]
  onMarkFixedManually: (gapId: string) => void
}) {
  return (
    <div>
      <p className="mb-2 text-[9px] font-bold uppercase tracking-widest text-fuchsia-200/90">{title}</p>
      {gaps.length === 0 ? (
        <p className="text-slate-500">{emptyLabel}</p>
      ) : (
        <ul className="space-y-2">
          {gaps.map(g => (
            <GapRow key={g.id} gap={g} onMarkFixedManually={onMarkFixedManually} />
          ))}
        </ul>
      )}
    </div>
  )
}

function GapRow({
  gap,
  onMarkFixedManually,
}: {
  gap: OperatorGap
  onMarkFixedManually: (gapId: string) => void
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
      <p className="mt-1 text-slate-400">{gap.meaning}</p>
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
        <button
          type="button"
          className="mt-2 min-h-[28px] rounded px-2 py-1 text-[8px] font-bold uppercase tracking-widest"
          style={{ border: '1px solid rgba(251,191,36,0.45)', color: '#FCD34D' }}
          onClick={() => onMarkFixedManually(gap.id)}
          title={COMMANDER_MANUAL_FIX_EVIDENCE}
        >
          Mark Fixed Manually
        </button>
      ) : null}
    </li>
  )
}

function statusBadgeColor(status: GapStatus): string {
  if (status === 'fixed') return '#86EFAC'
  if (status === 'needs_review') return '#FCD34D'
  return '#FCA5A5'
}
