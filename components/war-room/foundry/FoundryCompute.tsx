'use client'

import { useEffect, useState } from 'react'
import type { ComputeView } from '@/lib/agents/forge/computeView'
import { computeViewModel } from '@/lib/agents/forge/computeViewModel'

/** Read-only compute view (nodes, measured profiles, per-role placement). It enrolls, loads and calls nothing. */
export function FoundryCompute() {
  const [view, setView] = useState<ComputeView | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    fetch('/api/foundry/agents/ops?section=compute', { cache: 'no-store' })
      .then(async (r) => (r.ok ? ((await r.json()) as { data: ComputeView }).data : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setView)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : 'failed to load'))
  }, [])
  if (err) return <p data-testid="agentops-compute-error" className="text-xs text-red-300 mb-6">Compute view unavailable: {err}</p>
  if (!view) return <p data-testid="agentops-compute-loading" className="text-xs text-gray-400 mb-6">Loading compute view…</p>
  const vm = computeViewModel(view)
  return (
    <section data-testid="agentops-compute" className="mb-6">
      <h2 className="text-lg border-b border-gray-700 mb-2">Compute nodes and roles</h2>
      <p className="text-xs text-gray-300 mb-2">{vm.header}</p>
      {vm.nodes.map((n) => (<div key={n.id} className="mb-2 text-sm"><div className="font-medium">{n.title}</div><div className="text-gray-300 text-xs">{n.detail}</div></div>))}
      <h3 className="text-sm mt-3 mb-1">Role placement (would-place)</h3>
      {vm.roles.map((r) => (<div key={r.id} className="mb-1 text-sm"><div className="font-medium">{r.title}</div><div className="text-gray-300 text-xs">{r.detail}</div></div>))}
      <h3 className="text-sm mt-3 mb-1">Task routing (by role, with explicit fallback)</h3>
      {vm.routing.map((r) => (<div key={r.id} className="mb-1 text-sm"><div className="font-medium">{r.title}</div><div className="text-gray-300 text-xs">{r.detail}</div></div>))}
      <h3 className="text-sm mt-3 mb-1">Measured resource profiles</h3>
      {vm.profiles.length ? vm.profiles.map((p) => (<div key={p.id} className="mb-1 text-sm"><div className="font-medium">{p.title}</div><div className="text-gray-300 text-xs">{p.detail}</div></div>)) : <div className="text-xs text-gray-400">none stored yet</div>}
      {vm.notes.map((n) => (<div key={n} className="text-xs text-amber-300">{n}</div>))}
    </section>
  )
}
