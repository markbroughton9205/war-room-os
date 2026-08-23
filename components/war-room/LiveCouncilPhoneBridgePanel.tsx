'use client'
import { useEffect, useState } from 'react'

type Status = { state: string; provider: string; commander: string | null; inbound: string; outbound: string; currentSmsCouncilThread: string }
export function LiveCouncilPhoneBridgePanel() {
  const [status, setStatus] = useState<Status | null>(null)
  const refresh = () => fetch('/api/live-council/sms').then(r => r.ok ? r.json() : null).then(setStatus).catch(() => setStatus(null))
  useEffect(() => { refresh() }, [])
  const control = (action: 'ENABLE' | 'DISABLE') => fetch('/api/live-council/sms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) }).then(r => r.ok ? r.json() : null).then(setStatus)
  return <section aria-label="Phone Bridge" className="rounded border border-slate-700 p-3 text-xs"><h2 className="font-bold tracking-widest">PHONE BRIDGE</h2><p>{status?.state ?? 'Loading…'} · {status?.provider ?? 'Twilio'}</p><p>Inbound: {status?.inbound ?? 'Blocked'} · Outbound: {status?.outbound ?? 'Blocked'}</p><p>Commander: {status?.commander ?? 'Not configured'}</p><p>Current SMS Council thread: {status?.currentSmsCouncilThread ?? 'LIVE_COUNCIL_COMMANDER_SMS'}</p><p>Last inbound/outbound/delivery: unavailable until durable bridge storage is approved.</p><button type="button" onClick={() => control('ENABLE')}>ENABLE SMS BRIDGE</button><button type="button" onClick={() => control('DISABLE')}>DISABLE SMS BRIDGE</button><button type="button" disabled title="A real SMS test requires future explicit Commander authorization">SEND TEST MESSAGE</button></section>
}
