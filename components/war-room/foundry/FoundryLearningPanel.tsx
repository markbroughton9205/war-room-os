'use client'

import { useEffect, useState } from 'react'
import { buildLearningViewModel, describeDrill, type ApiEnvelope, type LoadState } from '@/lib/recursive-learning/uiState'
import type { DrillResult } from '@/lib/recursive-learning/readModel'

/** Phase 9 Commander surface. Read-only: every control here is a GET. */
export function FoundryLearningPanel() {
  const [state, setState] = useState<LoadState<ApiEnvelope>>({ phase: 'loading' })
  const [drill, setDrill] = useState<{ target: string; result: DrillResult | null; error?: string } | null>(null)

  useEffect(() => {
    fetch('/api/foundry/learning?section=summary', { cache: 'no-store' })
      .then(async (r) => (r.ok ? ((await r.json()) as ApiEnvelope) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e: unknown) => setState({ phase: 'error', message: e instanceof Error ? e.message : 'failed to load' }))
  }, [])

  const openDrill = (target: string) => {
    setDrill({ target, result: null })
    fetch(`/api/foundry/learning?section=evidence&target=${encodeURIComponent(target)}`, { cache: 'no-store' })
      .then(async (r) => (r.ok ? ((await r.json()) as { drill: DrillResult }).drill : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((result) => setDrill({ target, result }))
      .catch((e: unknown) => setDrill({ target, result: null, error: e instanceof Error ? e.message : 'failed' }))
  }

  if (state.phase === 'loading') return <p data-testid="learning-loading" className="p-4 text-gray-300">Loading learning evidence…</p>
  if (state.phase === 'error') return <p data-testid="learning-error" className="p-2 m-4 bg-red-600">Learning API unavailable: {state.message}</p>
  const vm = buildLearningViewModel(state.data)
  const d = drill?.result ? describeDrill(drill.result) : null

  return (
    <div data-testid="learning-panel" className="bg-gray-900 text-white p-4">
      <h1 className="text-xl mb-1">Recursive Learning</h1>
      <p className="text-sm text-gray-300">{vm.header}</p>
      <p data-testid="learning-banner" className="text-xs text-amber-300 mb-4">{vm.banner}</p>
      {vm.sections.map((sec) => (
        <section key={sec.key} data-testid={`learning-${sec.key}`} className="mb-6">
          <h2 className="text-lg border-b border-gray-700 mb-2">{sec.title}</h2>
          {sec.rows.length === 0 && <p className="text-gray-400 text-sm">{sec.empty}</p>}
          <ul>
            {sec.rows.map((row) => (
              <li key={row.id} className="mb-2 text-sm">
                <div className="font-medium">{row.title}</div>
                <div className="text-gray-300">{row.detail}</div>
                <div className="text-gray-400 text-xs">{row.explanation}</div>
                {row.flags.length > 0 && <div className="text-amber-300 text-xs">{row.flags.join(' · ')}</div>}
                <button type="button" className="text-xs underline text-sky-300" onClick={() => openDrill(row.drill)}>Show evidence</button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {drill && (
        <aside data-testid="learning-drill" className="fixed right-0 top-0 h-full w-full max-w-xl overflow-auto bg-gray-950 p-4 border-l border-gray-700">
          <button type="button" className="float-right underline text-sm" onClick={() => setDrill(null)}>Close</button>
          {drill.error && <p className="bg-red-600 p-2">{drill.error}</p>}
          {!drill.result && !drill.error && <p>Loading evidence…</p>}
          {d && (
            <>
              <h3 className="text-lg">{d.title}</h3>
              <p className="text-xs text-gray-400 mb-2">{d.explanation}</p>
              {d.status && <p className="text-xs">Status: {d.status}</p>}
              <h4 className="mt-3">Supporting evidence ({d.supporting.length})</h4>
              <ul className="text-xs text-gray-300">{d.supporting.map((l) => <li key={l}>{l}</li>)}</ul>
              <h4 className="mt-3">Contradicting evidence ({d.contradictory.length})</h4>
              <ul className="text-xs text-amber-200">{d.contradictory.map((l) => <li key={l}>{l}</li>)}</ul>
              {d.decisions.length > 0 && <><h4 className="mt-3">Decisions</h4><ul className="text-xs">{d.decisions.map((l) => <li key={l}>{l}</li>)}</ul></>}
              {d.missing.length > 0 && <p className="text-red-300 text-xs">Missing source events: {d.missing.length}</p>}
            </>
          )}
        </aside>
      )}
    </div>
  )
}
