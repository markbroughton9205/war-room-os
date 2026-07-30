'use client'

import { memo, useCallback, useMemo, useState } from 'react'

import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { useMatrixStatus } from '@/hooks/useMatrixStatus'
import type { GapFinderContext, OperatorGap } from '@/lib/operator/gapFinder'
import type { OperatorInboxItem } from '@/lib/operator/inbox'
import {
  approveRepair,
  findRepairBySourceId,
  getOrDetectRepairFromGap,
  getOrDetectRepairFromInbox,
  learnFromRepair,
  markRepairApplied,
  markRepairHandedOff,
  markRepairInProgress,
  prepareRepairPlanFromGap,
  prepareRepairPlanFromInbox,
  validateRepair,
  validationDisplayLabel,
  type SelfRepairSnapshot,
} from '@/lib/operator/selfRepair'
import { formatRepairPlanForCursor } from '@/lib/operator/selfRepair/templates'
import { lifecycleLabel } from '@/lib/operator/selfRepair/lifecycle'
import { loadUpgradeQueue, type UpgradeQueueSnapshot } from '@/lib/operator/upgradeQueue'

export type SelfRepairActionsProps = {
  source: { type: 'gap'; gap: OperatorGap } | { type: 'inbox'; item: OperatorInboxItem }
  gapFinderContext: GapFinderContext
  repairSnapshot: SelfRepairSnapshot
  onRepairSnapshotChange: (snapshot: SelfRepairSnapshot) => void
  onUpgradeQueueChange?: (snapshot: UpgradeQueueSnapshot) => void
  compact?: boolean
}

