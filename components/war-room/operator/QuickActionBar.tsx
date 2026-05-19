'use client'

import { memo } from 'react'

export const QuickActionBar = memo(function QuickActionBar({
  loading,
  onLogEarnings,
  onRequestQueue,
  onApprovePacket,
  onManualEmailAlert,
}: {
  loading: boolean
  onLogEarnings: () => void
  onRequestQueue: () => void
  onApprovePacket: () => void
  onManualEmailAlert: () => void
}) {
  const buttonClass = 'rounded border border-white/15 bg-black/25 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-200 disabled:opacity-50'
  return (
    <section className="rounded border border-fuchsia-500/20 bg-fuchsia-500/[0.035] p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.28em] text-fuchsia-300">Quick Actions</div>
          <p className="mt-1 text-[10px] text-slate-500">Draft, propose, or log only after Commander confirmation.</p>
        </div>
        <span className="rounded border border-yellow-300/30 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-yellow-200">Ra&apos;el approval authority</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass} onClick={onLogEarnings} disabled={loading}>Log Earnings</button>
        <button type="button" className={buttonClass} onClick={onRequestQueue} disabled={loading}>Request New Queue</button>
        <button type="button" className={buttonClass} onClick={onApprovePacket} disabled={loading}>Approve Last Packet</button>
        <button type="button" className={buttonClass} onClick={onManualEmailAlert} disabled={loading}>Manual Email Alert</button>
      </div>
    </section>
  )
})
