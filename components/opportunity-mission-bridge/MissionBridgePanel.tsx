'use client'
import { useEffect, useMemo, useState } from 'react'
import type { IncomeLootConsoleOpportunity } from '@/lib/income-loot/consoleViewModel'
import type { CommanderReadinessCard as CommanderReadinessCardData } from '@/lib/opportunity-readiness/types'
import { CommanderReadinessCard } from '@/components/opportunity-readiness/CommanderReadinessCard'
import { fromIncomeLootOpportunity } from '@/lib/opportunity-mission-bridge/adapter'
import { buildCommanderFieldBrief } from '@/lib/opportunity-mission-bridge/fieldBrief'
import type { MissionRecord, ReportBackOutcome, ReportBackPaymentStatus } from '@/lib/opportunity-mission-bridge/types'
import { CLOSABLE_MISSION_STATUSES, REPORT_BACK_OUTCOMES, REPORT_BACK_PAYMENT_STATUSES } from '@/lib/opportunity-mission-bridge/types'

const tag = (value: string) => value.replace(/_/g, ' ')

function Badge({ value, tone }: { value: string; tone?: string }) {
  return <span className={`inline-flex rounded border bg-black/30 px-2 py-1 text-[9px] font-bold uppercase tracking-widest ${tone ?? 'text-slate-300 border-white/15'}`}>{tag(value)}</span>
}

const ACTIVE_STATUSES = new Set(['COMMANDER_ACTIVE', 'REPORT_BACK_DUE'])
const PAYMENT_CHECKABLE = new Set(['OUTCOME_REPORTED', 'PAYMENT_PENDING'])
// Single source of truth for CLOSE-eligibility lives in bridgeEngine/types —
// the API enforces this same allow-list, so hiding the button here is a UX
// convenience, not the actual protection.
const CLOSABLE = new Set(CLOSABLE_MISSION_STATUSES)

type ReportBackFormState = {
  outcome: ReportBackOutcome
  providerResponse: string
  timeSpentMinutes: string
  travelCost: string
  otherCosts: string
  compensationReceivedAmount: string
  compensationReceivedCurrency: string
  paymentStatus: ReportBackPaymentStatus
  commanderNotes: string
}

const EMPTY_REPORT_BACK: ReportBackFormState = {
  outcome: 'NOT_REPORTED',
  providerResponse: '',
  timeSpentMinutes: '',
  travelCost: '',
  otherCosts: '',
  compensationReceivedAmount: '',
  compensationReceivedCurrency: 'USD',
  paymentStatus: 'NOT_APPLICABLE',
  commanderNotes: '',
}

