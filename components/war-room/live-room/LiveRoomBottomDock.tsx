'use client'

import dynamic from 'next/dynamic'
import { memo, type ReactNode } from 'react'
import { OperatorCommandDeck } from '@/components/war-room/operator'

const OpportunityScoutPanel = dynamic(
  () => import('@/components/war-room/opportunities/OpportunityScoutPanel').then(mod => mod.OpportunityScoutPanel),
  {
    ssr: false,
    loading: () => (
      <div className="rounded border border-white/10 px-2 py-1 text-[9px] text-slate-500">Opportunity queue loading…</div>
    ),
  },
)

export type LiveRoomBottomDockProps = {
  pendingApprovals: number
  queueActionCount: number
  opportunityCount: number
  familiesStrip: ReactNode
  ordersStrip: ReactNode
  needsRaelPanel: ReactNode | null
  showOpportunityScout?: boolean
}

export const LiveRoomBottomDock = memo(function LiveRoomBottomDock({
  pendingApprovals,
  queueActionCount,
  opportunityCount,
  familiesStrip,
  ordersStrip,
  needsRaelPanel,
  showOpportunityScout = true,
}: LiveRoomBottomDockProps) {
  return (
    <div className="max-h-[min(42vh,20rem)] overflow-y-auto px-3 py-2 sm:px-4">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[9px] font-bold uppercase tracking-widest text-slate-500">
        <span className="rounded border border-white/10 px-2 py-0.5">Approvals: {pendingApprovals}</span>
        <span className="rounded border border-white/10 px-2 py-0.5">Queue: {queueActionCount}</span>
        <span className="rounded border border-white/10 px-2 py-0.5">Opportunities: {opportunityCount}</span>
      </div>
      {ordersStrip}
      {needsRaelPanel}
      <div className="mb-2">{familiesStrip}</div>
      <OperatorCommandDeck />
      {showOpportunityScout ? (
        <details className="mt-2 rounded border border-white/10 bg-black/30">
          <summary className="cursor-pointer px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-amber-200/90">
            Income workers &amp; opportunity queue
          </summary>
          <div className="max-h-48 overflow-y-auto p-2">
            <OpportunityScoutPanel />
          </div>
        </details>
      ) : null}
    </div>
  )
})
