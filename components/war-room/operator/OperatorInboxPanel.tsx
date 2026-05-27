'use client'

import { memo, useCallback, useMemo, useState } from 'react'

import { CopyCouncilButton } from '@/components/war-room/council/CopyCouncilButton'
import { useMatrixStatus } from '@/hooks/useMatrixStatus'
import {
  categoryLabel,
  countOpenOperatorInboxItems,
  dismissCouncilBurstNote,
  listOperatorInboxItems,
  updateOperatorInboxItemStatus,
  type OperatorInboxItem,
  type OperatorInboxSnapshot,
  type OperatorInboxStatus,
} from '@/lib/operator/inbox'
import {
  FIRST_INCOME_MOVE_PLAYBOOK,
  formatRevenueStarterCard,
} from '@/lib/operator/revenueStarter'
import type { GapFinderContext } from '@/lib/operator/gapFinder'
import type { SelfRepairSnapshot } from '@/lib/operator/selfRepair'
import type { UpgradeQueueSnapshot } from '@/lib/operator/upgradeQueue'
import { SelfRepairActions } from './SelfRepairActions'

export type OperatorInboxPanelProps = {
  snapshot: OperatorInboxSnapshot
  onSnapshotChange: (snapshot: OperatorInboxSnapshot) => void
  onRecheck?: () => void
  showCouncilBurstNote?: boolean
  gapFinderContext?: GapFinderContext
  repairSnapshot?: SelfRepairSnapshot
  onRepairSnapshotChange?: (snapshot: SelfRepairSnapshot) => void
  onUpgradeQueueChange?: (snapshot: UpgradeQueueSnapshot) => void
}

