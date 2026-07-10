'use client'

import { useCallback, useState } from 'react'
import type { AppleReminderActionPacket } from '@/lib/council/apple-reminders-bridge'
import type { AppleReminderLiveRouteResponse } from '@/lib/council/apple-reminder-live-route'

export function AppleReminderLiveBridgePanel() {
  const [approvalId, setApprovalId] = useState('')
  const [reminderId, setReminderId] = useState('')
  const [packet, setPacket] = useState<AppleReminderActionPacket | null>(null)
  const [shortcutUrl, setShortcutUrl] = useState<string | null>(null)
  const [receiptText, setReceiptText] = useState('')
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [verificationStatus, setVerificationStatus] = useState<string | null>(null)

  const postLiveCommand = useCallback(async (payload: Record<string, unknown>) => {
    setLoading(true)
    setNotice(null)
    try {
      const res = await fetch('/api/council/apple-reminder-live', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json() as AppleReminderLiveRouteResponse
      return body
    } catch {
      setNotice('Request failed before a response was received.')
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const issuePacket = useCallback(() => {
    const trimmedReminderId = reminderId.trim()
    const trimmedApprovalId = approvalId.trim()
    if (!trimmedReminderId) {
      setNotice('Enter a reminder ID first.')
      return
    }
    if (!trimmedApprovalId) {
      setNotice('Enter the approvalId from a pre-existing, separately-issued approval. This panel does not create approvals.')
      return
    }
    if (!window.confirm(`Issue a single-use Apple Reminder Shortcut packet for reminder "${trimmedReminderId}" using approval "${trimmedApprovalId}"? This does not mutate anything by itself -- it only prepares a packet you must run manually on your iPhone.`)) return

    void postLiveCommand({ command: 'issue_apple_reminder_packet', approvalId: trimmedApprovalId, reminderId: trimmedReminderId, confirmed: true }).then(body => {
      if (!body) return
      if (body.status === 'issued' && body.packet && body.shortcutUrl) {
        setPacket(body.packet)
        setShortcutUrl(body.shortcutUrl)
        setNotice('Packet issued. Copy the URL below to your iPhone and run it in Safari to launch Shortcuts.')
      } else {
        setPacket(null)
        setShortcutUrl(null)
        setNotice(body.safeSummary)
      }
    })
  }, [approvalId, reminderId, postLiveCommand])

  const copyUrl = useCallback(() => {
    if (!shortcutUrl) return
    void navigator.clipboard.writeText(shortcutUrl).then(
      () => setNotice('Shortcut URL copied. Send it to your iPhone (Messages/AirDrop) and open it in Safari there -- shortcuts:// links only work on iOS.'),
      () => setNotice('Could not copy automatically. Select the URL text manually.')
    )
  }, [shortcutUrl])

  const submitReceipt = useCallback(() => {
    if (!packet) {
      setNotice('Issue a packet first.')
      return
    }
    const trimmed = receiptText.trim()
    if (!trimmed) {
      setNotice('Paste the receipt JSON from the Shortcut first.')
      return
    }
    if (!window.confirm('Submit this receipt for verification against the live ledger?')) return

    void postLiveCommand({ command: 'submit_apple_reminder_receipt', packet, receiptText: trimmed }).then(body => {
      if (!body) return
      setVerificationStatus(body.verification?.status ?? body.status)
      setNotice(body.safeSummary)
      if (body.status === 'verified') {
        setPacket(null)
        setShortcutUrl(null)
        setReceiptText('')
      }
    })
  }, [packet, receiptText, postLiveCommand])

  return (
    <div className="rounded border border-white/10 bg-black/25 p-3 text-[10px] text-slate-400">
      <div className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-300">Apple Reminder Live Bridge (46N)</div>
      <p className="mt-1 text-slate-500">
        Manual, Commander-triggered only. Disabled unless both live-route env flags are set. shortcuts:// links only open on an iPhone --
        this panel will not do anything useful from a desktop browser beyond copying the URL. This panel does not create approvals --
        approvalId must come from a pre-existing, separately-issued approval. That issuance step does not exist yet, so issuing will
        currently always be blocked (approval_not_found) until it is built.
      </p>

      {notice ? <div className="mt-2 rounded border border-sky-300/25 bg-sky-500/10 p-2 text-sky-100">{notice}</div> : null}

      {!packet ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={approvalId}
            onChange={event => setApprovalId(event.target.value)}
            placeholder="approvalId (from a pre-existing approval)"
            className="rounded border border-white/15 bg-black/40 px-2 py-1 text-[10px] text-slate-200"
          />
          <input
            type="text"
            value={reminderId}
            onChange={event => setReminderId(event.target.value)}
            placeholder="Apple Reminder ID"
            className="rounded border border-white/15 bg-black/40 px-2 py-1 text-[10px] text-slate-200"
          />
          <button
            type="button"
            onClick={issuePacket}
            disabled={loading}
            className="rounded border border-emerald-300/30 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-200 disabled:opacity-50"
          >
            {loading ? 'Working' : 'Issue Packet'}
          </button>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <div className="rounded border border-white/10 bg-black/40 p-2">
            <div className="text-slate-500">Shortcut URL (copy to iPhone, open in Safari there):</div>
            <div className="mt-1 break-all font-mono text-[9px] text-slate-300">{shortcutUrl}</div>
            <button
              type="button"
              onClick={copyUrl}
              className="mt-2 rounded border border-white/15 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-300"
            >
              Copy URL
            </button>
          </div>

          <textarea
            value={receiptText}
            onChange={event => setReceiptText(event.target.value)}
            placeholder="Paste the receipt JSON shown by the Shortcut after it runs"
            rows={4}
            className="w-full rounded border border-white/15 bg-black/40 px-2 py-1 text-[9px] text-slate-200"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={submitReceipt}
              disabled={loading}
              className="rounded border border-emerald-300/30 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-200 disabled:opacity-50"
            >
              {loading ? 'Working' : 'Submit Receipt'}
            </button>
            <button
              type="button"
              onClick={() => { setPacket(null); setShortcutUrl(null); setReceiptText(''); setNotice(null) }}
              className="rounded border border-white/15 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-300"
            >
              Cancel
            </button>
            {verificationStatus ? <span className="text-slate-500">Last verification: {verificationStatus}</span> : null}
          </div>
        </div>
      )}
    </div>
  )
}
