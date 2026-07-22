'use client'

import { useState } from 'react'

import type { ActionRow } from '@/components/war-room/phase3/Phase3WarRoomPanels'
import { CopyCouncilButton } from '@/components/war-room/council/CopyCouncilButton'
import { ExportButton } from '@/components/war-room/operator/ExportButton'
import { Badge } from '@/components/war-room/repair-shared/Badge'
import { FieldList } from '@/components/war-room/repair-shared/FieldList'
import { RepairDecisionGuidance } from '@/components/war-room/repair-shared/RepairDecisionGuidance'
import { RepairImpactGrid } from '@/components/war-room/repair-shared/RepairImpactGrid'
import { RepairPacketSummary } from '@/components/war-room/repair-shared/RepairPacketSummary'
import { RepairRecommendations } from '@/components/war-room/repair-shared/RepairRecommendations'
import { RepairStatusBadges } from '@/components/war-room/repair-shared/RepairStatusBadges'
import { RepairVerificationBlock } from '@/components/war-room/repair-shared/RepairVerificationBlock'
import { formatRepairPacketReport, validateCouncilRepairPacket } from '@/lib/council-repair'

export type ApprovalsWorkspaceProps = {
  actions: ActionRow[]
  onApprove: (id: string) => void | Promise<void>
  onReject: (id: string) => void | Promise<void>
  onDefer: (id: string) => void | Promise<void>
  onArchive: (id: string) => void | Promise<void>
}

const ACTION_BTN = 'rounded px-2 py-1 text-[10px] font-bold disabled:opacity-50'

type RowVerb = 'approve' | 'reject' | 'defer' | 'archive'

const BUSY_LABEL: Record<RowVerb, string> = {
  approve: 'APPROVING…',
  reject: 'REJECTING…',
  defer: 'DEFERRING…',
  archive: 'ARCHIVING…',
}