export const OperatorInboxPanel = memo(function OperatorInboxPanel({
  snapshot,
  onSnapshotChange,
  onRecheck,
  showCouncilBurstNote = false,
  gapFinderContext,
  repairSnapshot,
  onRepairSnapshotChange,
  onUpgradeQueueChange,
}: OperatorInboxPanelProps) {
  const { signalSuccess } = useMatrixStatus()
  const [showDismissed, setShowDismissed] = useState(false)
  const [showRevenuePlaybook, setShowRevenuePlaybook] = useState(false)

  const grouped = useMemo(
    () =>
      listOperatorInboxItems(snapshot.items, {
        showDismissed,
        showFixedRecently: true,
      }),
    [showDismissed, snapshot.items],
  )

  const openCount = useMemo(() => countOpenOperatorInboxItems(snapshot.items), [snapshot.items])

  const applyStatus = useCallback(
    (id: string, status: OperatorInboxStatus) => {
      const next = updateOperatorInboxItemStatus(id, status)
      onSnapshotChange(next)
      const labels: Record<OperatorInboxStatus, string> = {
        open: 'Reopened',
        in_progress: 'Marked in progress',
        fixed: 'Marked done',
        dismissed: 'Dismissed',
      }
      signalSuccess(labels[status])
    },
    [onSnapshotChange, signalSuccess],
  )

  const dismissBurstNote = useCallback(() => {
    onSnapshotChange(dismissCouncilBurstNote())
    signalSuccess('Council activity note dismissed')
  }, [onSnapshotChange, signalSuccess])

  return (
    <section
      className="rounded border border-cyan-500/25 bg-black/30 p-3"
      data-testid="operator-inbox-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-200">
            Operator Inbox
          </p>
          <p className="mt-1 text-[9px] tracking-wide text-slate-500">
            Plain-language follow-ups from self-audit, setup, revenue, and verification — saved in
            this browser session only.
          </p>
        </div>
        <span
          className="rounded-full px-2 py-0.5 text-[9px] font-bold tracking-widest"
          style={{
            border: openCount ? '1px solid rgba(248,113,113,0.5)' : '1px solid rgba(52,211,153,0.4)',
            color: openCount ? '#FCA5A5' : '#86EFAC',
          }}
        >
          {openCount} open
        </span>
      </div>

      {showCouncilBurstNote ? (
        <div
          className="mt-3 rounded border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-[10px] text-amber-100/90"
          data-testid="council-burst-note"
        >
          <p>High council activity recently. Stable Group recommended.</p>
          <button
            type="button"
            className="mt-2 text-[9px] font-bold uppercase tracking-widest text-amber-200/80 underline-offset-2 hover:underline"
            onClick={dismissBurstNote}
          >
            Dismiss note
          </button>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="min-h-[32px] rounded px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest"
          style={{ border: '1px solid rgba(34,211,238,0.45)', color: '#67E8F9', background: 'rgba(0,0,0,0.35)' }}
          onClick={() => setShowRevenuePlaybook(prev => !prev)}
          data-testid="revenue-starter-cta"
        >
          {showRevenuePlaybook ? 'Hide income playbook' : 'Start First Income Move'}
        </button>
        <button
          type="button"
          className="min-h-[32px] rounded px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest"
          style={{ border: '1px solid rgba(148,163,184,0.45)', color: '#94A3B8', background: 'rgba(0,0,0,0.35)' }}
          onClick={() => setShowDismissed(prev => !prev)}
        >
          {showDismissed ? 'Hide dismissed' : 'Show dismissed'}
        </button>
        {onRecheck ? (
          <button
            type="button"
            className="min-h-[32px] rounded px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest"
            style={{ border: '1px solid rgba(52,211,153,0.45)', color: '#86EFAC', background: 'rgba(0,0,0,0.35)' }}
            onClick={onRecheck}
            data-testid="operator-inbox-recheck"
          >
            Recheck
          </button>
        ) : null}
      </div>

      {showRevenuePlaybook ? (
        <RevenueStarterCard playbook={FIRST_INCOME_MOVE_PLAYBOOK} />
      ) : null}

      <div className="mt-3 max-h-80 space-y-3 overflow-y-auto text-[10px]">
        <InboxGroup
          title="Open"
          items={[...grouped.open, ...grouped.inProgress]}
          onStatus={applyStatus}
          onRecheck={onRecheck}
          gapFinderContext={gapFinderContext}
          repairSnapshot={repairSnapshot}
          onRepairSnapshotChange={onRepairSnapshotChange}
          onUpgradeQueueChange={onUpgradeQueueChange}
        />
        <InboxGroup
          title="Fixed recently"
          items={grouped.fixedRecently}
          onStatus={applyStatus}
          onRecheck={onRecheck}
          gapFinderContext={gapFinderContext}
          repairSnapshot={repairSnapshot}
          onRepairSnapshotChange={onRepairSnapshotChange}
          onUpgradeQueueChange={onUpgradeQueueChange}
        />
        {showDismissed ? (
          <InboxGroup
            title="Dismissed"
            items={grouped.dismissed}
            onStatus={applyStatus}
            onRecheck={onRecheck}
            gapFinderContext={gapFinderContext}
            repairSnapshot={repairSnapshot}
            onRepairSnapshotChange={onRepairSnapshotChange}
            onUpgradeQueueChange={onUpgradeQueueChange}
          />
        ) : null}
        {!grouped.open.length &&
        !grouped.inProgress.length &&
        !grouped.fixedRecently.length &&
        (!showDismissed || !grouped.dismissed.length) ? (
          <p className="text-slate-500">Inbox is clear. Run Self-Audit below to refresh items.</p>
        ) : null}
      </div>
    </section>
  )
})

function RevenueStarterCard({ playbook }: { playbook: typeof FIRST_INCOME_MOVE_PLAYBOOK }) {
  return (
    <article
      className="mt-3 rounded border border-emerald-500/30 bg-emerald-950/15 p-3 text-[10px]"
      data-testid="revenue-starter-card"
    >
      <p className="font-bold tracking-widest text-emerald-200">{playbook.offerTitle}</p>
      <dl className="mt-2 space-y-2 text-slate-300">
        <div>
          <dt className="text-[8px] font-bold uppercase tracking-widest text-slate-500">Who to target</dt>
          <dd className="mt-0.5">{playbook.whoToTarget}</dd>
        </div>
        <div>
          <dt className="text-[8px] font-bold uppercase tracking-widest text-slate-500">What to say</dt>
          <dd className="mt-0.5">{playbook.whatToSay}</dd>
        </div>
        <div>
          <dt className="text-[8px] font-bold uppercase tracking-widest text-slate-500">Setup cost</dt>
          <dd className="mt-0.5">{playbook.setupCost}</dd>
        </div>
        <div>
          <dt className="text-[8px] font-bold uppercase tracking-widest text-slate-500">Pricing</dt>
          <dd className="mt-0.5">{playbook.pricing}</dd>
        </div>
        <div>
          <dt className="text-[8px] font-bold uppercase tracking-widest text-slate-500">First manual step</dt>
          <dd className="mt-0.5 text-emerald-100/90">{playbook.firstManualStep}</dd>
        </div>
      </dl>
      <CopyCouncilButton
        label="Copy playbook"
        getText={() => formatRevenueStarterCard(playbook)}
        successMessage="Copied"
        manualTitle="Income playbook"
        variant="accent"
      />
    </article>
  )
}

function InboxGroup({
  title,
  items,
  onStatus,
  onRecheck,
  gapFinderContext,
  repairSnapshot,
  onRepairSnapshotChange,
  onUpgradeQueueChange,
}: {
  title: string
  items: OperatorInboxItem[]
  onStatus: (id: string, status: OperatorInboxStatus) => void
  onRecheck?: () => void
  gapFinderContext?: GapFinderContext
  repairSnapshot?: SelfRepairSnapshot
  onRepairSnapshotChange?: (snapshot: SelfRepairSnapshot) => void
  onUpgradeQueueChange?: (snapshot: UpgradeQueueSnapshot) => void
}) {
  if (!items.length) return null
  return (
    <div data-testid={`inbox-group-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <p className="mb-2 text-[9px] font-bold uppercase tracking-widest text-cyan-200/90">
        {title} ({items.length})
      </p>
      <ul className="space-y-2">
        {items.map(item => (
          <InboxRow
            key={item.id}
            item={item}
            onStatus={onStatus}
            onRecheck={onRecheck}
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

function InboxRow({
  item,
  onStatus,
  onRecheck,
  gapFinderContext,
  repairSnapshot,
  onRepairSnapshotChange,
  onUpgradeQueueChange,
}: {
  item: OperatorInboxItem
  onStatus: (id: string, status: OperatorInboxStatus) => void
  onRecheck?: () => void
  gapFinderContext?: GapFinderContext
  repairSnapshot?: SelfRepairSnapshot
  onRepairSnapshotChange?: (snapshot: SelfRepairSnapshot) => void
  onUpgradeQueueChange?: (snapshot: UpgradeQueueSnapshot) => void
}) {
  const severityColor =
    item.severity === 'high' ? '#F87171' : item.severity === 'medium' ? '#FBBF24' : '#94A3B8'
  const statusColor =
    item.status === 'fixed'
      ? '#86EFAC'
      : item.status === 'in_progress'
        ? '#67E8F9'
        : item.status === 'dismissed'
          ? '#94A3B8'
          : '#FCA5A5'

  return (
    <li className="rounded border border-white/10 bg-black/40 p-2" data-testid={`inbox-item-${item.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold tracking-widest text-slate-200">{item.title}</span>
        <span className="text-[8px] uppercase tracking-widest" style={{ color: severityColor }}>
          {item.severity}
        </span>
        <span className="text-[8px] uppercase tracking-widest" style={{ color: statusColor }}>
          {item.status.replace('_', ' ')}
        </span>
        <span className="text-[8px] uppercase tracking-widest text-slate-600">
          {categoryLabel(item.category)}
        </span>
      </div>
      <p className="mt-1 text-emerald-100/90">{item.plainMeaning}</p>
      <p className="mt-1 text-[9px] text-emerald-200/80">{item.recommendedAction}</p>
      <p className="mt-1 text-[8px] text-slate-600">
        Source: {item.source} · Checked {new Date(item.lastCheckedAt).toLocaleString()}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {item.status === 'open' || item.status === 'in_progress' ? (
          <>
            {item.status === 'open' ? (
              <ActionChip label="Mark in progress" onClick={() => onStatus(item.id, 'in_progress')} />
            ) : null}
            <ActionChip label="Mark done" onClick={() => onStatus(item.id, 'fixed')} />
            <ActionChip label="Dismiss" muted onClick={() => onStatus(item.id, 'dismissed')} />
          </>
        ) : null}
        <CopyCouncilButton
          label="Copy cursor command"
          getText={() => item.copyCursorCommand}
          successMessage="Copied"
          manualTitle="Cursor command"
        />
        {onRecheck ? (
          <ActionChip label="Recheck" onClick={onRecheck} />
        ) : null}
      </div>
      {gapFinderContext && repairSnapshot && onRepairSnapshotChange ? (
        <SelfRepairActions
          source={{ type: 'inbox', item }}
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

function ActionChip({
  label,
  onClick,
  muted,
}: {
  label: string
  onClick: () => void
  muted?: boolean
}) {
  return (
    <button
      type="button"
      className="min-h-[28px] rounded px-2 py-1 text-[8px] font-bold uppercase tracking-widest"
      style={{
        border: muted ? '1px solid rgba(148,163,184,0.45)' : '1px solid rgba(251,191,36,0.45)',
        color: muted ? '#94A3B8' : '#FCD34D',
      }}
      onClick={onClick}
    >
      {label}
    </button>
  )
}
