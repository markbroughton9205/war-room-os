'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CouncilRepairPacket, CouncilRepairSnapshot } from '@/lib/council-repair'

function Badge({ label }: { label: string }) {
  const color = /risk|security|rejected|broken/i.test(label)
    ? '#F87171'
    : /approval|awaiting|schema|runtime/i.test(label)
      ? '#FBBF24'
      : '#38BDF8'
  return (
    <span
      className="rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest"
      style={{ border: `1px solid ${color}66`, color, background: 'rgba(0,0,0,0.25)' }}
    >
      {label.replace(/_/g, ' ')}
    </span>
  )
}

function FieldList({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="rounded border border-white/10 bg-black/20 p-3">
      <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-300">{title}</h4>
      <ul className="mt-2 space-y-1 text-[10px] leading-relaxed text-slate-400">
        {(items.length ? items : ['None identified yet.']).slice(0, 8).map(item => (
          <li key={`${title}-${item}`} className="rounded border border-white/10 px-2 py-1">
            {item}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function RepairPacketPanel({ latest }: { latest?: CouncilRepairPacket | null }) {
  const [snapshot, setSnapshot] = useState<CouncilRepairSnapshot | null>(null)
  const [selectedPacketId, setSelectedPacketId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/council/repair-packet', { cache: 'no-store' })
      const body = await res.json() as CouncilRepairSnapshot & { error?: string }
      if (!res.ok) throw new Error(body.error || 'Repair packet snapshot failed')
      setSnapshot(body)
      if (!selectedPacketId && body.latestPacket) setSelectedPacketId(body.latestPacket.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Repair packet snapshot failed')
    } finally {
      setLoading(false)
    }
  }, [selectedPacketId])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const packets = useMemo(() => {
    const combined = latest ? [latest, ...(snapshot?.packets ?? [])] : (snapshot?.packets ?? [])
    const seen = new Set<string>()
    return combined.filter(packet => {
      if (seen.has(packet.id)) return false
      seen.add(packet.id)
      return true
    })
  }, [latest, snapshot?.packets])

  const activePacket = packets.find(packet => packet.id === selectedPacketId) ?? latest ?? snapshot?.latestPacket ?? null

  const copyPrompt = async () => {
    if (!activePacket) return
    try {
      await navigator.clipboard.writeText(activePacket.cursorReadyPrompt)
      setNotice('Repair packet copied for manual Cursor handoff. War Room did not invoke Cursor or mutate files.')
    } catch {
      setNotice('Clipboard unavailable; select the visible prompt manually. War Room did not invoke Cursor.')
    }
  }

  return (
    <section className="mx-auto mt-14 max-w-6xl border-t border-sky-900/50 pt-10">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-sky-300">Phase 19</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-white sm:text-2xl">Council Repair Command Pipeline</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            Engineering Lane packets prepared from Live Council repair decrees. Advisory only: manual copy to Cursor, approval required, no browser execution, file mutation, shell execution, deploy, commit, or fake repair completion.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge label={snapshot?.latestPacket ? 'packet_ready' : 'awaiting_repair_decree'} />
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded border border-white/15 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-slate-300 disabled:opacity-50"
          >
            {loading ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      </header>

      {error ? <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">{error}</div> : null}
      {notice ? <div className="mb-4 rounded border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-100">{notice}</div> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.2fr)]">
        <aside className="rounded border border-sky-500/25 bg-black/25 p-4">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-sky-300">Recent Repair Packets</h3>
          <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto text-xs">
            {packets.length ? packets.map(packet => (
              <li key={packet.id}>
                <button
                  type="button"
                  onClick={() => setSelectedPacketId(packet.id)}
                  className="w-full rounded border border-white/10 p-2 text-left text-slate-300 hover:border-sky-400/40"
                >
                  <span className="block font-semibold text-white">{packet.title}</span>
                  <span className="mt-2 flex flex-wrap gap-1">
                    <Badge label={packet.classification} />
                    <Badge label={packet.approvalStatus} />
                  </span>
                  <span className="mt-1 block text-[10px] text-slate-500">{packet.source.packetSource}</span>
                </button>
              </li>
            )) : <li className="rounded border border-white/10 p-2 text-slate-500">No repair packet prepared yet.</li>}
          </ul>
          <div className="mt-3 rounded border border-white/10 bg-black/20 p-3 text-[10px] leading-relaxed text-slate-500">
            Logging: repair packet creation is emitted to the System Ledger and Activity Stream through `council.repair_packet.created` when the packet API runs.
          </div>
        </aside>

        <section className="rounded border border-white/10 bg-black/25 p-4">
          {activePacket ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-white">{activePacket.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">
                    Source: {activePacket.source.packetSource} · created {new Date(activePacket.createdAt).toLocaleString()}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Badge label={activePacket.classification} />
                    <Badge label={activePacket.approvalStatus} />
                    <Badge label="manual_copy_only" />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void copyPrompt()}
                  className="rounded border border-sky-400/40 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-sky-200"
                >
                  Copy Cursor Packet
                </button>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <FieldList title="Concrete Issue" items={[activePacket.concreteIssue]} />
                <FieldList title="Affected Panel / Route" items={[activePacket.affectedPanelRoute]} />
                <FieldList title="Evidence" items={activePacket.evidence} />
                <FieldList title="Observed Symptoms" items={activePacket.observedSymptoms} />
                <FieldList title="Files / Routes To Inspect" items={activePacket.filesRoutesToInspect} />
                <FieldList title="Recommended Fix" items={activePacket.recommendedFix} />
                <FieldList title="Validation Commands" items={activePacket.validationCommands} />
                <FieldList title="Risk Notes" items={activePacket.riskNotes} />
                <FieldList title="Rollback Notes" items={activePacket.rollbackNotes} />
              </div>

              <section className="rounded border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-amber-100">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-amber-300">Suspected Root Cause</h4>
                <p className="mt-2 leading-relaxed">{activePacket.suspectedRootCause}</p>
              </section>

              <section className="rounded border border-violet-500/25 bg-black/20 p-3">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-violet-300">Family Contributions</h4>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  {activePacket.familyContributions.map(contribution => (
                    <article key={contribution.family} className="rounded border border-white/10 p-2 text-[10px]">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-slate-200">{contribution.label}</span>
                        <Badge label={contribution.role} />
                      </div>
                      <p className="mt-1 leading-relaxed text-slate-400">{contribution.contribution}</p>
                    </article>
                  ))}
                </div>
              </section>

              <section className="rounded border border-red-500/25 bg-red-500/5 p-3 text-xs">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-red-300">Risk Review</h4>
                <p className="mt-2 leading-relaxed text-red-100">{activePacket.riskReview.contribution}</p>
              </section>

              <section className="rounded border border-emerald-500/25 bg-emerald-500/5 p-3 text-xs">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">Baby Observer Lesson Candidate</h4>
                <p className="mt-2 leading-relaxed text-emerald-100">{activePacket.babyLessonCandidate.summary}</p>
                <p className="mt-2 text-[10px] text-emerald-200/70">Candidate only; permanent lesson requires Commander approval or validated repair outcome.</p>
              </section>

              <section className="rounded border border-sky-500/25 bg-black/20 p-3">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-sky-300">Cursor-Ready Prompt</h4>
                <textarea
                  readOnly
                  value={activePacket.cursorReadyPrompt}
                  rows={12}
                  className="mt-2 w-full resize-y rounded border border-white/10 bg-black/40 p-3 font-mono text-[10px] leading-relaxed text-slate-300"
                />
              </section>
            </div>
          ) : (
            <div className="rounded border border-white/10 bg-black/20 p-8 text-center text-sm text-slate-500">
              Use a Live Council repair decree or response button to prepare the first repair packet.
            </div>
          )}
        </section>
      </div>
    </section>
  )
}