export const SelfRepairActions = memo(function SelfRepairActions({
  source,
  gapFinderContext,
  repairSnapshot,
  onRepairSnapshotChange,
  onUpgradeQueueChange,
  compact,
}: SelfRepairActionsProps) {
  const { copy } = useCopyToClipboard()
  const { signalSuccess, signalError, signalWarning } = useMatrixStatus()
  const [validating, setValidating] = useState(false)

  const sourceId = source.type === 'gap' ? source.gap.id : source.item.id

  const record = useMemo(() => {
    const fromSnapshot = repairSnapshot.records.find(
      r => r.plan.sourceId === sourceId || r.gapId === sourceId,
    )
    if (fromSnapshot) return fromSnapshot
  return source.type === 'gap'
      ? getOrDetectRepairFromGap(source.gap)
      : getOrDetectRepairFromInbox(source.item)
  }, [repairSnapshot.records, source, sourceId])

  const prepare = useCallback(() => {
    const snapshot =
      source.type === 'gap'
        ? prepareRepairPlanFromGap(source.gap)
        : prepareRepairPlanFromInbox(source.item)
    onRepairSnapshotChange(snapshot)
    signalSuccess('Repair plan prepared')
  }, [onRepairSnapshotChange, signalSuccess, source])

  const approve = useCallback(() => {
    const current = findRepairBySourceId(sourceId) ?? record
    onRepairSnapshotChange(approveRepair(current))
    onUpgradeQueueChange?.(loadUpgradeQueue())
    signalSuccess('Repair approved — added to upgrade queue')
  }, [onRepairSnapshotChange, onUpgradeQueueChange, record, signalSuccess, sourceId])

  const sendToCursor = useCallback(async () => {
    const current = findRepairBySourceId(sourceId) ?? record
    const text = formatRepairPlanForCursor(current.plan)
    const result = await copy(text, {
      successMessage: 'Repair plan copied for Cursor',
      manualTitle: 'Repair plan for Cursor',
    })
    if (result === 'empty') {
      signalWarning('Repair plan is empty')
      return
    }
    onRepairSnapshotChange(markRepairHandedOff(current))
    if (result === 'copied') signalSuccess('Sent to Cursor (clipboard)')
  }, [copy, onRepairSnapshotChange, record, signalSuccess, signalWarning, sourceId])

  const applyLater = useCallback(() => {
    const current = findRepairBySourceId(sourceId) ?? record
    onRepairSnapshotChange(markRepairInProgress(current))
    signalSuccess('Marked in progress — apply manually when ready')
  }, [onRepairSnapshotChange, record, signalSuccess, sourceId])

  const validate = useCallback(async () => {
    if (validating) return
    setValidating(true)
    try {
      const current = findRepairBySourceId(sourceId) ?? record
      const { snapshot, result } = await validateRepair(current, gapFinderContext)
      onRepairSnapshotChange(snapshot)
      if (result.outcome === 'verified') signalSuccess('Repair validated')
      else if (result.outcome === 'failed') signalError('Validation failed — gap may still be open')
      else signalWarning('Cannot verify — runtime status could not be refreshed')
    } finally {
      setValidating(false)
    }
  }, [validating, gapFinderContext, onRepairSnapshotChange, record, signalError, signalSuccess, signalWarning, sourceId])

  const learn = useCallback(() => {
    const current = findRepairBySourceId(sourceId) ?? record
    if (current.state !== 'VALIDATED' && current.validation?.outcome !== 'verified') {
      signalWarning('Validate repair before learning')
      return
    }
    onRepairSnapshotChange(learnFromRepair(current))
    signalSuccess('Lesson captured')
  }, [onRepairSnapshotChange, record, signalSuccess, signalWarning, sourceId])

  const markApplied = useCallback(() => {
    const current = findRepairBySourceId(sourceId) ?? record
    onRepairSnapshotChange(markRepairApplied(current))
    signalSuccess('Marked applied (manual)')
  }, [onRepairSnapshotChange, record, signalSuccess, sourceId])

  const chipClass = compact ? 'min-h-[26px] px-1.5 py-0.5 text-[7px]' : 'min-h-[28px] px-2 py-1 text-[8px]'

  return (
    <div className="mt-2 space-y-1" data-testid={`self-repair-actions-${sourceId}`}>
      <p className="text-[8px] uppercase tracking-widest text-violet-300/80">
        Self-repair · {validating ? 'Checking…' : lifecycleLabel(record.state)}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <RepairChip className={chipClass} label="Prepare Repair Plan" onClick={prepare} />
        <RepairChip className={chipClass} label="Approve Repair" onClick={approve} accent />
        <RepairChip className={chipClass} label="Send to Cursor" onClick={() => void sendToCursor()} />
        <RepairChip className={chipClass} label="Apply Later" onClick={applyLater} />
        <RepairChip className={chipClass} label="Mark Applied" onClick={markApplied} muted />
        <RepairChip
          className={chipClass}
          label={validating ? 'Waiting for runtime data…' : 'Validate Repair'}
          onClick={() => void validate()}
          disabled={validating}
        />
        <RepairChip className={chipClass} label="Learn From Repair" onClick={learn} accent />
      </div>
      {record.validation ? (
        <p className="text-[8px] text-slate-500">
          Last validation: {validationDisplayLabel(record.validation)} ·{' '}
          {record.validation.evidence.length} evidence line(s)
        </p>
      ) : null}
    </div>
  )
})

function RepairChip({
  label,
  onClick,
  accent,
  muted,
  className,
  disabled,
}: {
  label: string
  onClick: () => void
  accent?: boolean
  muted?: boolean
  className?: string
  disabled?: boolean
}) {
  const color = accent ? '#C4B5FD' : muted ? '#94A3B8' : '#DDD6FE'
  const border = accent
    ? 'rgba(167,139,250,0.5)'
    : muted
      ? 'rgba(148,163,184,0.45)'
      : 'rgba(139,92,246,0.45)'
  return (
    <button
      type="button"
      disabled={disabled}
      className={`rounded font-bold uppercase tracking-widest disabled:opacity-50 ${className ?? ''}`}
      style={{ border: `1px solid ${border}`, color }}
      onClick={onClick}
    >
      {label}
    </button>
  )
}
