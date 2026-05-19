'use client'

import { useMemo, useState, type FormEvent } from 'react'
import type { MissionId } from '@/lib/missions/types'
import type { OperatorAction, OperatorDeckSnapshot, OperatorMissionStatus } from '@/lib/operator/deckTypes'

type LogEarningsModalProps = {
  action: OperatorAction | null
  missions: OperatorMissionStatus[]
  onClose: () => void
  onLogged: (snapshot: OperatorDeckSnapshot | null, message: string) => void
}

export default function LogEarningsModal({ action, missions, onClose, onLogged }: LogEarningsModalProps) {
  const [amountEarned, setAmountEarned] = useState('')
  const [timeSpentMinutes, setTimeSpentMinutes] = useState(action?.estimatedTimeMinutes ? String(action.estimatedTimeMinutes) : '')
  const [missionId, setMissionId] = useState<MissionId>(action?.linkedMission ?? missions[0]?.id ?? 'phase-0-cashflow-base')
  const [notes, setNotes] = useState('')
  const [sourceUri, setSourceUri] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const title = useMemo(() => action?.title ?? 'Manual operator earnings log', [action?.title])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!confirmed || submitting) {
      setMessage('Commander confirmation is required before logging.')
      return
    }
    setSubmitting(true)
    setMessage(null)
    try {
      const res = await fetch('/api/operator/log-earnings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          actionId: action?.id ?? null,
          title,
          missionId,
          amountEarned: Number(amountEarned),
          timeSpentMinutes: Number(timeSpentMinutes),
          notes: notes || null,
          sourceUri: sourceUri || null,
          confirmed,
        }),
      })
      const body = await res.json() as { ok?: boolean; message?: string; snapshot?: OperatorDeckSnapshot }
      if (!res.ok || body.ok === false) {
        setMessage(body.message ?? 'Earnings could not be logged.')
        return
      }
      onLogged(body.snapshot ?? null, body.message ?? 'Earnings logged after confirmation.')
      onClose()
    } catch {
      setMessage('Earnings could not be logged.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center">
      <form onSubmit={submit} className="w-full max-w-lg rounded border border-emerald-400/25 bg-slate-950 p-4 shadow-2xl shadow-emerald-950/40">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-300">Complete &amp; Log</div>
            <h2 className="mt-1 text-lg font-semibold text-white">{title}</h2>
            <p className="mt-1 text-xs text-slate-500">Writes earnings and outcome data only after this confirmation.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded border border-white/15 px-2 py-1 text-[10px] uppercase tracking-widest text-slate-300">Close</button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Amount Earned
            <input value={amountEarned} onChange={event => setAmountEarned(event.target.value)} required min="0" step="0.01" type="number" className="mt-1 w-full rounded border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none" />
          </label>
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Time Spent Minutes
            <input value={timeSpentMinutes} onChange={event => setTimeSpentMinutes(event.target.value)} required min="1" step="1" type="number" className="mt-1 w-full rounded border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none" />
          </label>
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 sm:col-span-2">
            Mission
            <select value={missionId} onChange={event => setMissionId(event.target.value as MissionId)} className="mt-1 w-full rounded border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none">
              {missions.map(mission => <option key={mission.id} value={mission.id}>{mission.title}</option>)}
            </select>
          </label>
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 sm:col-span-2">
            Source URI Optional
            <input value={sourceUri} onChange={event => setSourceUri(event.target.value)} placeholder="Only if source-backed evidence exists" className="mt-1 w-full rounded border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none" />
          </label>
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 sm:col-span-2">
            Notes Optional
            <textarea value={notes} onChange={event => setNotes(event.target.value)} rows={3} className="mt-1 w-full rounded border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none" />
          </label>
        </div>

        <label className="mt-4 flex items-start gap-2 rounded border border-yellow-300/20 bg-yellow-300/5 p-3 text-xs text-yellow-100">
          <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-0.5" />
          I confirm this is manual or source-backed earnings data. No fake balance, hidden action, spending, email, or external write is being performed.
        </label>

        {message ? <div className="mt-3 rounded border border-red-300/25 bg-red-500/10 p-2 text-xs text-red-100">{message}</div> : null}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-white/15 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-300">Cancel</button>
          <button type="submit" disabled={submitting || !confirmed} className="rounded border border-emerald-300/40 bg-emerald-300 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-black disabled:opacity-50">
            {submitting ? 'Logging' : 'Confirm Log'}
          </button>
        </div>
      </form>
    </div>
  )
}
