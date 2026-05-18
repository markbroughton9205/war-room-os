'use client'

import { useCallback, useEffect, useState } from 'react'

type Diagnostics = {
  generatedAt: string
  providerStatusSource: string
  babyProviderBindingSource: string
  signalMigrationStatus: string
  signalPersistenceNote: string
  lastOrchestrationStepResult: Record<string, unknown> | null
  latestTaskPacketSource: string
  observerLearningStatus: string
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/10 bg-black/25 p-2">
      <div className="text-[9px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className="mt-1 break-words font-mono text-[10px] text-sky-200">{value}</div>
    </div>
  )
}

export function ProductionDiagnosticsPanel() {
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/war-room/diagnostics', { cache: 'no-store' })
      const body = await res.json() as Diagnostics & { error?: string }
      if (!res.ok) throw new Error(body.error || 'Production diagnostics failed')
      setDiagnostics(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Production diagnostics failed')
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  return (
    <section className="mx-auto mt-14 max-w-6xl border-t border-sky-900/50 pt-10">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-sky-300">Diagnostics</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-white sm:text-2xl">Production Readiness Truth Layer</h2>
        </div>
        <button type="button" onClick={() => void load()} className="rounded border border-white/15 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-slate-300">Refresh</button>
      </header>
      {error ? <div className="mb-3 rounded border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">{error}</div> : null}
      <div className="grid gap-3 md:grid-cols-3">
        <Mini label="Provider Status Source" value={diagnostics?.providerStatusSource ?? 'checking'} />
        <Mini label="Baby Binding Source" value={diagnostics?.babyProviderBindingSource ?? 'checking'} />
        <Mini label="Signal Migration" value={diagnostics?.signalMigrationStatus ?? 'checking'} />
        <Mini label="Orchestration Step" value={diagnostics?.lastOrchestrationStepResult ? JSON.stringify(diagnostics.lastOrchestrationStepResult) : 'none'} />
        <Mini label="Latest Task Packet Source" value={diagnostics?.latestTaskPacketSource ?? 'checking'} />
        <Mini label="Observer Learning" value={diagnostics?.observerLearningStatus ?? 'checking'} />
      </div>
      <p className="mt-3 rounded border border-white/10 bg-black/25 p-3 text-[10px] leading-relaxed text-slate-500">
        Signal note: {diagnostics?.signalPersistenceNote ?? 'checking'} · Last checked: {diagnostics?.generatedAt ?? 'checking'}.
      </p>
    </section>
  )
}