async function postBridge(body: Record<string, unknown>) {
  const response = await fetch('/api/opportunity-mission-bridge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const data = (await response.json()) as { record?: MissionRecord; error?: string }
  return { ok: response.ok, data }
}

export function MissionBridgePanel({ item }: { item: IncomeLootConsoleOpportunity }) {
  const [missionRecord, setMissionRecord] = useState<MissionRecord | null>(null)
  const [assessment, setAssessment] = useState<CommanderReadinessCardData | null>(null)
  const [assessing, setAssessing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [reportBackForm, setReportBackForm] = useState<ReportBackFormState>(EMPTY_REPORT_BACK)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/opportunity-mission-bridge?opportunityId=${encodeURIComponent(item.id)}`)
      .then(response => response.json())
      .then((data: { record?: MissionRecord | null }) => {
        if (!cancelled) setMissionRecord(data.record ?? null)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [item.id])

  const fieldBrief = useMemo(() => (assessment ? buildCommanderFieldBrief(item.id, assessment) : null), [assessment, item.id])

  const assessReadiness = async () => {
    setAssessing(true)
    setMessage(null)
    try {
      const opportunity = fromIncomeLootOpportunity(item)
      const response = await fetch('/api/opportunity-readiness/assess', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ opportunity }) })
      const data = (await response.json()) as { card?: CommanderReadinessCardData; message?: string }
      if (!response.ok || !data.card) {
        setMessage(data.message ?? 'Readiness assessment failed.')
        return
      }
      setAssessment(data.card)
      const sync = await postBridge({ action: 'SYNC_ASSESSMENT', opportunityId: item.id, readinessState: data.card.readinessState, hasPreparationPath: data.card.preparationMissions.length > 0 })
      if (sync.ok && sync.data.record) setMissionRecord(sync.data.record)
      else setMessage(sync.data.error ?? 'Assessment completed but mission status could not be synced.')
    } finally {
      setAssessing(false)
    }
  }

  const markActive = async () => {
    const result = await postBridge({ action: 'MARK_ACTIVE', opportunityId: item.id })
    if (result.ok && result.data.record) setMissionRecord(result.data.record)
    setMessage(result.ok ? 'Commander marked this mission active. No external action was taken.' : (result.data.error ?? 'Could not mark mission active.'))
  }

  const submitReportBack = async () => {
    const body: Record<string, unknown> = {
      action: 'REPORT_BACK',
      opportunityId: item.id,
      outcome: reportBackForm.outcome,
      providerResponse: reportBackForm.providerResponse.trim() || null,
      timeSpentMinutes: reportBackForm.timeSpentMinutes.trim() === '' ? null : Number(reportBackForm.timeSpentMinutes),
      travelCost: reportBackForm.travelCost.trim() === '' ? null : Number(reportBackForm.travelCost),
      otherCosts: reportBackForm.otherCosts.trim() === '' ? null : Number(reportBackForm.otherCosts),
      compensationPromised: assessment && assessment.compensation.value !== null ? { amount: assessment.compensation.value, currency: assessment.compensation.currency, basis: assessment.compensation.basis, per: 'per_task' } : null,
      compensationReceivedClaim: reportBackForm.compensationReceivedAmount.trim() === '' ? null : { amount: Number(reportBackForm.compensationReceivedAmount), currency: reportBackForm.compensationReceivedCurrency || 'USD', basis: 'UNKNOWN', per: 'per_task' },
      paymentStatus: reportBackForm.paymentStatus,
      evidenceRefs: [],
      commanderNotes: reportBackForm.commanderNotes.trim() || null,
    }
    const result = await postBridge(body)
    if (result.ok && result.data.record) setMissionRecord(result.data.record)
    setMessage(result.ok ? 'Report-back recorded. Completion does not imply payment; promised pay does not imply received pay.' : (result.data.error ?? 'Report-back could not be recorded.'))
  }

  const checkPayment = async () => {
    const result = await postBridge({ action: 'CHECK_LEDGER_PAYMENT', opportunityId: item.id })
    if (result.ok && result.data.record) setMissionRecord(result.data.record)
    setMessage(result.ok ? 'Verified deposit found — payment loop closed.' : (result.data.error ?? 'No verified deposit found yet. Payment remains pending.'))
  }

  const closeMissionAction = async () => {
    const result = await postBridge({ action: 'CLOSE', opportunityId: item.id })
    if (result.ok && result.data.record) setMissionRecord(result.data.record)
    setMessage(result.ok ? 'Mission closed.' : (result.data.error ?? 'Mission could not be closed.'))
  }

  const status = missionRecord?.missionStatus ?? 'NOT_ASSESSED'

  return (
    <section className="mt-7 rounded border border-cyan-400/20 bg-black/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-[0.3em] text-emerald-300">Mission bridge · Phase 49-I</p>
        <Badge value={status} tone={status === 'READY_FOR_COMMANDER_ACTION' || status === 'PAYMENT_VERIFIED' ? 'text-emerald-200 border-emerald-400/30' : status === 'BLOCKED' ? 'text-rose-200 border-rose-400/30' : 'text-cyan-200 border-cyan-400/30'} />
      </div>

      <button type="button" onClick={() => void assessReadiness()} disabled={assessing} className="mt-3 rounded border border-cyan-400/30 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-cyan-200 disabled:opacity-40">
        {assessing ? 'Assessing…' : 'Assess readiness'}
      </button>

      {message ? <p className="mt-2 text-xs text-cyan-200" role="status">{message}</p> : null}

      {assessment ? (
        <div className="mt-4">
          <CommanderReadinessCard card={assessment} />
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-500">Run a readiness assessment to see qualification gaps, preparation items, and a field brief for this opportunity.</p>
      )}

      {fieldBrief ? (
        <div className="mt-5 rounded border border-white/10 bg-slate-950/60 p-4">
          <p className="text-[10px] uppercase tracking-widest text-emerald-300">{fieldBrief.available === 'FULL_FIELD_BRIEF' ? 'Commander field brief' : fieldBrief.available === 'PREPARATION_BRIEF' ? 'Preparation brief' : 'Field brief unavailable'}</p>
          {fieldBrief.brief ? (
            <div className="mt-2 space-y-2 text-xs text-slate-300">
              <p>Where: {fieldBrief.brief.location ?? 'Unknown'} · When: {fieldBrief.brief.dateTimeWindow ?? 'Unknown'}</p>
              <p>What to bring: {fieldBrief.brief.whatToBring.length ? fieldBrief.brief.whatToBring.join(', ') : 'Nothing identified.'}</p>
              <p>What to expect: {fieldBrief.brief.whatToExpect}</p>
              <p>What to ask: {fieldBrief.brief.whatToAsk.length ? fieldBrief.brief.whatToAsk.join(' · ') : 'Nothing outstanding.'}</p>
              <p>Success checkpoint: {fieldBrief.brief.successCheckpoint}</p>
              {fieldBrief.brief.unresolvedQuestions.length ? <p className="text-amber-200">Unresolved: {fieldBrief.brief.unresolvedQuestions.join(' · ')}</p> : null}
              <p className="text-slate-500">{fieldBrief.brief.reportBackInstructions}</p>
            </div>
          ) : (
            <p className="mt-2 text-xs text-amber-200">{fieldBrief.unavailableReason}</p>
          )}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => void markActive()} disabled={status !== 'READY_FOR_COMMANDER_ACTION'} className="rounded border border-emerald-400/30 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-emerald-200 disabled:opacity-30">
          Mark ready for field action
        </button>
        {PAYMENT_CHECKABLE.has(status) ? (
          <button type="button" onClick={() => void checkPayment()} className="rounded border border-cyan-400/30 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-cyan-200">
            Check verified payment
          </button>
        ) : null}
        {CLOSABLE.has(status) ? (
          <button type="button" onClick={() => void closeMissionAction()} className="rounded border border-white/15 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-300">
            Close mission
          </button>
        ) : null}
      </div>

      {ACTIVE_STATUSES.has(status) ? (
        <div className="mt-5 rounded border border-white/10 bg-black/20 p-4">
          <p className="text-[10px] uppercase tracking-widest text-amber-300">Report back</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-[10px] uppercase tracking-widest text-slate-500">
              Outcome
              <select value={reportBackForm.outcome} onChange={e => setReportBackForm(f => ({ ...f, outcome: e.target.value as ReportBackOutcome }))} className="mt-1 w-full rounded border border-white/15 bg-black/40 p-2 text-xs text-white">
                {REPORT_BACK_OUTCOMES.map(o => <option key={o} value={o}>{tag(o)}</option>)}
              </select>
            </label>
            <label className="text-[10px] uppercase tracking-widest text-slate-500">
              Payment status (self-reported, unverified)
              <select value={reportBackForm.paymentStatus} onChange={e => setReportBackForm(f => ({ ...f, paymentStatus: e.target.value as ReportBackPaymentStatus }))} className="mt-1 w-full rounded border border-white/15 bg-black/40 p-2 text-xs text-white">
                {REPORT_BACK_PAYMENT_STATUSES.map(o => <option key={o} value={o}>{tag(o)}</option>)}
              </select>
            </label>
            <label className="text-[10px] uppercase tracking-widest text-slate-500">
              Time spent (minutes)
              <input value={reportBackForm.timeSpentMinutes} onChange={e => setReportBackForm(f => ({ ...f, timeSpentMinutes: e.target.value }))} inputMode="numeric" className="mt-1 w-full rounded border border-white/15 bg-black/40 p-2 text-xs text-white" />
            </label>
            <label className="text-[10px] uppercase tracking-widest text-slate-500">
              Travel cost
              <input value={reportBackForm.travelCost} onChange={e => setReportBackForm(f => ({ ...f, travelCost: e.target.value }))} inputMode="decimal" className="mt-1 w-full rounded border border-white/15 bg-black/40 p-2 text-xs text-white" />
            </label>
            <label className="text-[10px] uppercase tracking-widest text-slate-500">
              Other costs
              <input value={reportBackForm.otherCosts} onChange={e => setReportBackForm(f => ({ ...f, otherCosts: e.target.value }))} inputMode="decimal" className="mt-1 w-full rounded border border-white/15 bg-black/40 p-2 text-xs text-white" />
            </label>
            <label className="text-[10px] uppercase tracking-widest text-slate-500">
              Amount received (claimed, unverified)
              <input value={reportBackForm.compensationReceivedAmount} onChange={e => setReportBackForm(f => ({ ...f, compensationReceivedAmount: e.target.value }))} inputMode="decimal" className="mt-1 w-full rounded border border-white/15 bg-black/40 p-2 text-xs text-white" />
            </label>
            <label className="sm:col-span-2 text-[10px] uppercase tracking-widest text-slate-500">
              Provider response
              <input value={reportBackForm.providerResponse} onChange={e => setReportBackForm(f => ({ ...f, providerResponse: e.target.value }))} className="mt-1 w-full rounded border border-white/15 bg-black/40 p-2 text-xs text-white" />
            </label>
            <label className="sm:col-span-2 text-[10px] uppercase tracking-widest text-slate-500">
              Commander notes
              <textarea value={reportBackForm.commanderNotes} onChange={e => setReportBackForm(f => ({ ...f, commanderNotes: e.target.value }))} className="mt-1 w-full rounded border border-white/15 bg-black/40 p-2 text-xs text-white" rows={2} />
            </label>
          </div>
          <button type="button" onClick={() => void submitReportBack()} className="mt-3 rounded border border-amber-400/30 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-amber-200">
            Submit report-back
          </button>
        </div>
      ) : null}

      {missionRecord?.reportBack ? (
        <div className="mt-4 rounded border border-white/10 bg-black/20 p-3 text-xs text-slate-300">
          <p className="text-[10px] uppercase tracking-widest text-slate-500">Last report-back · {missionRecord.reportBack.reportedAt}</p>
          <p className="mt-1">Outcome: {tag(missionRecord.reportBack.outcome)} · Payment status: {tag(missionRecord.reportBack.paymentStatus)}</p>
        </div>
      ) : null}

      <p className="mt-4 text-[9px] uppercase tracking-widest text-slate-600">Session-only mission state · No external action taken · No durable memory written</p>
    </section>
  )
}