export function ApprovalsWorkspace({ actions, onApprove, onReject, onDefer, onArchive }: ApprovalsWorkspaceProps) {
  const pending = actions.filter(a => a.status === 'waiting_approval')
  const [reportForId, setReportForId] = useState<string | null>(null)
  const [busyRows, setBusyRows] = useState<Record<string, RowVerb>>({})

  const runRowAction = async (id: string, verb: RowVerb, action: (id: string) => void | Promise<void>) => {
    if (busyRows[id]) return
    setBusyRows(prev => ({ ...prev, [id]: verb }))
    try {
      await action(id)
    } finally {
      setBusyRows(prev => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
  }

  return (
    <section className="rounded p-3 text-xs" style={{ border: '1px solid #7f1d1d', background: 'rgba(127,29,29,0.12)' }}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold tracking-widest" style={{ color: '#FCA5A5' }}>APPROVALS</span>
      </div>
      <p className="mb-3 text-[10px]" style={{ color: '#888' }}>
        Lists actions awaiting Commander decision (<code className="text-[9px]">waiting_approval</code> only).
      </p>

      <ul className="space-y-3">
        {pending.map(action => {
          const validation = validateCouncilRepairPacket(action.payload?.packet)
          const packet = validation.valid ? validation.packet : null
          const reportOpen = reportForId === action.id
          const reportText = packet ? formatRepairPacketReport(packet, { actionId: action.id, actionStatus: action.status }) : ''
          const rowBusyVerb = busyRows[action.id]
          const rowBusy = Boolean(rowBusyVerb)

          return (
            <li key={action.id} className="rounded border border-white/10 bg-black/20 p-3" style={{ color: '#ddd' }}>
              {packet ? (
                <div className="space-y-3">
                  <RepairStatusBadges packet={packet} />
                  <RepairPacketSummary packet={packet} />
                  <RepairImpactGrid packet={packet} />
                  <RepairRecommendations packet={packet} />
                  <RepairVerificationBlock packet={packet} />
                  <div className="grid gap-3 md:grid-cols-2">
                    <FieldList title="Evidence" items={packet.evidence} />
                    <FieldList title="Risk Notes" items={packet.riskNotes} />
                  </div>
                  <RepairDecisionGuidance packet={packet} />
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="font-mono text-[10px]" style={{ color: '#F87171' }}>{action.type}</div>
                  <div className="text-[9px] opacity-70">{action.id} · queued {new Date(action.created_at).toLocaleString()}</div>
                  <p className="rounded border border-amber-500/25 bg-amber-500/5 p-2 text-[10px] leading-relaxed text-amber-100">
                    No verified repair packet attached. Decision context is incomplete. Generate or attach a repair report before approval.
                  </p>
                </div>
              )}

              {reportOpen && packet ? (
                <section className="mt-3 rounded border border-sky-500/25 bg-black/20 p-3">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-sky-300">Report</h4>
                  <textarea
                    readOnly
                    value={reportText}
                    rows={10}
                    className="mt-2 w-full resize-y rounded border border-white/10 bg-black/40 p-3 font-mono text-[10px] leading-relaxed text-slate-300"
                  />
                </section>
              ) : null}

              <div className="mt-3 flex flex-wrap items-start gap-2">
                <button type="button" disabled={rowBusy} className={ACTION_BTN} style={{ background: '#16A34A', color: '#fff' }} onClick={() => void runRowAction(action.id, 'approve', onApprove)}>
                  {rowBusyVerb === 'approve' ? BUSY_LABEL.approve : 'APPROVE'}
                </button>
                <button type="button" disabled={rowBusy} className={ACTION_BTN} style={{ background: '#991B1B', color: '#fff' }} onClick={() => void runRowAction(action.id, 'reject', onReject)}>
                  {rowBusyVerb === 'reject' ? BUSY_LABEL.reject : 'REJECT'}
                </button>
                <button type="button" disabled={rowBusy} className={ACTION_BTN} style={{ background: '#B45309', color: '#fff' }} onClick={() => void runRowAction(action.id, 'defer', onDefer)}>
                  {rowBusyVerb === 'defer' ? BUSY_LABEL.defer : 'DEFER'}
                </button>
                <button type="button" disabled={rowBusy} className={ACTION_BTN} style={{ background: '#334155', color: '#fff' }} onClick={() => void runRowAction(action.id, 'archive', onArchive)}>
                  {rowBusyVerb === 'archive' ? BUSY_LABEL.archive : 'ARCHIVE'}
                </button>
                <div className="inline-flex flex-col gap-0.5">
                  <button
                    type="button"
                    disabled
                    className="min-h-[32px] rounded px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-widest opacity-40"
                    style={{ border: '1px solid rgba(148,163,184,0.35)', color: '#CBD5E1', background: 'rgba(0,0,0,0.22)' }}
                  >
                    Modify
                  </button>
                  <span className="text-[8px] leading-snug tracking-wide text-slate-600">
                    No backend transition exists to edit a submitted packet or action — Approve, Reject, Defer, or Archive instead.
                  </span>
                </div>
                {packet ? (
                  <>
                    <CopyCouncilButton label="Copy Packet" getText={() => packet.cursorReadyPrompt} successMessage="Packet copied" />
                    <ExportButton label="Export Packet" getContent={() => packet.cursorReadyPrompt} filename={() => `repair-packet-${packet.id}.txt`} />
                    <button
                      type="button"
                      className="rounded px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-widest"
                      style={{ border: '1px solid rgba(56,189,248,0.4)', color: '#7DD3FC', background: 'rgba(0,0,0,0.22)' }}
                      onClick={() => setReportForId(reportOpen ? null : action.id)}
                    >
                      {reportOpen ? 'Hide Report' : 'Generate Report'}
                    </button>
                  </>
                ) : (
                  <Badge label="report_unavailable_no_packet" />
                )}
              </div>
            </li>
          )
        })}
        {!pending.length && <li className="rounded border border-white/10 p-2 text-slate-500">No actions awaiting approval.</li>}
      </ul>
    </section>
  )
}
