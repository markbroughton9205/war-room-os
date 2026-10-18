'use client'

import { useEffect, useState } from 'react'
import type { PoolView } from '@/lib/agents/forge/poolView'
import { poolViewModel } from '@/lib/agents/forge/poolViewModel'

/** Read-only Local Specialist Pool view (roles, residency, node). Loads nothing: it asks the runtime what it already holds. */
export function FoundrySpecialistPool() {
  const [view, setView] = useState<PoolView | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    fetch('/api/foundry/agents/ops?section=pool', { cache: 'no-store' })
      .then(async (r) => (r.ok ? ((await r.json()) as { data: PoolView }).data : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setView)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : 'failed to load'))
  }, [])
  if (err) return <p data-testid="agentops-pool-error" className="text-xs text-red-300 mb-6">Specialist pool unavailable: {err}</p>
  if (!view) return <p data-testid="agentops-pool-loading" className="text-xs text-gray-400 mb-6">Loading specialist pool…</p>
  const vm = poolViewModel(view)
  return (
    <section data-testid="agentops-pool" className="mb-6">
      <h2 className="text-lg border-b border-gray-700 mb-2">Local Specialist Pool</h2>
      <p className="text-xs text-gray-300 mb-2">{vm.header}</p>
      {vm.roles.map((r) => (<div key={r.id} className="mb-2 text-sm"><div className="font-medium">{r.title}</div><div className="text-gray-300 text-xs">{r.detail}</div></div>))}
      <div className="text-xs text-gray-300 mt-2">Resident now: {vm.resident.length ? vm.resident.map((r) => `${r.title} (${r.detail})`).join('; ') : 'none (or UNKNOWN when the runtime is unreachable)'}</div>
      {vm.nodes.map((n) => (<div key={n.id} className="text-xs text-gray-400">{n.title}: {n.detail}</div>))}
      {vm.notes.map((n) => (<div key={n} className="text-xs text-amber-300">{n}</div>))}
    </section>
  )
}
