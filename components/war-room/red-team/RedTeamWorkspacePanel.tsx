'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { CopyCouncilButton } from '@/components/war-room/council/CopyCouncilButton'
import { ExportButton } from '@/components/war-room/operator/ExportButton'
import { Badge } from '@/components/war-room/repair-shared/Badge'
import { FieldList } from '@/components/war-room/repair-shared/FieldList'
import type { CouncilRepairPacket } from '@/lib/council-repair'
import { normalizeRedTeamCoderIssue, normalizeSentinelFinding } from '@/lib/red-team-workspace/normalize'
import { formatRedTeamWorkspaceItemReport } from '@/lib/red-team-workspace/report'
import type { RedTeamWorkspaceItem } from '@/lib/red-team-workspace/types'
import type { SentinelFinding } from '@/lib/red-sentinel/runScan'
import type { RedTeamCoderRepairPlan, RedTeamCoderSeverity } from '@/lib/red-team-coder/types'

type CoderStatusResponse = {
  status: string
  latestDetectedIssue: { issueId: string; severity: RedTeamCoderSeverity; detectedAt: string; symptom: string } | null
  latestRepairPlan: RedTeamCoderRepairPlan | null
  message?: string
}

const BTN_CLASS = 'rounded px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-widest'

export function RedTeamWorkspacePanel() {
  const [sentinelFindings, setSentinelFindings] = useState<SentinelFinding[]>([])
  const [sentinelLastScan, setSentinelLastScan] = useState<string | null>(null)
  const [coderStatus, setCoderStatus] = useState<CoderStatusResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [packets, setPackets] = useState<Record<string, CouncilRepairPacket>>({})
  const [marked, setMarked] = useState<Set<string>>(new Set())

  const loadCoderStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/red-team-coder/status', { cache: 'no-store' })
      const j = await res.json() as CoderStatusResponse
      setCoderStatus(j)
    } catch {
      setCoderStatus(null)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadCoderStatus(), 0)
    return () => window.clearTimeout(timer)
  }, [loadCoderStatus])

  const runDiagnose = useCallback(async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/red-sentinel/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const j = await res.json() as { findings?: SentinelFinding[]; scannedAt?: string; error?: string }
      if (!res.ok) {
        setError(j.error || 'Red Sentinel scan was blocked. Grant standing permission for scans in the main panel and retry.')
      } else {
        setSentinelFindings(Array.isArray(j.findings) ? j.findings : [])
        if (typeof j.scannedAt === 'string') setSentinelLastScan(j.scannedAt)
      }
      await loadCoderStatus()
      setNotice('Diagnose ran a real Red Sentinel scan and refreshed Red Team Coder status. Red Team Coder issue detection requires live chat-session signal only available from the Live Council session — this workspace shows its latest queued finding, not a fresh detection.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Diagnose failed')
    } finally {
      setBusy(false)
    }
  }, [loadCoderStatus])

  const items = useMemo<RedTeamWorkspaceItem[]>(() => {
    const sentinelItems = sentinelFindings.map(normalizeSentinelFinding)
    const coderItem = coderStatus?.latestDetectedIssue
      ? [normalizeRedTeamCoderIssue(coderStatus.latestDetectedIssue, coderStatus.latestRepairPlan)]
      : []
    return [...coderItem, ...sentinelItems]
  }, [sentinelFindings, coderStatus])

  const selected = items.find(item => item.id === selectedId) ?? items[0] ?? null
  const selectedPacket = selected ? packets[selected.id] ?? null : null

  const generateRepairPacket = useCallback(async (item: RedTeamWorkspaceItem) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/council/repair-packet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decree: `Diagnose this panel: ${item.observation}`,
          sourceFamily: 'red_team',
          sourceContent: JSON.stringify({ classification: item.classification, evidence: item.evidence }),
        }),
      })
      const j = await res.json() as { packet?: CouncilRepairPacket; error?: string; clarification?: string }
      if (!res.ok || !j.packet) {
        setError(j.clarification || j.error || 'Repair packet generation failed.')
        return
      }
      setPackets(prev => ({ ...prev, [item.id]: j.packet! }))
      setNotice('Repair packet generated from this finding.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Repair packet generation failed')
    } finally {
      setBusy(false)
    }
  }, [])

  const sendToApprovals = useCallback(async (item: RedTeamWorkspaceItem) => {
    const packet = packets[item.id]
    if (!packet) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/council-repair/send-to-approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packet, source: 'red_team_workspace' }),
      })
      const j = await res.json() as { error?: string; reused?: boolean }
      if (!res.ok) {
        setError(j.error || 'Send to Approvals failed.')
        return
      }
      setNotice(j.reused ? 'This packet already has an open decision in Approvals.' : 'Sent to Approvals. No approval or execution has occurred — this only creates decision context.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send to Approvals failed')
    } finally {
      setBusy(false)
    }
  }, [packets])

  const toggleMark = useCallback((id: string) => {
    setMarked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  return (
    <section className="rounded p-3 text-xs" style={{ border: '1px solid #333', background: 'rgba(0,0,0,0.25)' }}>
      <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold tracking-widest text-slate-200">RED TEAM WORKSPACE</span>
        <button type="button" onClick={() => void runDiagnose()} disabled={busy} className={`${BTN_CLASS} disabled:opacity-50`} style={{ border: '1px solid #F87171', color: '#FCA5A5' }}>
          {busy ? 'Running' : 'Diagnose'}
        </button>
      </header>

      {error ? <p className="mb-2 rounded border border-red-500/30 bg-red-500/10 p-2 text-[10px] text-red-200">{error}</p> : null}
      {notice ? <p className="mb-2 rounded border border-sky-500/30 bg-sky-500/10 p-2 text-[10px] text-sky-100">{notice}</p> : null}

      <p className="mb-2 text-[10px] text-slate-500">
        {sentinelLastScan ? `Last Red Sentinel scan: ${new Date(sentinelLastScan).toLocaleString()}` : 'No Red Sentinel scan run yet this session — findings appear only after Diagnose runs (Red Sentinel does not expose a persisted findings list).'}
      </p>

      <div className="grid gap-4 xl:grid-cols-[minmax(16rem,0.7fr)_minmax(0,1.3fr)]">
        <aside className="rounded border border-white/10 bg-black/25 p-3">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Observations</h3>
          <ul className="mt-2 max-h-80 space-y-2 overflow-y-auto text-xs">
            {items.length ? items.map(item => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className="w-full rounded border border-white/10 p-2 text-left text-slate-300 hover:border-red-400/40"
                >
                  <span className="block font-semibold text-white">{item.observation.slice(0, 80)}</span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    <Badge label={item.source} />
                    <Badge label={item.severity} />
                    {marked.has(item.id) ? <Badge label="marked_for_review" /> : null}
                  </span>
                </button>
              </li>
            )) : <li className="rounded border border-white/10 p-2 text-slate-500">No observations yet. Run Diagnose.</li>}
          </ul>
        </aside>

        <section className="rounded border border-white/10 bg-black/25 p-3">
          {selected ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex flex-wrap gap-1">
                  <Badge label={selected.source} />
                  <Badge label={selected.classification} />
                  <Badge label={selected.severity} />
                  <Badge label={selectedPacket ? selectedPacket.status : 'no_repair_packet_generated'} />
                </div>
                <button
                  type="button"
                  onClick={() => toggleMark(selected.id)}
                  className={BTN_CLASS}
                  style={{ border: '1px solid rgba(148,163,184,0.35)', color: '#CBD5E1' }}
                >
                  {marked.has(selected.id) ? 'Unmark' : 'Mark for Review'}
                </button>
              </div>
              <p className="text-[9px] text-slate-600">Mark for Review is session only — resets on reload, not saved to any backend.</p>

              <div className="grid gap-3 md:grid-cols-2">
                <FieldList title="Observation" items={[selected.observation]} />
                <FieldList title="Affected Subsystem" items={[selected.affectedSubsystem]} />
                <FieldList title="Evidence" items={selected.evidence} />
                <FieldList title="Suspected Cause" items={[selected.suspectedCause]} />
                <FieldList title="Confirmed Cause" items={['Not confirmed — no automatic confirmation mechanism exists.']} />
                <FieldList title="Security Impact" items={[selected.securityImpact]} />
                <FieldList title="User Impact" items={[selected.userImpact]} />
                <FieldList title="Reliability Impact" items={[selected.reliabilityImpact]} />
                <FieldList title="Recommended Repair" items={[selected.recommendedRepair]} />
                <FieldList title="Verification Plan" items={selected.verificationPlan.length ? selected.verificationPlan : ['Not tracked by this source.']} />
                <FieldList title="Rollback Plan" items={selected.rollbackPlan?.length ? selected.rollbackPlan : ['Not produced by this source.']} />
                <FieldList title="Unresolved Questions" items={selected.unresolvedQuestions} />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <FieldList title="Repair History" items={['No persistent repair-history source connected.', 'Historical validation records unavailable.', 'Future source: repair events / audit records / verified execution history.']} />
                <FieldList title="Verification History" items={['No persistent verification-history source connected.', 'No verification evidence recorded.']} />
              </div>

              <div className="flex flex-wrap items-start gap-2">
                <button type="button" onClick={() => void generateRepairPacket(selected)} disabled={busy} className={`${BTN_CLASS} disabled:opacity-50`} style={{ border: '1px solid #38BDF8', color: '#7DD3FC' }}>
                  Generate Repair Packet
                </button>
                <div className="inline-flex flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() => void sendToApprovals(selected)}
                    disabled={busy || !selectedPacket}
                    className={`${BTN_CLASS} disabled:opacity-40`}
                    style={{ border: '1px solid #FBBF24', color: '#FDE68A' }}
                  >
                    Send to Approvals
                  </button>
                  {!selectedPacket ? (
                    <span className="text-[8px] leading-snug tracking-wide text-slate-600">Generate a repair packet first.</span>
                  ) : null}
                </div>
                <CopyCouncilButton
                  label="Copy Report"
                  getText={() => formatRedTeamWorkspaceItemReport(selected, selectedPacket)}
                  successMessage="Report copied"
                />
                <ExportButton
                  label="Export Report"
                  getContent={() => formatRedTeamWorkspaceItemReport(selected, selectedPacket)}
                  filename={() => `red-team-report-${selected.id.replace(/[^a-z0-9]+/gi, '-')}.txt`}
                />
              </div>
            </div>
          ) : (
            <div className="rounded border border-white/10 bg-black/20 p-8 text-center text-sm text-slate-500">
              Run Diagnose to populate observations from Red Sentinel and Red Team Coder.
            </div>
          )}
        </section>
      </div>
    </section>
  )
}
