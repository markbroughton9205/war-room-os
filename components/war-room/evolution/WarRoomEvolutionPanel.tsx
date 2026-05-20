'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { useWarRoomUiMode } from '@/components/war-room/WarRoomUiModeContext'
import { buildEvolutionOperatorSummary } from '@/lib/operator/evolutionSummary'
import type { RepairIntelligenceSnapshot } from '@/lib/evolution/types'
import { RepairIntelligenceDetail } from './RepairIntelligenceDetail'

type SchemaRepairPacketResponse = {
  repairPacket?: { combinedCursorPrompt?: string; cursorReadyPrompt?: string }
  issues?: unknown[]
}

function scoreColor(score: number): string {
  if (score >= 85) return '#34D399'
  if (score >= 65) return '#FBBF24'
  if (score >= 40) return '#FB923C'
  return '#F87171'
}

export function WarRoomEvolutionPanel({
  onCouncilHandoff,
}: {
  onCouncilHandoff?: (decree: string) => void
}) {
  const { uiMode } = useWarRoomUiMode()
  const [snapshot, setSnapshot] = useState<RepairIntelligenceSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/evolution/repair-intelligence', { cache: 'no-store' })
      const body = await res.json() as RepairIntelligenceSnapshot & { error?: string }
      if (!res.ok) throw new Error(body.error || 'Repair intelligence unavailable')
      setSnapshot(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Repair intelligence unavailable')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const operatorSummary = useMemo(
    () => (snapshot ? buildEvolutionOperatorSummary(snapshot) : null),
    [snapshot],
  )

  const runSchemaSweep = async () => {
    setNotice(null)
    try {
      const res = await fetch('/api/schema/sweep', { method: 'POST', cache: 'no-store' })
      const body = await res.json() as { status?: string; recommendedNextAction?: string }
      setNotice(
        res.ok
          ? `Schema sweep: ${body.status ?? 'complete'}. ${body.recommendedNextAction ?? 'Refresh repair intelligence.'}`
          : 'Schema sweep failed. Check Engineering View.',
      )
      await load()
    } catch {
      setNotice('Schema sweep request failed.')
    }
  }

  const refreshRuntime = async () => {
    setNotice(null)
    try {
      const res = await fetch('/api/runtime/canonical-status', { cache: 'no-store' })
      setNotice(res.ok ? 'Runtime snapshot refreshed.' : 'Runtime refresh failed.')
      await load()
    } catch {
      setNotice('Runtime refresh failed.')
    }
  }

  const generateRepairPacket = async () => {
    setNotice(null)
    try {
      const res = await fetch('/api/schema/repair-packet', { method: 'POST', cache: 'no-store' })
      if (!res.ok) {
        const council = await fetch('/api/council/repair-packet', { cache: 'no-store' })
        if (!council.ok) throw new Error('No repair packet available')
        setNotice('Council repair packet snapshot loaded. Use Copy Cursor Command on a queue item.')
        await load()
        return
      }
      const body = await res.json() as SchemaRepairPacketResponse
      const prompt = body.repairPacket?.combinedCursorPrompt ?? body.repairPacket?.cursorReadyPrompt
      if (prompt) {
        await navigator.clipboard.writeText(prompt)
        setNotice('Schema repair packet generated and copied for manual Cursor handoff.')
      } else {
        setNotice('Repair packet generated. Open Engineering View for SQL details.')
      }
      await load()
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Repair packet generation failed.')
    }
  }

  const copyCursorCommand = async () => {
    const command =
      snapshot?.nextRequiredAction?.cursorCommand
      ?? snapshot?.repairQueue.find(item => item.cursorCommand)?.cursorCommand
    if (!command) {
      setNotice('No cursor command in current snapshot. Generate a repair packet first.')
      return
    }
    try {
      await navigator.clipboard.writeText(command)
      setNotice('Cursor command copied. War Room did not execute or mutate anything.')
    } catch {
      setNotice('Clipboard unavailable; copy from Engineering detail view.')
    }
  }

  const scores = snapshot?.scores
  const engineering = uiMode === 'advanced'

  return (
    <div className="environment-card-motion rounded border border-white/10 bg-black/25 p-2">
      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">War Room Evolution</p>

      {loading && !snapshot ? (
        <p className="mt-1 text-[10px] text-slate-500">Loading repair intelligence…</p>
      ) : null}
      {error ? <p className="mt-1 text-[10px] text-red-300">{error}</p> : null}

      {operatorSummary && scores ? (
        <>
          <p className="mt-1 text-xs font-semibold" style={{ color: scoreColor(scores.overall) }}>
            {scores.overall}% · {operatorSummary.readinessLabel}
          </p>
          {engineering ? (
            <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[8px] text-slate-500">
              <span>Providers {scores.provider}%</span>
              <span>Schema {scores.schema}%</span>
              <span>Signals {scores.signal}%</span>
              <span>Operator {scores.operator}%</span>
              <span>Revenue {scores.revenue}%</span>
              <span>Overall {scores.overall}%</span>
            </div>
          ) : (
            <p className="text-[10px] text-slate-300">
              {operatorSummary.blockerCount > 0
                ? `${operatorSummary.blockerCount} blocker(s) · ${operatorSummary.missingConfigCount} config gap(s)`
                : `${operatorSummary.missingConfigCount} configuration item(s) tracked`}
            </p>
          )}
          <p className="mt-1 text-[8px] text-slate-600">
            Next: {operatorSummary.nextActionTitle}
          </p>
          {!engineering ? (
            <p className="text-[8px] text-slate-600">{operatorSummary.nextActionDetail}</p>
          ) : null}
        </>
      ) : null}

      {notice ? <p className="mt-1 text-[8px] text-sky-200">{notice}</p> : null}

      <div className="mt-2 flex flex-wrap gap-1">
        {engineering ? (
          <ActionButton
            label={detailsOpen ? 'Hide details' : 'View details'}
            onClick={() => setDetailsOpen(value => !value)}
          />
        ) : null}
        <ActionButton label="Schema sweep" onClick={() => void runSchemaSweep()} disabled={loading} />
        <ActionButton label="Refresh runtime" onClick={() => void refreshRuntime()} disabled={loading} />
        {engineering ? (
          <>
            <ActionButton label="Repair packet" onClick={() => void generateRepairPacket()} disabled={loading} />
            <ActionButton label="Copy Cursor" onClick={() => void copyCursorCommand()} disabled={loading} />
          </>
        ) : null}
        <ActionButton label={loading ? '…' : 'Refresh'} onClick={() => void load()} disabled={loading} />
      </div>

      {engineering && detailsOpen && snapshot ? (
        <RepairIntelligenceDetail snapshot={snapshot} />
      ) : null}

      {onCouncilHandoff ? (
        <button
          type="button"
          className="mt-2 text-[7px] uppercase tracking-widest text-sky-300 underline"
          onClick={() =>
            onCouncilHandoff(
              'Council, review War Room repair intelligence: missing configuration, schema drift, provider issues, and the next required action. Recommend one safe manual fix.',
            )
          }
        >
          Ask Council
        </button>
      ) : null}

      <p className="mt-1 text-[7px] text-slate-600">
        Source-backed only · env names never values · no browser DB mutation
      </p>
    </div>
  )
}

function ActionButton({
  label,
  onClick,
  disabled,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded border border-white/15 px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-widest text-slate-300 disabled:opacity-40"
    >
      {label}
    </button>
  )
}
