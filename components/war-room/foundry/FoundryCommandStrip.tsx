'use client'

import { useCallback, useEffect, useState } from 'react'
import type { AutonomyStatus } from '@/lib/agents/ops/engineering/autonomy/controller'
import { CommandCard } from './FoundryAutonomyCenter'

/** Live view of the commands Foundry is carrying out, shown right where the Commander typed them (the Foundry composer). Same records as the Autonomy Control Center. */
export function FoundryCommandStrip({ refreshKey }: { refreshKey: number }) {
  const [status, setStatus] = useState<AutonomyStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const load = useCallback(async () => {
    try { const r = await fetch('/api/foundry/autonomy', { cache: 'no-store' }); if (r.ok) setStatus((await r.json()) as AutonomyStatus) } catch { /* the strip is a view */ }
  }, [])
  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 2500)
    return () => clearInterval(t)
  }, [load, refreshKey])
  const post = async (body: Record<string, unknown>) => {
    setBusy(true)
    try { await fetch('/api/foundry/autonomy', { method: 'POST', headers: { 'content-type': 'application/json', 'x-wr-agent-ops': '1' }, body: JSON.stringify(body) }) } finally { setBusy(false); void load() }
  }
  const shown = [...(status?.active ?? []), ...(status?.recent.slice(0, 1) ?? [])]
  if (!shown.length) return null
  return (
    <div data-testid="foundry-command-strip" className="mb-2 rounded-md bg-black/40 p-2 text-white ring-1 ring-sky-800/60">
      <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-widest text-sky-300">
        <span>Foundry autonomy</span>
        <a className="underline" href="/war-room/engineering/agents">Control Center</a>
        <span className="flex-1" />
        {!status?.emergencyStop && <button type="button" data-testid="strip-estop" disabled={busy} className="rounded bg-red-700 px-2 py-0.5 text-[11px] font-bold normal-case tracking-normal" onClick={() => void post({ action: 'estop', reason: 'Emergency Stop pressed in the Foundry composer' })}>EMERGENCY STOP</button>}
      </div>
      {shown.map((c) => <CommandCard key={c.id} c={c} detail={null} open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)} busy={busy} post={(b) => post(b)} compact />)}
    </div>
  )
}
