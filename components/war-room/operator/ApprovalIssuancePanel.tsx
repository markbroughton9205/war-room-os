'use client'

import { useCallback, useState } from 'react'
import type { ApprovalIssueResponse } from '@/lib/council/approval-issuance/types'

type TemplateVersion = 'apple_reminder_mark_read_v1' | 'apple_reminder_mark_read_v2'

export function ApprovalIssuancePanel() {
  const [targetId, setTargetId] = useState('')
  const [commanderInput, setCommanderInput] = useState('')
  const [ttlSeconds, setTtlSeconds] = useState('300')
  const [templateVersion, setTemplateVersion] = useState<TemplateVersion>('apple_reminder_mark_read_v1')
  const [exactApprovedText, setExactApprovedText] = useState('')
  const [approvalId, setApprovalId] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const callIssueRoute = useCallback(async (mode: 'preview' | 'issue') => {
    setLoading(true)
    setNotice(null)
    try {
      const res = await fetch('/api/council/approval/issue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode,
          templateVersion,
          targetId: targetId.trim(),
          commanderInput: commanderInput.trim(),
          ttlSeconds: Number(ttlSeconds),
          confirmed: mode === 'issue' ? confirmed : undefined,
          exactApprovedText: mode === 'issue' ? exactApprovedText : undefined,
        }),
      })
      const body = await res.json() as ApprovalIssueResponse
      if (body.exactApprovedText) setExactApprovedText(body.exactApprovedText)
      if (body.approvalId) setApprovalId(body.approvalId)
      setNotice(body.safeSummary)
      if (!res.ok || !body.ok) return false
      return true
    } catch {
      setNotice('Approval route did not return a response.')
      return false
    } finally {
      setLoading(false)
    }
  }, [commanderInput, confirmed, exactApprovedText, targetId, templateVersion, ttlSeconds])

  const preview = useCallback(() => {
    setApprovalId(null)
    setConfirmed(false)
    void callIssueRoute('preview')
  }, [callIssueRoute])

  const issue = useCallback(() => {
    if (!confirmed) {
      setNotice('Commander confirmation is required before issuing.')
      return
    }
    void callIssueRoute('issue')
  }, [callIssueRoute, confirmed])

  return (
    <div className="rounded border border-white/10 bg-black/25 p-3 text-[10px] text-slate-400">
      <div className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-300">Approval Issuance Surface (46P)</div>
      <p className="mt-1 text-slate-500">
        Issues a single-use approval only for the authenticated Commander. The approval still must be consumed by the live action path before a packet can be created.
      </p>

      {notice ? <div className="mt-2 rounded border border-sky-300/25 bg-sky-500/10 p-2 text-sky-100">{notice}</div> : null}

      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <label className="text-[9px] font-bold uppercase tracking-widest text-slate-500">
          Template
          <select
            value={templateVersion}
            onChange={event => {
              setTemplateVersion(event.target.value as TemplateVersion)
              setExactApprovedText('')
              setApprovalId(null)
              setConfirmed(false)
            }}
            className="mt-1 w-full rounded border border-white/15 bg-black/40 px-2 py-1 text-[10px] text-slate-200"
          >
            <option value="apple_reminder_mark_read_v1">Apple Reminder mark read v1</option>
            <option value="apple_reminder_mark_read_v2">Apple Reminder mark read v2</option>
          </select>
        </label>
        <label className="text-[9px] font-bold uppercase tracking-widest text-slate-500">
          TTL seconds
          <input
            type="number"
            min="30"
            max="900"
            step="1"
            value={ttlSeconds}
            onChange={event => setTtlSeconds(event.target.value)}
            className="mt-1 w-full rounded border border-white/15 bg-black/40 px-2 py-1 text-[10px] text-slate-200"
          />
        </label>
        <label className="text-[9px] font-bold uppercase tracking-widest text-slate-500 md:col-span-2">
          Apple Reminder ID
          <input
            value={targetId}
            onChange={event => {
              setTargetId(event.target.value)
              setExactApprovedText('')
              setApprovalId(null)
              setConfirmed(false)
            }}
            placeholder="Reminder ID to approve for mark-read packet creation"
            className="mt-1 w-full rounded border border-white/15 bg-black/40 px-2 py-1 text-[10px] text-slate-200"
          />
        </label>
        <label className="text-[9px] font-bold uppercase tracking-widest text-slate-500 md:col-span-2">
          Commander input optional
          <textarea
            value={commanderInput}
            onChange={event => setCommanderInput(event.target.value)}
            rows={2}
            placeholder="Why this approval is being issued"
            className="mt-1 w-full rounded border border-white/15 bg-black/40 px-2 py-1 text-[10px] text-slate-200"
          />
        </label>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={preview}
          disabled={loading}
          className="rounded border border-white/15 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-300 disabled:opacity-50"
        >
          {loading ? 'Working' : 'Preview Text'}
        </button>
      </div>

      {exactApprovedText ? (
        <div className="mt-3 rounded border border-yellow-300/20 bg-yellow-300/5 p-2">
          <div className="text-[9px] font-bold uppercase tracking-widest text-yellow-200">Exact Approval Text</div>
          <div className="mt-1 rounded border border-white/10 bg-black/35 p-2 font-mono text-[9px] text-slate-200">{exactApprovedText}</div>
          <label className="mt-2 flex items-start gap-2 text-xs text-yellow-100">
            <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-0.5" />
            I confirm this exact approval text may be issued for this one Apple Reminder target.
          </label>
          <button
            type="button"
            onClick={issue}
            disabled={loading || !confirmed}
            className="mt-2 rounded border border-emerald-300/40 bg-emerald-300 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-black disabled:opacity-50"
          >
            {loading ? 'Issuing' : 'Issue Approval'}
          </button>
        </div>
      ) : null}

      {approvalId ? (
        <div className="mt-2 rounded border border-emerald-300/20 bg-emerald-300/5 p-2">
          <div className="text-[9px] font-bold uppercase tracking-widest text-emerald-200">Approval ID</div>
          <div className="mt-1 break-all font-mono text-[9px] text-slate-200">{approvalId}</div>
        </div>
      ) : null}
    </div>
  )
}
