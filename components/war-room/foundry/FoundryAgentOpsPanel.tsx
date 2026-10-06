'use client'

import { useCallback, useEffect, useState } from 'react'
import { buildOpsViewModel, type Control, type LoadState, type OpsEnvelope } from '@/lib/agents/ops/uiState'

/** Phase 10 operator surface: durable agents, long-lived workers, approvals, actions, errors, usage. Controls call the Commander-gated API. */
export function FoundryAgentOpsPanel() {
  const [state, setState] = useState<LoadState<OpsEnvelope>>({ phase: 'loading' })
  const [notice, setNotice] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch('/api/foundry/agents/ops?section=summary&limit=50', { cache: 'no-store' })
      .then(async (r) => (r.ok ? ((await r.json()) as OpsEnvelope) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e: unknown) => setState({ phase: 'error', message: e instanceof Error ? e.message : 'failed to load' }))
  }, [])
  useEffect(() => { load() }, [load])

  const act = (c: Control) => {
    setNotice(null)
    fetch('/api/foundry/agents/ops', { method: 'POST', headers: { 'content-type': 'application/json', 'x-wr-agent-ops': '1' }, body: JSON.stringify({ action: c.action, ...c.payload }) })
      .then(async (r) => { const j = (await r.json()) as { error?: string; code?: string }; setNotice(r.ok ? `${c.label}: done` : `${c.label} refused: ${j.error ?? 'error'}${j.code ? ` (${j.code})` : ''}`); load() })
      .catch((e: unknown) => setNotice(`${c.label} failed: ${e instanceof Error ? e.message : 'error'}`))
  }
  const controlButtons = (key: string, controls: Control[]) => controls.map((c) => {
    const id = `${key}:${c.label}`
    return c.confirm && confirming !== id
      ? <button key={id} type="button" className="mr-2 text-xs underline text-amber-300" onClick={() => setConfirming(id)}>{c.label}…</button>
      : <button key={id} type="button" className={`mr-2 text-xs underline ${c.confirm ? 'text-red-300' : 'text-sky-300'}`} onClick={() => { setConfirming(null); act(c) }}>{c.confirm ? `Confirm ${c.label}` : c.label}</button>
  })

  if (state.phase === 'loading') return <p data-testid="agentops-loading" className="p-4 text-gray-300">Loading agent operations…</p>
  if (state.phase === 'error') return <p data-testid="agentops-error" className="p-2 m-4 bg-red-600">Agent operations API unavailable: {state.message}</p>
  const vm = buildOpsViewModel(state.data)

  return (
    <div data-testid="agentops-panel" className="bg-gray-900 text-white p-4">
      <h1 className="text-xl mb-1">Agent Foundry</h1>
      <p className="text-sm text-gray-300">{vm.header}</p>
      <p data-testid="agentops-banner" className="text-xs text-amber-300 mb-3">{vm.banner}</p>
      {notice && <p data-testid="agentops-notice" className="text-sm bg-gray-800 p-2 mb-3">{notice}</p>}
      <section data-testid="agentops-agents" className="mb-6">
        <h2 className="text-lg border-b border-gray-700 mb-2">{vm.sections.agents.title}</h2>
        {vm.sections.agents.rows.length === 0 && <p className="text-gray-400 text-sm">{vm.sections.agents.empty}</p>}
        {vm.sections.agents.rows.map((r) => (
          <div key={r.id} className="mb-3 text-sm">
            <div className="font-medium">{r.title}</div>
            <div className="text-gray-300">{r.detail}</div>
            <div className="text-gray-400 text-xs">{r.evaluation}</div>
            <div className="text-gray-400 text-xs">{r.recommendation}</div>
            {r.flags.length > 0 && <div className="text-amber-300 text-xs">{r.flags.join(' · ')}</div>}
            <div>{controlButtons(r.id, r.controls)}</div>
          </div>
        ))}
      </section>
      <section data-testid="agentops-workers" className="mb-6">
        <h2 className="text-lg border-b border-gray-700 mb-2">{vm.sections.workers.title}</h2>
        {vm.sections.workers.rows.length === 0 && <p className="text-gray-400 text-sm">{vm.sections.workers.empty}</p>}
        {vm.sections.workers.rows.map((r) => (
          <div key={r.id} className="mb-3 text-sm">
            <div className="font-medium">{r.title}</div>
            <div className="text-gray-300">{r.detail}</div>
            <div className="text-gray-400 text-xs">{r.limits}</div>
            {r.flags.length > 0 && <div className="text-amber-300 text-xs">{r.flags.join(' · ')}</div>}
            <div>{controlButtons(r.id, r.controls)}</div>
          </div>
        ))}
      </section>
      {(['approvals', 'runs', 'errors', 'usage'] as const).map((k) => (
        <section key={k} data-testid={`agentops-${k}`} className="mb-6">
          <h2 className="text-lg border-b border-gray-700 mb-2">{vm.sections[k].title}</h2>
          {vm.sections[k].rows.length === 0 && <p className="text-gray-400 text-sm">{vm.sections[k].empty}</p>}
          {vm.sections[k].rows.map((r) => (
            <div key={r.id} className="mb-2 text-sm">
              <div className="font-medium">{r.title}</div>
              <div className="text-gray-300 text-xs">{r.detail}</div>
              {'outputs' in r && Array.isArray(r.outputs) && r.outputs.map((o: string) => <div key={o} className="text-gray-400 text-xs">· {o}</div>)}
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
