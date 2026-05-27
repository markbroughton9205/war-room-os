'use client'

import { memo, useCallback, useEffect, useMemo, useState } from 'react'

import { CopyCouncilButton } from '@/components/war-room/council/CopyCouncilButton'
import { useMatrixStatus } from '@/hooks/useMatrixStatus'
import {
  findOperatorGaps,
  formatGapReport,
  topGapCursorCommand,
  type CanonicalGapSnapshot,
  type GapFinderContext,
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

  const mergedContext = useMemo<GapFinderContext>(
    () => ({
      ...context,
      canonicalStatus: canonical ?? context.canonicalStatus,
      canonicalStatusUnavailable: canonicalFailed,
    }),
    [canonical, canonicalFailed, context],
  )

  const gaps = useMemo(() => findOperatorGaps(mergedContext), [mergedContext])

  useEffect(() => {
    onGapCountChange?.(gaps.length)
  }, [gaps.length, onGapCountChange])

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
      signalSuccess(`Gap scan complete · ${findOperatorGaps({ ...mergedContext, canonicalStatus: data }).length} gaps`)
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
            Local heuristics from live UI, session, and canonical runtime snapshot. No provider completions.
          </p>
        </div>
        <span
          className="rounded-full px-2 py-0.5 text-[9px] font-bold tracking-widest"
          style={{
            border: gaps.length ? '1px solid rgba(248,113,113,0.5)' : '1px solid rgba(52,211,153,0.4)',
            color: gaps.length ? '#FCA5A5' : '#86EFAC',
          }}
        >
          {gaps.length} gap{gaps.length === 1 ? '' : 's'}
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
        <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto text-[10px]">
          {gaps.length === 0 ? (
            <li className="text-slate-500">No gaps detected with current heuristics.</li>
          ) : (
            gaps.map(g => <GapRow key={g.id} gap={g} />)
          )}
        </ul>
      ) : null}
    </section>
  )
})

function GapRow({ gap }: { gap: OperatorGap }) {
  const severityColor =
    gap.severity === 'high' ? '#F87171' : gap.severity === 'medium' ? '#FBBF24' : '#94A3B8'

  return (
    <li className="rounded border border-white/10 bg-black/40 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold tracking-widest text-slate-200">{gap.title}</span>
        <span className="text-[8px] uppercase tracking-widest" style={{ color: severityColor }}>
          {gap.severity}
        </span>
        <span className="text-[8px] uppercase tracking-widest text-slate-600">{gap.category}</span>
      </div>
      <p className="mt-1 text-slate-400">{gap.meaning}</p>
      <p className="mt-1 text-[9px] text-emerald-200/80">{gap.recommendedFix}</p>
    </li>
  )
}
