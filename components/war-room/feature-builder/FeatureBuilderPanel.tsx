'use client'

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type {
  FeatureBuildPacket,
  FeatureBuilderRequest,
  FeatureBuilderReview,
  FeatureBuilderSnapshot,
} from '@/lib/feature-builder/model'

type CreateFeatureResponse = {
  persistenceAvailable: boolean
  persistenceNote: string
  request: FeatureBuilderRequest
  packet: FeatureBuildPacket
  reviews: FeatureBuilderReview[]
}

type FormState = {
  idea: string
  targetAppModule: string
  commanderContext: string
}

const emptyForm: FormState = {
  idea: '',
  targetAppModule: '',
  commanderContext: '',
}

function Badge({ label }: { label: string }) {
  const color =
    label === 'approved' || label === 'validated' || label === 'shipped'
      ? '#34D399'
      : label === 'rejected' || label === 'risk'
        ? '#F87171'
        : label === 'reviewed' || label === 'awaiting_commander_approval'
          ? '#FBBF24'
          : '#94A3B8'
  return (
    <span
      className="rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest"
      style={{ border: `1px solid ${color}66`, color, background: 'rgba(0,0,0,0.25)' }}
    >
      {label}
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

export function FeatureBuilderPanel() {
  const [snapshot, setSnapshot] = useState<FeatureBuilderSnapshot | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [activePacket, setActivePacket] = useState<FeatureBuildPacket | null>(null)
  const [activeReviews, setActiveReviews] = useState<FeatureBuilderReview[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/feature-builder', { cache: 'no-store' })
      const body = await res.json() as FeatureBuilderSnapshot & { error?: string }
      if (!res.ok) throw new Error(body.error || 'Feature Builder snapshot failed')
      setSnapshot(body)
      if (!activePacket && body.packets[0]) {
        setActivePacket(body.packets[0])
        setActiveReviews(body.reviews.filter(review => review.packetId === body.packets[0]?.id))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Feature Builder snapshot failed')
    } finally {
      setLoading(false)
    }
  }, [activePacket])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)
    setNotice(null)

    try {
      const res = await fetch('/api/feature-builder', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          idea: form.idea,
          targetAppModule: form.targetAppModule || null,
          commanderContext: form.commanderContext || null,
        }),
      })
      const body = await res.json() as CreateFeatureResponse & { error?: string }
      if (!res.ok) throw new Error(body.error || 'Feature packet generation failed')
      setActivePacket(body.packet)
      setActiveReviews(body.reviews)
      setNotice(body.persistenceNote)
      setForm(emptyForm)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Feature packet generation failed')
    } finally {
      setSubmitting(false)
    }
  }

  const copyPrompt = async () => {
    if (!activePacket) return
    try {
      await navigator.clipboard.writeText(activePacket.cursorReadyImplementationPrompt)
      setNotice('Cursor handoff copied. War Room did not invoke Cursor or mutate files.')
    } catch {
      setNotice('Clipboard unavailable; select the prompt text manually. War Room did not invoke Cursor.')
    }
  }

  const packets = snapshot?.packets ?? []
  const packetReviews = useMemo(() => activeReviews.length ? activeReviews : [], [activeReviews])

  return (
    <section className="mx-auto mt-14 max-w-6xl border-t border-white/10 pt-10">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-[#d4af37]">Phase 12</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-white sm:text-2xl">
            Feature Builder / App Factory
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            Convert Commander ideas into Cursor-ready build packets with Baby AI family reviews. Proposal-only: no hidden execution, file mutation, Cursor invocation, commit, push, or deployment from War Room.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge label={snapshot?.persistenceAvailable ? 'persistent' : 'fallback'} />
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded border border-white/15 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-slate-300"
          >
            Refresh
          </button>
        </div>
      </header>

      {error ? <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">{error}</div> : null}
      {notice ? <div className="mb-4 rounded border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">{notice}</div> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.2fr)]">
        <section className="rounded border border-[#d4af37]/30 bg-black/25 p-4">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#d4af37]">New Feature Request</h3>
          <form className="mt-4 space-y-3" onSubmit={submit}>
            <label className="block">
              <span className="text-[10px] font-medium uppercase tracking-widest text-slate-500">Commander idea</span>
              <textarea
                value={form.idea}
                onChange={event => setForm(current => ({ ...current, idea: event.target.value }))}
                rows={5}
                required
                className="mt-1 w-full resize-y rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-[#d4af37]/50 focus:outline-none"
                placeholder="Describe the app or feature idea..."
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-medium uppercase tracking-widest text-slate-500">Target app/module</span>
              <input
                value={form.targetAppModule}
                onChange={event => setForm(current => ({ ...current, targetAppModule: event.target.value }))}
                className="mt-1 w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-[#d4af37]/50 focus:outline-none"
                placeholder="Optional; inferred if blank"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-medium uppercase tracking-widest text-slate-500">Context / constraints</span>
              <textarea
                value={form.commanderContext}
                onChange={event => setForm(current => ({ ...current, commanderContext: event.target.value }))}
                rows={3}
                className="mt-1 w-full resize-y rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-[#d4af37]/50 focus:outline-none"
                placeholder="Optional acceptance criteria, risks, or module notes"
              />
            </label>
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded border border-[#00ff41]/40 bg-[#00ff41]/10 px-4 py-2 font-mono text-xs font-semibold uppercase tracking-widest text-[#00ff41] transition hover:bg-[#00ff41]/15 disabled:opacity-50"
            >
              {submitting ? 'Generating packet...' : 'Generate build packet'}
            </button>
          </form>

          <div className="mt-4 rounded border border-white/10 bg-black/20 p-3 text-[10px] leading-relaxed text-slate-500">
            Status flow: idea / reviewed / approved / sent_to_cursor / building / validated / shipped. This panel prepares packets only; approvals and engineering execution stay manual.
          </div>

          <div className="mt-4">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Recent Packets</h3>
            <ul className="mt-2 max-h-56 space-y-2 overflow-y-auto text-xs">
              {packets.length ? packets.map(packet => (
                <li key={packet.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setActivePacket(packet)
                      setActiveReviews((snapshot?.reviews ?? []).filter(review => review.packetId === packet.id))
                    }}
                    className="w-full rounded border border-white/10 p-2 text-left text-slate-300 hover:border-[#d4af37]/40"
                  >
                    <span className="block font-semibold text-white">{packet.title}</span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      <Badge label={packet.status} />
                      <Badge label={packet.approvalStatus} />
                    </span>
                  </button>
                </li>
              )) : <li className="rounded border border-white/10 p-2 text-slate-500">No persisted feature packets yet.</li>}
            </ul>
          </div>
        </section>

        <section className="rounded border border-white/10 bg-black/25 p-4">
          {activePacket ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-white">{activePacket.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">{activePacket.objective}</p>
                  <p className="mt-2 text-[10px] text-slate-500">Target: {activePacket.targetAppModule}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge label={activePacket.status} />
                  <Badge label={activePacket.approvalStatus} />
                </div>
              </div>

              <div className="rounded border border-sky-500/25 bg-sky-500/5 p-3 text-xs text-sky-100">
                <div className="text-[10px] font-bold uppercase tracking-widest text-sky-300">User Story</div>
                <p className="mt-1 leading-relaxed">{activePacket.userStory}</p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <FieldList title="Files To Inspect" items={activePacket.requiredFilesToInspect} />
                <FieldList title="Technical Approach" items={activePacket.technicalApproach} />
                <FieldList title="Database Changes" items={activePacket.databaseChanges} />
                <FieldList title="API Routes" items={activePacket.apiRoutes} />
                <FieldList title="UI Components" items={activePacket.uiComponents} />
                <FieldList title="Validation Commands" items={activePacket.validationCommands} />
                <FieldList title="Risks" items={activePacket.risks} />
                <FieldList title="Rollback Notes" items={activePacket.rollbackNotes} />
              </div>

              <section className="rounded border border-emerald-500/25 bg-emerald-500/5 p-3 text-xs">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">Monetization / Business Angle</h4>
                <p className="mt-2 leading-relaxed text-emerald-100">{activePacket.monetizationAngle}</p>
              </section>

              <section className="rounded border border-violet-500/25 bg-black/20 p-3">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-violet-300">Baby AI Family Contributions</h4>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  {packetReviews.map(review => (
                    <article key={review.id} className="rounded border border-white/10 p-2 text-[10px]">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-slate-200">{review.agentName}</span>
                        <Badge label={review.reviewType} />
                      </div>
                      <p className="mt-1 leading-relaxed text-slate-400">{review.summary}</p>
                    </article>
                  ))}
                </div>
              </section>

              <section className="rounded border border-[#d4af37]/25 bg-black/20 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-[#d4af37]">Cursor Handoff</h4>
                  <button
                    type="button"
                    onClick={() => void copyPrompt()}
                    className="rounded border border-[#d4af37]/40 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-[#d4af37]"
                  >
                    Copy Cursor Prompt
                  </button>
                </div>
                <p className="text-[10px] leading-relaxed text-slate-500">
                  Manual copy only. War Room does not invoke Cursor, mutate files, run validation, commit, push, or deploy.
                </p>
                <textarea
                  readOnly
                  value={activePacket.cursorReadyImplementationPrompt}
                  rows={10}
                  className="mt-2 w-full resize-y rounded border border-white/10 bg-black/40 p-3 font-mono text-[10px] leading-relaxed text-slate-300"
                />
              </section>
            </div>
          ) : (
            <div className="rounded border border-white/10 bg-black/20 p-8 text-center text-sm text-slate-500">
              Submit a Commander idea to generate the first Feature Build Packet.
            </div>
          )}
        </section>
      </div>

      <div className="mt-4 rounded border border-white/10 bg-black/25 p-3 text-[10px] text-slate-500">
        Persistence: {snapshot?.persistenceNote ?? 'checking'} · Guardrails: no hidden execution, no auto deployment, no War Room file mutation, cloud-only families.
      </div>
    </section>
  )
}

